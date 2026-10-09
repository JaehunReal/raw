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
