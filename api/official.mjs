import pg from "pg";

const SOURCES = ["law", "administrative", "ordinance"];
// Cast date-only values in SQL so node-postgres cannot shift their calendar
// day when the function and database use different time zones.
const COLUMNS = "source, law_id, version_id, title, effective_date::text AS effective_date, publication_date::text AS publication_date, source_url, raw_sha256, stored_at";
const MAX_DOCUMENT_BYTES = 4_000_000;
const PUBLIC_SOURCE_PARAMETERS = new Set(["id", "mst", "lsid", "lsiseq", "efyd", "ancyd", "ancno", "lmsid", "lmseq", "chrclscd", "lsclscd", "target", "type", "query", "jono", "pno"]);
class ConfigurationError extends Error {}
class SchemaError extends Error {}

function databaseConfiguration(environment) {
  const supplied = environment.RULECRAFT_DATABASE_URL || environment.DATABASE_URL;
  if (!supplied) return null;
  let url;
  try { url = new URL(supplied); } catch { throw new ConfigurationError(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username
    || !url.password || url.pathname === "/" || url.hash) throw new ConfigurationError();
  // Explicit options avoid connectionString parameters replacing verified TLS.
  for (const [key, value] of url.searchParams) {
    if (key === "sslmode" && value === "verify-full") continue;
    if (key === "ssl" && value === "true") continue;
    if (["application_name", "connect_timeout"].includes(key)) continue;
    throw new ConfigurationError();
  }
  const view = environment.RULECRAFT_DATABASE_VIEW || "public.rulecraft_official_documents";
  if (!/^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$/.test(view)) throw new ConfigurationError();
  const relation = view.split(".").map((part) => `"${part}"`).join(".");
  const ca = environment.RULECRAFT_DATABASE_CA;
  if (ca && (ca.length > 100_000 || !ca.includes("-----BEGIN CERTIFICATE-----"))) throw new ConfigurationError();
  let user, password, database;
  try {
    user = decodeURIComponent(url.username); password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch { throw new ConfigurationError(); }
  if (!user || !password || !database || database.includes("\0")) throw new ConfigurationError();
  return { relation, options: {
    host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port ? Number(url.port) : 5432,
    user, password, database, ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000,
    query_timeout: 7_000, statement_timeout: 5_000, lock_timeout: 1_000,
    application_name: "rulecraft-public-readonly", allowExitOnIdle: true, maxUses: 50,
  } };
}
function json(res, status, value, head = false) {
  let serialized = JSON.stringify(value);
  // Vercel also limits the serialized response, which can exceed raw_text size
  // when JSON escaping expands quotes, slashes, or control characters.
  if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_BYTES) {
    status = 413;
    serialized = JSON.stringify({ code: "document_too_large", detail: "이 원문은 웹 조회 용량을 초과합니다." });
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(head ? undefined : serialized);
}
function safeCount(value) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) throw new SchemaError();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new SchemaError();
  return number;
}
function safeText(value, maximum, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) throw new SchemaError();
  return value;
}
function publicSourceUrl(value) {
  if (value === null) return null;
  safeText(value, 4000);
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
      || !(url.hostname === "law.go.kr" || url.hostname.endsWith(".law.go.kr"))) return null;
    url.protocol = "https:";
    for (const key of [...url.searchParams.keys()]) {
      if (!PUBLIC_SOURCE_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
function metadata(row) {
  if (!SOURCES.includes(row.source)) throw new SchemaError();
  const result = {
    source: row.source, law_id: safeText(row.law_id, 200), version_id: safeText(row.version_id, 200),
    title: safeText(row.title, 2000), effective_date: dateText(row.effective_date),
    publication_date: dateText(row.publication_date), source_url: publicSourceUrl(row.source_url),
    raw_sha256: safeText(row.raw_sha256, 64), stored_at: null,
  };
  if (!/^[a-f0-9]{64}$/i.test(result.raw_sha256)) throw new SchemaError();
  result.stored_at = timestamp(row.stored_at);
  return result;
}
function dateText(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new SchemaError();
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return safeText(value, 100, true);
}
function timestamp(value) {
  if (value === null) return null;
  if (!(value instanceof Date) && typeof value !== "string") throw new SchemaError();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new SchemaError();
  return date.toISOString();
}
function requestParameters(req) {
  const url = new URL(req.url, "https://official.invalid");
  const rewritten = req.query?.route ?? url.searchParams.get("route");
  if (Array.isArray(rewritten) || url.searchParams.getAll("route").length > 1) throw new TypeError();
  const route = rewritten ?? url.pathname.replace(/^\/api\/official\/?/, "");
  if (!["status", "laws", "document", "graph"].includes(route)) return { route: null };
  url.searchParams.delete("route");
  const allowed = route === "laws" ? ["q", "source", "limit", "offset"]
    : ["document", "graph"].includes(route) ? ["source", "law_id", "version_id"] : [];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new TypeError();
  }
  const source = url.searchParams.get("source") || null;
  if (source !== null && !SOURCES.includes(source)) throw new TypeError();
  if (["document", "graph"].includes(route)) {
    const lawId = url.searchParams.get("law_id"), versionId = url.searchParams.get("version_id");
    if (!source || !lawId || !versionId || lawId.length > 200 || versionId.length > 200
      || /[\x00-\x1f\x7f]/.test(lawId + versionId)) throw new TypeError();
    return { route, source, lawId, versionId };
  }
  if (route === "laws") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length > 200 || /[\x00-\x1f\x7f]/.test(q)) throw new TypeError();
    const limitText = url.searchParams.get("limit") ?? "20", offsetText = url.searchParams.get("offset") ?? "0";
    if (!/^\d{1,2}$/.test(limitText) || !/^\d{1,7}$/.test(offsetText)) throw new TypeError();
    const limit = Number(limitText), offset = Number(offsetText);
    if (limit < 1 || limit > 50 || offset > 1_000_000) throw new TypeError();
    return { route, source, q, limit, offset };
  }
  return { route };
}
function disconnected(connection, code, detail) {
  return { storage: "postgresql", connection, code, detail, checked_at: new Date().toISOString() };
}

