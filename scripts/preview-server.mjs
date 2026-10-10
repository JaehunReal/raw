import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../frontend/dist");

// Load .gateway.env for token
const gatewayEnvPath = path.resolve(__dirname, "../../.gateway.env");
let gatewayToken = "";
if (fs.existsSync(gatewayEnvPath)) {
  for (const line of fs.readFileSync(gatewayEnvPath, "utf8").split("\n")) {
    const match = line.match(/^RULECRAFT_GATEWAY_TOKEN=(.*)$/);
    if (match) gatewayToken = match[1].trim();
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8799");

  if (url.pathname.startsWith("/api/official")) {
    const upstreamUrl = new URL(`http://127.0.0.1:8766${url.pathname}${url.search}`);
    try {
      const response = await fetch(upstreamUrl, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${gatewayToken}`,
          Accept: "application/json",
        },
      });
      res.statusCode = response.status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const data = await response.text();
      return res.end(data);
    } catch {
      res.statusCode = 503;
      return res.end(JSON.stringify({ code: "gateway_unavailable" }));
    }
  }

  // Practical workspace API routes
  if (url.pathname.startsWith("/api/")) {
    const snapshotPath = path.resolve(__dirname, "../frontend/src/preview-snapshot.json");
    let snapshot = { graph: { nodes: [], edges: [], issues: [] }, package_example: { documents: [] } };
    try {
      if (fs.existsSync(snapshotPath)) {
        snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      }
    } catch (e) {
      console.error("Failed to read snapshot:", e);
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (url.pathname === "/api/session") {
      res.statusCode = 200;
      return res.end(JSON.stringify({ authenticated: true }));
    }

    if (url.pathname === "/api/overview") {
      const allAgencies = Array.from(new Set(snapshot.graph.nodes.map((n) => n.agency)));
      const allRules = Array.from(new Set(snapshot.graph.nodes.map((n) => n.rule_name)));
      const formsCount = snapshot.graph.nodes.filter((n) => n.kind === "form").length;
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          stats: {
            nodes: snapshot.graph.nodes.length,
            edges: snapshot.graph.edges.length,
            agencies: allAgencies.length,
            rules: allRules.length,
            forms: formsCount,
            issues: 0,
            packages: 1,
          },
          readiness: {
            graph: {
              available: true,
              status: "ready",
              detail: `국가법령 및 실무규정 ${snapshot.graph.nodes.length}개 조문 (국가법령정보센터 실데이터 연계)`,
            },
            mcp: { status: "ready", detail: "MCP 브리지 활성화" },
          },
          recent_changes: snapshot.graph.nodes.slice(0, 8),
          agencies: allAgencies,
          rules: allRules,
          issues: [],
        })
      );
    }

    if (url.pathname === "/api/graph") {
      res.statusCode = 200;
      return res.end(JSON.stringify(snapshot.graph));
    }

    if (url.pathname === "/api/packages") {
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          packages: [
            {
              id: "pkg-2026-001",
              agency: "한국행정연구원",
              rule_name: "공공데이터 제공 및 이용 활성화에 관한 지침",
              amendment_type: "partial",
              created_at: "2026-10-09T14:00:00Z",
              documents: snapshot.package_example?.documents || [],
            },
          ],
        })
      );
    }

    if (url.pathname === "/api/articles") {
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          articles: snapshot.graph.nodes,
          total: snapshot.graph.nodes.length,
        })
      );
    }

    if (url.pathname === "/api/validate") {
      res.statusCode = 200;
      return res.end(JSON.stringify({ valid: true, issues: [] }));
    }

    if (url.pathname === "/api/impact") {
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          target_file_path: "한국행정연구원/지침/공공데이터제공지침.md",
          changed: true,
          impacted_nodes: [
            {
              id: "guideline-01",
              title: "공공데이터 제공 및 이용 활성화에 관한 지침 제7조",
              depth: 1,
            },
            {
              id: "form-01",
              title: "공공데이터 제공 신청서 (별지 제1호 서식)",
              depth: 2,
            },
            {
              id: "form-02",
              title: "데이터 반출 심의 의결서 (별지 제2호 서식)",
              depth: 2,
            },
          ],
          suggested_link_edits: [],
          issues: [],
          before: "",
          after: "",
        })
      );
    }
  }

  // Serve static files from dist
  let filePath = path.join(DIST, decodeURIComponent(url.pathname));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(DIST, "index.html");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    return fs.createReadStream(filePath).pipe(res);
  }

  res.statusCode = 404;
  res.end("Not Found");
});

server.listen(8799, "127.0.0.1", () => {
  console.log("Local preview server running at http://127.0.0.1:8799");
});
