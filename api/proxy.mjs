import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "__Secure-rulecraft_session";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 4_000_000;

function equal(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function signature(payload, password) {
  return createHmac("sha256", password).update(`rulecraft-session:${payload}`).digest("base64url");
}
function sessionCookie(req, password) {
  const value = String(req.headers.cookie || "").split(";").map((item) => item.trim())
    .find((item) => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value) return false;
  const [expires, signed, extra] = value.split(".");
  return !extra && /^\d+$/.test(expires) && Number(expires) > Date.now() / 1000
    && Number(expires) <= Date.now() / 1000 + SESSION_SECONDS + 60
    && equal(signed || "", signature(expires, password));
}
function cookie(value, seconds) {
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${seconds}`;
}
function json(res, status, detail) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(detail));
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.host === req.headers.host
      && parsed.origin === origin;
  } catch { return false; }
}
async function bodyBytes(req) {
  if (req.body !== undefined) {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(
      typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    if (body.length > MAX_BODY_BYTES) throw new RangeError("body too large");
    return body;
  }
  const parts = [];
  let length = 0;
  for await (const part of req) {
    const chunk = Buffer.from(part);
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new RangeError("body too large");
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
function target(req) {
  const url = new URL(req.url, "https://proxy.invalid");
  const rewritten = req.query?.path ?? url.searchParams.get("path");
  const path = Array.isArray(rewritten) ? rewritten.join("/") : rewritten;
  const route = path ?? url.pathname.replace(/^\/api\//, "");
  // Only API paths on the configured backend; never accept an absolute URL or traversal.
  if (!route || /[\\\x00-\x20?#]/.test(route) || route.split("/").some((segment) => {
    try { return [".", ".."].includes(decodeURIComponent(segment)) || /[/\\]/.test(decodeURIComponent(segment)); }
    catch { return true; }
  })) throw new Error("invalid path");
  url.searchParams.delete("path");
  return { route, search: url.search };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const password = process.env.RULECRAFT_WEB_PASSWORD || "";
  const token = process.env.RULECRAFT_API_TOKEN || "";
  const rawBackend = process.env.RULECRAFT_BACKEND_URL || "";
  let backend, route, search;
  try {
    backend = new URL(rawBackend);
    if (backend.protocol !== "https:" || backend.username || backend.password || backend.search
      || backend.hash || backend.pathname !== "/") throw new Error("invalid backend");
    ({ route, search } = target(req));
  } catch {
    if (!rawBackend) return json(res, 503, { detail: "백엔드 주소를 배포 환경에 설정해 주세요.", code: "deployment_not_configured" });
    return json(res, 400, { detail: "배포 주소 또는 요청 경로를 확인해 주세요." });
  }
  if (!password || !token) return json(res, 503, {
    detail: "배포 환경의 로그인 비밀번호와 API 연결 설정이 필요합니다.", code: "deployment_not_configured",
  });
  const method = req.method || "GET";
  if (!["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method))
    return json(res, 405, { detail: "지원하지 않는 요청 방식입니다." });
  if (!["GET", "HEAD"].includes(method) && !sameOrigin(req))
    return json(res, 403, { detail: "동일한 웹사이트에서 요청해 주세요." });
  if (route === "session") {
    if (method === "GET") return json(res, sessionCookie(req, password) ? 200 : 401,
      { authenticated: sessionCookie(req, password) });
    if (method === "DELETE") {
      res.setHeader("Set-Cookie", cookie("", 0));
      return json(res, 200, { authenticated: false });
    }
    if (method !== "POST") return json(res, 405, { detail: "지원하지 않는 요청 방식입니다." });
    let submitted;
    try { submitted = JSON.parse((await bodyBytes(req)).toString("utf8")); }
    catch { return json(res, 400, { detail: "올바른 로그인 요청이 필요합니다." }); }
    if (typeof submitted?.password !== "string" || !equal(submitted.password, password))
      return json(res, 401, { detail: "비밀번호를 확인해 주세요." });
    const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
    res.setHeader("Set-Cookie", cookie(`${expires}.${signature(expires, password)}`, SESSION_SECONDS));
    return json(res, 200, { authenticated: true });
  }
  if (route !== "health" && !sessionCookie(req, password))
    return json(res, 401, { detail: "로그인이 필요합니다.", code: "login_required" });
  let body;
  if (!["GET", "HEAD"].includes(method)) {
    try { body = await bodyBytes(req); }
    catch { return json(res, 413, { detail: "첨부한 요청이 너무 큽니다. 4MB 이하로 줄여 주세요." }); }
    if (!String(req.headers["content-type"] || "").startsWith("application/json"))
      return json(res, 415, { detail: "JSON 요청이 필요합니다." });
  }
  try {
    const response = await fetch(new URL(`/api/${route}${search}`, backend), {
      method, body, redirect: "error", signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json, application/zip",
        ...(body ? { "Content-Type": "application/json" } : {}) },
    });
    if (response.status === 401) {
      await response.body?.cancel();
      return json(res, 502, { detail: "백엔드 API 인증 설정이 일치하지 않습니다. 배포 환경의 연결 토큰을 확인해 주세요.", code: "backend_auth_failed" });
    }
    res.statusCode = response.status;
    for (const header of ["content-type", "content-disposition"]) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    // Do not forward backend cookies, redirects, authentication challenges, or caches.
    res.end(method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch {
    json(res, 502, { detail: "백엔드에 연결하지 못했습니다. 서버 상태와 배포 연결 설정을 확인해 주세요." });
  }
}
