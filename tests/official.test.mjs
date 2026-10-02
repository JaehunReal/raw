import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { createOfficialHandler } from "../api/official.mjs";

// Real HTTP transport exercises the production handler. Only PostgreSQL is
// replaced by an injected adapter; these fixtures are not a live-server check.
const URL_FIXTURE = "postgresql://fixture_user:fixture_password@db.fixture.invalid:5432/fixture?sslmode=verify-full";
const SHA = "a".repeat(64);
const DOCUMENT = {
  source: "law", law_id: "law:sample", version_id: "v1", title: "공식 법령 테스트",
  effective_date: "2026-10-01", publication_date: null,
  source_url: "https://www.law.go.kr/법령/테스트?OC=fixture-oc&access_token=fixture-token&lsId=1",
  raw_sha256: SHA, stored_at: new Date("2026-10-01T12:00:00Z"),
  raw_text: "제1조 공식 원문 테스트", raw_bytes: "32",
};
let server, baseUrl, activeHandler, environment, calls, poolOptions, releases, respond, connectError;

before(async () => {
  server = http.createServer((req, res) => {
    req.query = Object.fromEntries(new URL(req.url, "https://official.invalid").searchParams);
    activeHandler(req, res).catch(() => { res.statusCode = 500; res.end("Unexpected handler failure"); });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  environment = { RULECRAFT_DATABASE_URL: URL_FIXTURE };
  calls = []; poolOptions = []; releases = []; connectError = undefined;
  respond = (sql) => {
    if (/GROUP BY source/.test(sql)) return { rows: [{ source: "law", stored_documents: "1", stored_versions: "2", last_stored_at: DOCUMENT.stored_at }] };
    if (/COUNT\(\*\) AS total/.test(sql)) return { rows: [{ total: "1" }] };
    return { rows: [structuredClone(DOCUMENT)] };
  };
  activeHandler = createOfficialHandler({
    environment: () => environment,
    createPool: (options) => {
      poolOptions.push(options);
      return { on() {}, end: async () => {}, connect: async () => {
        if (connectError) throw connectError;
        return { query: async (sql, values) => {
          calls.push({ sql, values });
          if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql) || /LIMIT 0$/.test(sql)) return { rows: [] };
          return respond(sql, values);
        }, release: (error) => releases.push(error) };
      } };
    },
  });
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
function request(path, options) { return fetch(`${baseUrl}${path}`, options); }

test("unconfigured status is an explicit normal state without invented counts", async () => {
  environment = {};
  const response = await request("/api/official/status");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.connection, "not_configured");
  assert.equal(payload.code, "database_not_configured");
  assert.equal(payload.storage, "postgresql");
  assert.ok(!("totals" in payload) && !("sources" in payload));
  assert.ok(!Number.isNaN(Date.parse(payload.checked_at)));
  assert.equal(poolOptions.length, 0);
  assert.match(response.headers.get("cache-control"), /no-store/);
});
test("unconfigured search and document do not masquerade as empty data", async () => {
  environment = {};
  for (const path of ["/api/official/laws", "/api/official/document?source=law&law_id=law:sample&version_id=v1"]) {
    const response = await request(path);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).connection, "not_configured");
  }
  assert.equal(poolOptions.length, 0);
});
test("connected status reports source totals and most recent stored version", async () => {
  const response = await request("/api/official/status");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.connection, "connected");
  assert.deepEqual(payload.totals, { stored_documents: 1, stored_versions: 2, last_stored_at: "2026-10-01T12:00:00.000Z" });
  assert.deepEqual(payload.sources.map((source) => [source.source, source.stored_documents]), [["law", 1], ["administrative", 0], ["ordinance", 0]]);
  assert.equal(payload.sources[1].last_stored_at, null);
  assert.match(calls[0].sql, /READ ONLY/);
  assert.equal(calls.at(-1).sql, "COMMIT");
  assert.equal(releases.length, 1);
  assert.ok(!JSON.stringify(payload).includes("fixture_password"));
});
test("an empty connected database is the only valid zero-count state", async () => {
  respond = () => ({ rows: [] });
  const response = await request("/api/official/status");
  const payload = await response.json();
  assert.equal(payload.connection, "connected");
  assert.deepEqual(payload.totals, { stored_documents: 0, stored_versions: 0, last_stored_at: null });
  assert.equal(payload.sources.length, 3);
});
test("TLS options verify certificates and never accept connectionString overrides", async () => {
  await request("/api/official/status");
  assert.equal(poolOptions[0].ssl.rejectUnauthorized, true);
  assert.equal(poolOptions[0].connectionString, undefined);
  assert.equal(poolOptions[0].max, 2);
  assert.equal(poolOptions[0].connectionTimeoutMillis, 3000);
  assert.equal(poolOptions[0].statement_timeout, 5000);
});
test("custom certificate authority remains verified and DATABASE_URL is supported", async () => {
  environment = { DATABASE_URL: URL_FIXTURE, RULECRAFT_DATABASE_CA: "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----" };
  await request("/api/official/status");
  assert.equal(poolOptions[0].ssl.ca, environment.RULECRAFT_DATABASE_CA);
  assert.equal(poolOptions[0].ssl.rejectUnauthorized, true);
});
test("insecure or file-based TLS parameters are rejected without contacting PostgreSQL", async () => {
  for (const suffix of ["sslmode=disable", "sslmode=require", "sslmode=no-verify", "sslmode=verify-ca", "ssl=false", "sslrootcert=/private/key", "sslcert=/private/key", "sslmode=verify-full&sslmode=disable", "options=-c%20default_transaction_read_only%3Doff"]) {
    environment.RULECRAFT_DATABASE_URL = `${URL_FIXTURE.split("?")[0]}?${suffix}`;
    const response = await request("/api/official/status");
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.ok(text.includes("database_configuration_invalid"));
    assert.ok(!text.includes("fixture_password") && !text.includes("/private/key"));
  }
  assert.equal(poolOptions.length, 0);
});
test("malformed URLs, schema injection and invalid certificate input fail closed", async () => {
  for (const url of ["https://fixture_user:fixture_password@db.fixture.invalid/fixture", "postgresql://db.fixture.invalid/fixture", "postgresql://fixture_user:fixture_password@db.fixture.invalid/", "not-a-url"]) {
    environment.RULECRAFT_DATABASE_URL = url;
    assert.equal((await request("/api/official/status")).status, 503);
  }
  environment.RULECRAFT_DATABASE_URL = URL_FIXTURE;
  environment.RULECRAFT_DATABASE_VIEW = "public.documents; DROP TABLE private";
  assert.equal((await request("/api/official/status")).status, 503);
  delete environment.RULECRAFT_DATABASE_VIEW;
  environment.RULECRAFT_DATABASE_CA = "not-a-certificate";
  assert.equal((await request("/api/official/status")).status, 503);
  assert.equal(poolOptions.length, 0);
});
test("public endpoints reject mutations without opening a database connection", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const response = await request("/api/official/status", { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  }
  assert.equal(poolOptions.length, 0);
});
test("unsupported route and invalid query bounds are rejected locally", async () => {
  assert.equal((await request("/api/official/sync")).status, 404);
  for (const query of ["limit=0", "limit=51", "limit=-1", "offset=-1", "offset=1000001", "source=private", "q=" + "x".repeat(201), "limit=10&limit=20", "q=%00", "extra=secret"]) {
    assert.equal((await request(`/api/official/laws?${query}`)).status, 400, query);
  }
  assert.equal((await request("/api/official/document?source=law&law_id=x")).status, 400);
  assert.equal(poolOptions.length, 0);
});
test("search returns bounded metadata only and removes source URL credentials", async () => {
  const response = await request("/api/official/laws?q=공식&source=law&limit=10&offset=2");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.total, 1);
  assert.equal(payload.limit, 10);
  assert.equal(payload.offset, 2);
  assert.equal(payload.items[0].title, DOCUMENT.title);
  assert.equal(payload.items[0].raw_text, undefined);
  assert.equal(payload.items[0].source_url, "https://www.law.go.kr/법령/테스트?lsId=1".replace("법령", "%EB%B2%95%EB%A0%B9").replace("테스트", "%ED%85%8C%EC%8A%A4%ED%8A%B8"));
  assert.ok(!JSON.stringify(payload).includes("fixture-oc") && !JSON.stringify(payload).includes("fixture-token"));
});
test("search treats SQL and wildcard input as a literal parameter", async () => {
  const query = "100%_\\' OR TRUE --";
  const response = await request(`/api/official/laws?q=${encodeURIComponent(query)}`);
  assert.equal(response.status, 200);
  const searches = calls.filter((call) => /ILIKE/.test(call.sql));
  assert.equal(searches.length, 2);
  for (const call of searches) {
    assert.ok(!call.sql.includes(query));
    assert.equal(call.values[1], "%100\\%\\_\\\\' OR TRUE --%");
  }
});
test("empty source filter means all official source types", async () => {
  const response = await request("/api/official/laws?source=&q=");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 1);
});
test("document returns preserved text, hash and version identity", async () => {
  const response = await request("/api/official/document?source=law&law_id=law:sample&version_id=v1");
  assert.equal(response.status, 200);
  const { document } = await response.json();
  assert.equal(document.raw_text, DOCUMENT.raw_text);
  assert.equal(document.raw_sha256, SHA);
  assert.equal(document.version_id, "v1");
  assert.equal(document.stored_at, "2026-10-01T12:00:00.000Z");
  assert.equal(document.raw_bytes, undefined);
});
test("missing document returns 404 while a duplicate version identity exposes incompatible schema", async () => {
  respond = () => ({ rows: [] });
  assert.equal((await request("/api/official/document?source=law&law_id=missing&version_id=v1")).status, 404);
  respond = () => ({ rows: [structuredClone(DOCUMENT), structuredClone(DOCUMENT)] });
  const response = await request("/api/official/document?source=law&law_id=duplicate&version_id=v1");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).connection, "incompatible_schema");
  assert.equal(calls.at(-1).sql, "ROLLBACK");
});
test("oversized document is reported without transferring or truncating raw text", async () => {
  respond = () => ({ rows: [{ ...DOCUMENT, raw_bytes: "4000001", raw_text: null }] });
  const response = await request("/api/official/document?source=law&law_id=huge&version_id=v1");
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "document_too_large");
});
test("JSON escaping cannot exceed the platform response limit", async () => {
  const raw_text = '"'.repeat(2_100_000);
  respond = () => ({ rows: [{ ...DOCUMENT, raw_bytes: String(raw_text.length), raw_text }] });
  const response = await request("/api/official/document?source=law&law_id=escaped&version_id=v1");
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "document_too_large");
});
test("unsafe source URLs are omitted and PostgreSQL date objects are normalized", async () => {
  for (const source_url of ["javascript:alert(1)", "https://law.go.kr.evil.example/?OC=hidden", "https://private.example/internal", "https://user:password@law.go.kr/법령"]) {
    respond = (sql) => /COUNT\(\*\) AS total/.test(sql) ? { rows: [{ total: "1" }] }
      : { rows: [{ ...DOCUMENT, source_url, effective_date: new Date("2026-10-01T00:00:00Z") }] };
    const response = await request("/api/official/laws");
    const payload = await response.json();
    assert.equal(payload.items[0].source_url, null);
    assert.equal(payload.items[0].effective_date, "2026-10-01");
  }
});
test("calendar dates remain unchanged in a timezone ahead of UTC", async () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "Asia/Seoul";
    respond = (sql) => /COUNT\(\*\) AS total/.test(sql) ? { rows: [{ total: "1" }] }
      : { rows: [{ ...DOCUMENT, effective_date: new Date(2026, 9, 1) }] };
    const response = await request("/api/official/laws");
    assert.equal((await response.json()).items[0].effective_date, "2026-10-01");
    assert.ok(calls.some((call) => /effective_date::text AS effective_date/.test(call.sql)));
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
test("schema errors, unsafe counts and malformed metadata never become a connected state", async () => {
  respond = () => { throw Object.assign(new Error("secret SQL private_table fixture_password"), { code: "42703" }); };
  let response = await request("/api/official/status");
  assert.equal(response.status, 503);
  let text = await response.text();
  assert.ok(text.includes("incompatible_schema") && !text.includes("fixture_password") && !text.includes("private_table"));
  respond = () => ({ rows: [{ source: "law", stored_documents: "9007199254740992", stored_versions: "9007199254740992", last_stored_at: null }] });
  response = await request("/api/official/status");
  assert.equal((await response.json()).connection, "incompatible_schema");
  respond = () => ({ rows: [{ ...DOCUMENT, raw_sha256: "not-a-hash" }] });
  response = await request("/api/official/document?source=law&law_id=x&version_id=v1");
  assert.equal((await response.json()).connection, "incompatible_schema");
});
test("connection failures omit database credentials, hostnames and SQL details", async () => {
  connectError = new Error("cannot connect db.fixture.invalid fixture_password SELECT private.*");
  const response = await request("/api/official/status");
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.ok(text.includes("database_unavailable"));
  for (const secret of ["db.fixture.invalid", "fixture_password", "SELECT private"]) assert.ok(!text.includes(secret));
  assert.equal(calls.length, 0);
});
test("rewritten Vercel path reaches the same GET endpoint and HEAD has no response body", async () => {
  const response = await request("/api/official?route=laws&limit=1");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).limit, 1);
  const head = await request("/api/official/status", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
test("custom view identifiers remain quoted and the warm pool is reused", async () => {
  environment.RULECRAFT_DATABASE_VIEW = "official.safe_documents";
  await request("/api/official/status");
  await request("/api/official/laws");
  assert.equal(poolOptions.length, 1);
  assert.ok(calls.some((call) => call.sql.includes('"official"."safe_documents"')));
  assert.ok(calls.every((call) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/.test(call.sql)));
});
