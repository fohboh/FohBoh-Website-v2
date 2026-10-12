// Vercel function: /api/dataroom/<op>. All logic lives in api/_lib/dataroom/core.js.
import { createDataRoom } from "../_lib/dataroom/core.js";
import { makeStore } from "../_lib/dataroom/store.js";

const OPS = {
  status: "status", setup: "setup", login: "login", logout: "logout", room: "room", unlock: "unlock", open: "open",
  "admin-login": "adminLogin", "admin-me": "adminMe", "admin-grants": "adminGrants", "admin-grant": "adminGrant",
  "admin-revoke": "adminRevoke", "admin-log": "adminLog", "admin-docs": "adminDocs", "admin-upload-url": "adminUploadUrl",
  "admin-doc-add": "adminDocAdd", "admin-doc-remove": "adminDocRemove",
};

let handle;
function room() { if (!handle) handle = createDataRoom({ store: makeStore(process.env) }); return handle; }

function cookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}

async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  if (req.method !== "POST") return {};
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 64 * 1024) return {}; chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const name = req.query?.op || url.pathname.split("/").pop();
  const op = OPS[name];
  const query = Object.fromEntries(url.searchParams);
  const ctx = {
    method: req.method, contentType: req.headers["content-type"], origin: req.headers.origin, host: req.headers["x-forwarded-host"] || req.headers.host,
    ip: String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim(), ua: req.headers["user-agent"],
    cookies: cookies(req.headers.cookie), body: req.method === "POST" ? await body(req) : query,
  };
  const out = await room()(op || "__none__", ctx);
  res.statusCode = out.status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  if (out.text !== undefined) return res.end(out.text);
  if (out.json !== undefined) { res.setHeader("Content-Type", "application/json; charset=utf-8"); return res.end(JSON.stringify(out.json)); }
  res.end();
}
