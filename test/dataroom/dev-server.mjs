// Local preview of the data room: static pages + the real API handler on a local folder store (no AWS).
// Usage: DATAROOM_STORE_DIR=/tmp/dr DATAROOM_SECRET=$(openssl rand -hex 32) DATAROOM_SETUP_TOKEN=local node test/dataroom/dev-server.mjs
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../../api/dataroom/[op].js";
import { makeStore } from "../../api/_lib/dataroom/store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT || 4173);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".pdf": "application/pdf", ".svg": "image/svg+xml", ".png": "image/png" };
const store = makeStore(process.env);

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    // Local stand-ins for S3's signed download and upload links (never deployed).
    if (url.pathname === "/api/dataroom/file") {
      const buf = await store.getBytes(url.searchParams.get("key"));
      res.writeHead(200, { "Content-Type": TYPES[path.extname(url.searchParams.get("name") || "")] || "application/octet-stream" });
      return res.end(buf);
    }
    if (url.pathname === "/api/dataroom/upload" && req.method === "PUT") {
      const chunks = []; for await (const c of req) chunks.push(c);
      await store.putBytes(url.searchParams.get("key"), Buffer.concat(chunks));
      res.writeHead(200); return res.end();
    }
    // Optional stand-in for MGE (DEV_MOCK_MGE=1): one synthetic sandbox record, for previews only.
    if (process.env.DEV_MOCK_MGE && url.pathname.startsWith("/mock-mge/")) {
      const sha = "3f9a".padEnd(64, "0");
      res.writeHead(200, { "Content-Type": "application/json" });
      if (url.pathname.endsWith("/verify")) return res.end(JSON.stringify({ valid: url.searchParams.get("sha256_hash") === sha, signature_valid: true, superseded_by: null }));
      return res.end(JSON.stringify({ vault_id: url.pathname.split("/").pop(), cert_ref: "CRT-2026-0001", module_id: "M01", period_label: "Synthetic sample · June 2026", test_run: true, certified_at: "2026-10-01T12:00:00Z", sha256_hash: sha, certified_metrics: { trust_score: 92, outcome: "CERTIFIED" } }));
    }
    if (url.pathname.startsWith("/api/dataroom/")) {
      req.query = { op: url.pathname.split("/").pop() };
      req.headers["x-forwarded-for"] = req.socket.remoteAddress;
      return handler(req, res);
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, "index.html"); const buf = await fs.readFile(file); res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); res.end(buf); }
    catch { res.writeHead(404); res.end("Not found"); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) createServer().listen(PORT, () => console.log(`data room preview on http://localhost:${PORT}/dataroom/`));
