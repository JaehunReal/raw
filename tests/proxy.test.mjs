import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import handler from "../api/proxy.mjs";

// Exercise the public handler over HTTP. Only the remote backend is replaced;
// requests, cookies, response headers and response bytes use the real transport.
const nativeFetch = globalThis.fetch;
const PASSWORD = ["proxy", "test", "password"].join("-");
const API_TOKEN = ["mock", "backend", "token"].join("-");
const BACKEND = "https://backend.example";
const ENV_KEYS = ["RULECRAFT_WEB_PASSWORD", "RULECRAFT_API_TOKEN", "RULECRAFT_BACKEND_URL"];
const originalEnvironment = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let server, baseUrl, browserOrigin, upstreamCalls, upstreamResponse;

before(async () => {
  server = http.createServer((req, res) => {
    req.query = Object.fromEntries(new URL(req.url, "https://proxy.invalid").searchParams);
    handler(req, res).catch((error) => {
      res.statusCode = 500;
      res.end(`Unexpected handler error: ${error.message}`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  // Vercel terminates TLS before invoking the function; the fixture models that
  // external HTTPS origin while keeping the test server on the local machine.
  browserOrigin = `https://127.0.0.1:${port}`;
});

beforeEach(() => {
  process.env.RULECRAFT_WEB_PASSWORD = PASSWORD;
  process.env.RULECRAFT_API_TOKEN = API_TOKEN;
  process.env.RULECRAFT_BACKEND_URL = BACKEND;
  upstreamCalls = [];
  upstreamResponse = () => new Response('{"upstream":true}', {
    status: 200, headers: { "Content-Type": "application/json" },
  });
  globalThis.fetch = async (url, options) => {
    upstreamCalls.push({ url: new URL(url), ...options, headers: new Headers(options.headers) });
    return upstreamResponse();
  };
});

after(async () => {
  globalThis.fetch = nativeFetch;
  for (const key of ENV_KEYS) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function request(path, { method = "GET", cookie, origin, body, headers = {} } = {}) {
  const supplied = { ...headers };
  if (cookie) supplied.Cookie = cookie;
  if (origin) supplied.Origin = origin;
  if (body !== undefined && !supplied["Content-Type"]) supplied["Content-Type"] = "application/json";
  return nativeFetch(`${baseUrl}${path}`, { method, headers: supplied, body, redirect: "manual" });
}

async function login() {
  const response = await request("/api/session", {
    method: "POST", origin: browserOrigin, body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true });
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "Successful login must issue the browser session cookie");
  return { cookie: setCookie.split(";")[0], setCookie };
}

function rewrittenPath(route, parameters = {}) {
  return `/api/proxy?${new URLSearchParams({ path: route, ...parameters })}`;
}

test("anonymous API access and session inspection are denied before contacting the backend", async () => {
  const response = await request("/api/graph");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "login_required");
  const session = await request("/api/session");
  assert.equal(session.status, 401);
  assert.deepEqual(await session.json(), { authenticated: false });
  assert.equal(upstreamCalls.length, 0);
});

test("the public uptime route exposes health without requiring a browser session", async () => {
  const health = { status: "ok", service: "rulecraft", version: "0.1.0" };
  upstreamResponse = () => new Response(JSON.stringify(health), {
    headers: { "Content-Type": "application/json" },
  });
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), health);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].url.pathname, "/api/health");
  assert.equal(upstreamCalls[0].headers.get("cookie"), null);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("incorrect credentials and malformed login data do not create a session", async () => {
  const response = await request("/api/session", {
    method: "POST", origin: browserOrigin, body: JSON.stringify({ password: "incorrect" }),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(!(await response.text()).includes(PASSWORD));
  const malformed = await request("/api/session", {
    method: "POST", origin: browserOrigin, body: "{incomplete",
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("set-cookie"), null);
  const nullJson = await request("/api/session", {
    method: "POST", origin: browserOrigin, body: "null",
  });
  assert.equal(nullJson.status, 401);
  assert.equal(nullJson.headers.get("set-cookie"), null);
  assert.equal(upstreamCalls.length, 0);
});

test("successful login creates a protected cookie that authenticates subsequent requests", async () => {
  const { cookie, setCookie } = await login();
  assert.match(setCookie, /^__Secure-rulecraft_session=/);
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/api", "Max-Age=43200"]) {
    assert.ok(setCookie.includes(attribute), `Missing cookie attribute: ${attribute}`);
  }
  const session = await request("/api/session", { cookie });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true });
  const response = await request("/api/graph", { cookie });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { upstream: true });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(upstreamCalls.length, 1);
});

test("modifying a valid signed cookie's expiry invalidates its signature", async () => {
  const { cookie } = await login();
  const [name, value] = cookie.split("=");
  const [expires, signature] = value.split(".");
  const forged = `${name}=${Number(expires) - 1}.${signature}`;
  const response = await request("/api/graph", { cookie: forged });
  assert.equal(response.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test("a correctly signed but expired cookie cannot authenticate", async () => {
  const expires = String(Math.floor(Date.now() / 1000) - 10);
  const signature = createHmac("sha256", PASSWORD).update(`rulecraft-session:${expires}`).digest("base64url");
  const response = await request("/api/graph", { cookie: `__Secure-rulecraft_session=${expires}.${signature}` });
  assert.equal(response.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test("logout clears the cookie with the same browser security attributes", async () => {
  const { cookie } = await login();
  const response = await request("/api/session", { method: "DELETE", cookie, origin: browserOrigin });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  const cleared = response.headers.get("set-cookie");
  assert.match(cleared, /^__Secure-rulecraft_session=;/);
  assert.ok(cleared.includes("Max-Age=0") && cleared.includes("Path=/api") && cleared.includes("HttpOnly"));
  const anonymous = await request("/api/graph");
  assert.equal(anonymous.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test("cross-origin and missing-Origin writes are rejected despite a valid session", async () => {
  const { cookie } = await login();
  for (const origin of [undefined, "https://untrusted.example", `${browserOrigin}/`, browserOrigin.replace("https:", "http:")]) {
    const response = await request("/api/packages", {
      method: "POST", cookie, origin, body: '{"objective":"review"}',
    });
    assert.equal(response.status, 403, `Write accepted with origin ${origin}`);
  }
  const logout = await request("/api/session", { method: "DELETE", cookie, origin: "https://untrusted.example" });
  assert.equal(logout.status, 403);
  assert.equal(logout.headers.get("set-cookie"), null);
  assert.equal(upstreamCalls.length, 0);
});

test("unconfigured or insecure backend settings fail locally instead of using a fallback", async () => {
  const { cookie } = await login();
  delete process.env.RULECRAFT_BACKEND_URL;
  const missing = await request("/api/graph", { cookie });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, "deployment_not_configured");
  for (const backend of ["http://backend.example", "https://user:pass@backend.example", "https://backend.example/other", "https://backend.example?q=filter"]) {
    process.env.RULECRAFT_BACKEND_URL = backend;
    const response = await request("/api/graph", { cookie });
    assert.equal(response.status, 400);
    assert.ok(!(await response.text()).includes("secret"));
  }
  process.env.RULECRAFT_BACKEND_URL = BACKEND;
  delete process.env.RULECRAFT_API_TOKEN;
  assert.equal((await request("/api/graph", { cookie })).status, 503);
  assert.equal(upstreamCalls.length, 0);
});

test("rewritten nested routes retain encoded search values without forwarding the internal path parameter", async () => {
  const { cookie } = await login();
  const parameters = { q: "개인정보 & 기록", source: "administrative", as_of: "2026-09-30", limit: "20", offset: "40" };
  const response = await request(rewrittenPath("laws", parameters), { cookie });
  assert.equal(response.status, 200);
  const forwarded = upstreamCalls[0].url;
  assert.equal(forwarded.origin, BACKEND);
  assert.equal(forwarded.pathname, "/api/laws");
  for (const [key, value] of Object.entries(parameters)) assert.equal(forwarded.searchParams.get(key), value);
  assert.equal(forwarded.searchParams.has("path"), false);
  const nested = await request(rewrittenPath("mcp/tools"), { cookie });
  assert.equal(nested.status, 200);
  assert.equal(upstreamCalls[1].url.pathname, "/api/mcp/tools");
});

test("backend token replaces client authentication and browser cookies never reach the backend", async () => {
  const { cookie } = await login();
  const submitted = JSON.stringify({ tool_name: "query_markdown_graph", arguments: { article_id: "KIPA-RULE-DAT-007" } });
  const response = await request(rewrittenPath("mcp/call"), {
    method: "POST", cookie: `${cookie}; private_browser_cookie=do-not-forward`, origin: browserOrigin,
    headers: { Authorization: "Bearer client-supplied-token" }, body: submitted,
  });
  assert.equal(response.status, 200);
  const forwarded = upstreamCalls[0];
  assert.equal(forwarded.headers.get("authorization"), `Bearer ${API_TOKEN}`);
  assert.equal(forwarded.headers.get("cookie"), null);
  assert.equal(forwarded.headers.get("origin"), null);
  assert.equal(forwarded.headers.get("content-type"), "application/json");
  assert.equal(Buffer.from(forwarded.body).toString(), submitted);
  assert.equal(forwarded.method, "POST");
  assert.equal(forwarded.redirect, "error");
});

test("backend error status and JSON bytes are retained while authentication and cache headers are withheld", async () => {
  const { cookie } = await login();
  const body = '{"detail":"수집한 공식 원문을 찾지 못했습니다."}';
  upstreamResponse = () => new Response(body, { status: 404, headers: {
    "Content-Type": "application/json; charset=utf-8", "Set-Cookie": "backend_cookie=secret",
    "WWW-Authenticate": 'Bearer realm="backend"', "Cache-Control": "public, max-age=3600",
  } });
  const response = await request("/api/laws/law/absent", { cookie });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), body);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("www-authenticate"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
});

test("backend authentication failure reports deployment misconfiguration without invalidating the browser session", async () => {
  const { cookie } = await login();
  upstreamResponse = () => new Response(JSON.stringify({ detail: `invalid backend token: ${API_TOKEN}` }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="${API_TOKEN}"`,
      "Set-Cookie": "backend_session=; Max-Age=0",
    },
  });
  const response = await request("/api/graph", { cookie });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("www-authenticate"), null);
  const body = await response.text();
  assert.equal(JSON.parse(body).code, "backend_auth_failed");
  assert.ok(!body.includes(API_TOKEN));
  const session = await request("/api/session", { cookie });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true });
  assert.equal(upstreamCalls.length, 1);
});

test("ZIP downloads retain binary bytes, response status and attachment filename", async () => {
  const { cookie } = await login();
  const archive = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x7f, 0x0a]);
  upstreamResponse = () => new Response(archive, { status: 200, headers: {
    "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="rulecraft-draft.zip"',
  } });
  const response = await request(rewrittenPath("packages/example/download"), { cookie });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="rulecraft-draft.zip"');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), archive);
  const head = await request(rewrittenPath("packages/example/download"), { method: "HEAD", cookie });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "application/zip");
  assert.equal(head.headers.get("content-disposition"), 'attachment; filename="rulecraft-draft.zip"');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(upstreamCalls[1].method, "HEAD");
});

test("oversized and non-JSON writes are rejected before forwarding", async () => {
  const { cookie } = await login();
  const notJson = await request("/api/packages", {
    method: "POST", cookie, origin: browserOrigin, headers: { "Content-Type": "text/plain" }, body: "plain text",
  });
  assert.equal(notJson.status, 415);
  const oversized = await request("/api/packages", {
    method: "POST", cookie, origin: browserOrigin, body: "x".repeat(4_000_001),
  });
  assert.equal(oversized.status, 413);
  assert.equal(upstreamCalls.length, 0);
});

test("encoded traversal and encoded path separators cannot escape the API route", async () => {
  const { cookie } = await login();
  for (const route of ["../graph", "%2e%2e/graph", "laws/%2fetc", "laws/%5cetc", "laws/%ZZ"]) {
    const response = await request(rewrittenPath(route), { cookie });
    assert.equal(response.status, 400, `Unsafe route accepted: ${route}`);
  }
  assert.equal(upstreamCalls.length, 0);
});

test("backend connection failures return a readable deployment error without upstream details", async () => {
  const { cookie } = await login();
  upstreamResponse = () => { throw new Error(`unavailable: ${API_TOKEN}`); };
  const response = await request("/api/graph", { cookie });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(typeof body.detail, "string");
  assert.ok(!body.detail.includes(API_TOKEN));
});