export function createOfficialHandler({ environment = () => process.env, createPool = (options) => new pg.Pool(options) } = {}) {
  let cachedPool, cachedKey;
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return json(res, 405, { code: "method_not_allowed", detail: "조회 요청만 지원합니다." });
    }
    const head = req.method === "HEAD";
    let parameters;
    try { parameters = requestParameters(req); }
    catch { return json(res, 400, { code: "invalid_request", detail: "조회 조건을 확인해 주세요." }, head); }
    if (!parameters.route) return json(res, 404, { code: "route_not_found", detail: "지원하지 않는 조회 경로입니다." }, head);
    const env = environment();
    if (env.RULECRAFT_OFFICIAL_GATEWAY_URL) {
      try {
        const upstream = new URL(env.RULECRAFT_OFFICIAL_GATEWAY_URL);
        if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash
          || !env.RULECRAFT_GATEWAY_TOKEN) throw new Error('invalid_gateway');
        upstream.pathname = `/api/official/${parameters.route}`;
        upstream.search = new URL(req.url, 'https://local.invalid').search;
        upstream.searchParams.delete('route');
        const response = await fetch(upstream, {method:'GET', redirect:'error',
          headers:{Authorization:`Bearer ${env.RULECRAFT_GATEWAY_TOKEN}`},signal:AbortSignal.timeout(10000)});
        const reader = response.body.getReader(); let length=0; const chunks=[];
        while (true) {const {done,value}=await reader.read();if(done)break;length+=value.length;
          if(length>MAX_DOCUMENT_BYTES){await reader.cancel();throw new Error('oversize');} chunks.push(Buffer.from(value));}
        return json(res,response.status,JSON.parse(Buffer.concat(chunks).toString('utf8')),head);
      } catch {return json(res,503,disconnected('unavailable','gateway_unavailable','맥의 법령 조회 서버에 연결하지 못했습니다.'),head);}
    }
    let configuration;
    try { configuration = databaseConfiguration(environment()); }
    catch { return json(res, 503, disconnected("unavailable", "database_configuration_invalid", "데이터베이스의 보안 연결 설정을 확인해 주세요."), head); }
    if (!configuration) return json(res, parameters.route === "status" ? 200 : 503,
      disconnected("not_configured", "database_not_configured", "데이터베이스 연결 정보가 아직 설정되지 않았습니다."), head);
    let client, transaction = false;
    try {
      const key = JSON.stringify(configuration);
      if (key !== cachedKey) {
        const previous = cachedPool;
        cachedPool = createPool(configuration.options); cachedKey = key;
        cachedPool.on?.("error", () => { /* Do not log database hostnames, SQL, or credentials. */ });
        if (previous) void previous.end().catch(() => {});
      }
      client = await cachedPool.connect();
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); transaction = true;
      const relation = configuration.relation;
      await client.query(`SELECT ${COLUMNS}, raw_text FROM ${relation} LIMIT 0`);
      let payload, status = 200;
      if (parameters.route === "status") {
        const result = await client.query(
          `SELECT source, COUNT(DISTINCT law_id) AS stored_documents, COUNT(*) AS stored_versions, MAX(stored_at) AS last_stored_at FROM ${relation} WHERE source = ANY($1::text[]) GROUP BY source`, [SOURCES]);
        const counts = new Map();
        for (const row of result.rows) {
          if (!SOURCES.includes(row.source) || counts.has(row.source)) throw new SchemaError();
          const storedDocuments = safeCount(row.stored_documents), storedVersions = safeCount(row.stored_versions);
          if (storedVersions < storedDocuments) throw new SchemaError();
          counts.set(row.source, { source: row.source, stored_documents: storedDocuments, stored_versions: storedVersions, last_stored_at: timestamp(row.last_stored_at) });
        }
        const sources = SOURCES.map((source) => counts.get(source) || { source, stored_documents: 0, stored_versions: 0, last_stored_at: null });
        const totals = { stored_documents: 0, stored_versions: 0, last_stored_at: null };
        for (const source of sources) {
          totals.stored_documents = safeCount(totals.stored_documents + source.stored_documents);
          totals.stored_versions = safeCount(totals.stored_versions + source.stored_versions);
          if (source.last_stored_at && (!totals.last_stored_at || source.last_stored_at > totals.last_stored_at)) totals.last_stored_at = source.last_stored_at;
        }
        payload = { storage: "postgresql", connection: "connected", checked_at: new Date().toISOString(), totals, sources };
      } else if (parameters.route === "laws") {
        const values = [SOURCES]; let where = "source = ANY($1::text[])";
        if (parameters.source) { values.push(parameters.source); where += ` AND source = $${values.length}`; }
        if (parameters.q) {
          values.push(`%${parameters.q.replace(/[\\%_]/g, "\\$&")}%`);
          where += ` AND title ILIKE $${values.length} ESCAPE E'\\\\'`;
        }
        const count = await client.query(`SELECT COUNT(*) AS total FROM ${relation} WHERE ${where}`, values);
        const total = safeCount(count.rows[0]?.total); values.push(parameters.limit, parameters.offset);
        const result = await client.query(`SELECT ${COLUMNS} FROM ${relation} WHERE ${where} ORDER BY title, source, law_id, version_id LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
        if (result.rows.length > parameters.limit) throw new SchemaError();
        payload = { items: result.rows.map(metadata), total, limit: parameters.limit, offset: parameters.offset };
      } else if (parameters.route === "graph") {
        const roots = await client.query(`SELECT ${COLUMNS} FROM ${relation} WHERE source=$1 AND law_id=$2 AND version_id=$3`, [parameters.source,parameters.lawId,parameters.versionId]);
        if (!roots.rows.length) return json(res,404,{code:'document_not_found'},head);
        const found = await client.query(`SELECT * FROM public.rulecraft_official_relations WHERE (source=$1 AND law_id=$2 AND version_id=$3) OR (target_source=$1 AND target_law_id=$2) ORDER BY (kind='implementation_basis') DESC,(source=$1 AND law_id=$2 AND version_id=$3) DESC,source,law_id,version_id DESC LIMIT 61`,[parameters.source,parameters.lawId,parameters.versionId]);
        const root=metadata(roots.rows[0]); const nodes=[root],edges=[],seen=new Set();
        for (const edge of found.rows.slice(0,60)) {
          const outgoing=edge.source===root.source && edge.law_id===root.law_id;
          const source=outgoing?edge.target_source:edge.source, id=outgoing?edge.target_law_id:edge.law_id;
          const key=source+':'+id;if(seen.has(key))continue;
          const related=await client.query(`SELECT ${COLUMNS} FROM ${relation} WHERE source=$1 AND law_id=$2 ${outgoing?'':'AND version_id=$3'} ORDER BY stored_at DESC,version_id DESC LIMIT 1`,outgoing?[source,id]:[source,id,edge.version_id]);
          if(!related.rows.length)continue;
          seen.add(key);const node=metadata(related.rows[0]);nodes.push(node);
          edges.push({from:outgoing?root.law_id:node.law_id,to:outgoing?node.law_id:root.law_id,kind:edge.kind,evidence:edge.evidence,source_version_id:edge.version_id,source_sha256:edge.source_sha256});
        }
        payload={root:root.law_id,nodes,edges,truncated:found.rows.length>60,notice:'원문에 명시된 법령명 인용 관계입니다. 시행 근거는 법령명과 원문 인용이 함께 확인된 경우에 표시합니다. 인용만으로 상하위·위임 관계를 확정하지 않습니다. 연결 대상 버전의 동시 효력은 별도 확인이 필요합니다.'};
      } else {
        const result = await client.query(
          `SELECT ${COLUMNS}, provisions_json, octet_length(raw_text) AS raw_bytes, CASE WHEN octet_length(raw_text) <= $4 THEN raw_text ELSE NULL END AS raw_text FROM ${relation} WHERE source = $1 AND law_id = $2 AND version_id = $3 LIMIT 2`,
          [parameters.source, parameters.lawId, parameters.versionId, MAX_DOCUMENT_BYTES]);
        if (result.rows.length > 1) throw new SchemaError();
        if (!result.rows.length) { status = 404; payload = { code: "document_not_found", detail: "저장된 원문을 찾을 수 없습니다." }; }
        else {
          const row = result.rows[0];
          if (safeCount(row.raw_bytes) > MAX_DOCUMENT_BYTES) { status = 413; payload = { code: "document_too_large", detail: "이 원문은 웹 조회 용량을 초과합니다." }; }
          else payload = { document: { ...metadata(row), raw_text: safeText(row.raw_text, MAX_DOCUMENT_BYTES), provisions: row.provisions_json ? JSON.parse(row.provisions_json) : [] } };
        }
      }
      await client.query("COMMIT"); transaction = false;
      return json(res, status, payload, head);
    } catch (error) {
      const incompatible = error instanceof SchemaError || ["42P01", "42703", "42883", "42804"].includes(error?.code);
      return json(res, 503, disconnected(incompatible ? "incompatible_schema" : "unavailable",
        incompatible ? "database_schema_incompatible" : "database_unavailable",
        incompatible ? "공식 법령 조회 스키마를 확인해 주세요." : "데이터베이스에 연결하지 못했습니다. 연결 상태를 확인해 주세요."), head);
    } finally {
      if (client) {
        let releaseError;
        if (transaction) { try { await client.query("ROLLBACK"); } catch (error) { releaseError = error; } }
        client.release(releaseError);
      }
    }
  };
}
export default createOfficialHandler();
