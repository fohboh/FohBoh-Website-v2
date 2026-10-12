// FohBoh Data Room: every rule is enforced here, on the server. Pages only display what these operations return.
import { hashSecret, verifySecret, safeEqual, signSession, readSession, generatePassword, generatePin, newId, sha256Hex } from "./crypto.js";
import { ConflictError } from "./store.js";

export const FOLDERS = [
  { id: "01", title: "Corporate & Governance", desc: "Formation documents, bylaws, board consents.", restricted: false },
  { id: "02", title: "Company Overview", desc: "Investor deck, executive summary, product one-pagers.", restricted: false },
  { id: "03", title: "Product & Platform", desc: "Sentry, Cortex and MGE overviews and roadmap.", restricted: false },
  { id: "04", title: "Commercial", desc: "Pricing strategy and go-to-market plan.", restricted: false },
  { id: "05", title: "Team", desc: "Leadership biographies and organization.", restricted: false },
  { id: "06", title: "Market Opportunity & Tailwinds", desc: "Market sizing, industry trends, competitive landscape.", restricted: false },
  { id: "07", title: "Visual Explainers", desc: "Graphics showing what FohBoh does, how MGE works and the IP behind it.", restricted: false },
  { id: "08", title: "Partners, Pilots & Customers", desc: "Partner programs, pilot engagements and customer accounts.", restricted: false },
  { id: "09", title: "Financials & Cap Table", desc: "Statements, projections, capitalization.", restricted: true },
  { id: "10", title: "Intellectual Property", desc: "Patent filings and certification technology.", restricted: true },
  { id: "11", title: "Legal & Material Contracts", desc: "MSA, executed agreements, disclosures.", restricted: true },
];
const RESTRICTED = new Set(FOLDERS.filter((f) => f.restricted).map((f) => f.id));
const FOLDER_IDS = new Set(FOLDERS.map((f) => f.id));

const COOKIE = "dr_s";
const VISITOR_HOURS = 8, ADMIN_HOURS = 4;
const MAX_FAILS = 5, LOCK_MINUTES = 30;
const MAX_UPLOAD = 100 * 1024 * 1024;

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const clean = (s, n = 200) => String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
const DENIED = "Those details don't match our records.";

export function createDataRoom({ store, env = process.env, now = () => Date.now(), fetchImpl = globalThis.fetch }) {
  const secret = env.DATAROOM_SECRET;
  const MGE = String(env.DATAROOM_MGE_URL || "https://api-staging.fohboh.ai/mge/v1").replace(/\/$/, "");

  // "Certified by MGE" (DR-095): every figure shown is read from MGE itself; the seal is checked on MGE's public verify.
  async function mgeGet(pathname, withKey) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetchImpl(MGE + pathname, { headers: withKey ? { Authorization: `Bearer ${env.DATAROOM_MGE_READ_KEY}` } : {}, signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, json: j };
    } catch { return { ok: false, status: 0, json: {} }; } finally { clearTimeout(t); }
  }
  const verifyPath = (c) => `/vault/${encodeURIComponent(c.vaultId)}/verify?sha256_hash=${c.sha256}`;
  async function checkSeal(c) {
    const v = await mgeGet(verifyPath(c), false);
    return { reachable: v.status > 0, valid: !!v.json.valid, signatureValid: v.json.signature_valid ?? null, supersededBy: v.json.superseded_by ?? null, checkedAt: new Date(now()).toISOString() };
  }
  async function certs() { const r = await store.getJson("config/certified.json"); return { list: r.value?.records || [], etag: r.etag }; }
  const publicCert = (c) => ({ id: c.id, label: c.label, note: c.note, certRef: c.certRef, module: c.module, period: c.period, outcome: c.outcome, trustScore: c.trustScore, testRun: c.testRun, certifiedAt: c.certifiedAt, sha256: c.sha256, vaultId: c.vaultId, verifyUrl: MGE + verifyPath(c), lastCheck: c.lastCheck || null });

  async function log(ctx, event, fields = {}) {
    const t = new Date(now());
    const iso = t.toISOString();
    const rec = { at: iso, event, ip: ctx.ip || null, ua: clean(ctx.ua, 160) || null, ...fields };
    await store.putJson(`log/${iso.slice(0, 10)}/${iso}-${newId("e").slice(2)}.json`, rec, { ifNoneMatch: true });
  }

  // Failed-attempt lockout, per account (or per folder PIN). Counts survive across server instances.
  async function lockState(kind, id) {
    const key = `ratelimit/${sha256Hex(kind + ":" + id)}.json`;
    const { value, etag } = await store.getJson(key);
    const v = value || { fails: 0, until: 0 };
    return { key, etag, v, locked: v.until > now() };
  }
  async function noteFail(kind, id) {
    const s = await lockState(kind, id);
    const fails = s.v.until && s.v.until <= now() ? 1 : s.v.fails + 1;
    const until = fails >= MAX_FAILS ? now() + LOCK_MINUTES * 60000 : 0;
    try { await store.putJson(s.key, { fails: until ? 0 : fails, until }, { ifMatch: s.etag ?? undefined, ifNoneMatch: !s.etag }); } catch (e) { if (!(e instanceof ConflictError)) throw e; }
    return until > 0;
  }
  async function clearFails(kind, id) { const s = await lockState(kind, id); if (s.etag) await store.del(s.key); }

  async function grants() { const r = await store.getJson("config/grants.json"); return { list: r.value?.grants || [], etag: r.etag }; }
  async function saveGrants(list, etag) { await store.putJson("config/grants.json", { grants: list }, etag ? { ifMatch: etag } : { ifNoneMatch: true }); }
  async function manifest() { const r = await store.getJson("config/manifest.json"); return { docs: r.value?.docs || [], etag: r.etag }; }
  async function saveManifest(docs, etag) { await store.putJson("config/manifest.json", { docs }, etag ? { ifMatch: etag } : { ifNoneMatch: true }); }
  async function admin() { return (await store.getJson("config/admin.json")).value; }

  function cookieFor(payload) {
    const token = signSession(payload, secret);
    const maxAge = Math.floor((payload.exp - now()) / 1000);
    return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
  }
  const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

  async function visitor(ctx) {
    const s = readSession(ctx.cookies[COOKIE], secret, now());
    if (!s || s.t !== "v") fail(401, "SIGNED_OUT", "Please sign in.");
    const g = (await grants()).list.find((x) => x.id === s.sub);
    if (!g || g.status !== "active" || (g.expiresOn && g.expiresOn < new Date(now()).toISOString().slice(0, 10))) fail(401, "SIGNED_OUT", "Your access has ended.");
    return { s, g };
  }
  async function adminSession(ctx) {
    const s = readSession(ctx.cookies[COOKIE], secret, now());
    if (!s || s.t !== "a") fail(401, "SIGNED_OUT", "Administrator sign-in required.");
    const a = await admin();
    if (!a || norm(a.email) !== norm(s.email)) fail(401, "SIGNED_OUT", "Administrator sign-in required.");
    return { s, a };
  }

  const canOpen = (g, s, folder) => !RESTRICTED.has(folder) || (g.folders?.[folder] && (s.unl || []).includes(folder));

  const publicGrant = (g) => ({
    id: g.id, name: g.name, email: g.email, org: g.org || "", status: g.status, ndaSignedOn: g.ndaSignedOn || "",
    expiresOn: g.expiresOn || "", folders: Object.keys(g.folders || {}).sort(), createdAt: g.createdAt, updatedAt: g.updatedAt,
  });

  const ops = {
    // ---------- status ----------
    async status() { return { configured: true, setupNeeded: !(await admin()) }; },

    // ---------- first administrator (one time, needs the setup token) ----------
    async setup(ctx, b) {
      if (await admin()) fail(409, "ALREADY_SET_UP", "The data room already has an administrator.");
      if (!env.DATAROOM_SETUP_TOKEN || !safeEqual(b.token || "", env.DATAROOM_SETUP_TOKEN)) { await log(ctx, "setup_rejected"); fail(403, "BAD_TOKEN", "That setup token is not correct."); }
      if (!isEmail(b.email) || !clean(b.name)) fail(400, "INVALID", "Enter your name and email address.");
      if (String(b.password || "").length < 12) fail(400, "WEAK_PASSWORD", "Use a password of at least 12 characters.");
      const rec = { name: clean(b.name), email: clean(b.email).toLowerCase(), hash: await hashSecret(b.password), createdAt: new Date(now()).toISOString() };
      try { await store.putJson("config/admin.json", rec, { ifNoneMatch: true }); } catch (e) { if (e instanceof ConflictError) fail(409, "ALREADY_SET_UP", "The data room already has an administrator."); throw e; }
      await log(ctx, "admin_created", { email: rec.email, name: rec.name });
      return { ok: true };
    },

    // ---------- visitors ----------
    async login(ctx, b) {
      const email = norm(b.email);
      if (!b.ack) fail(400, "NDA_REQUIRED", "Confirm that you are party to an executed NDA.");
      if (!isEmail(email) || !b.password || !clean(b.name)) fail(400, "INVALID", "Enter your name, email address and password.");
      if ((await lockState("login", email)).locked) { await log(ctx, "login_locked", { email }); fail(429, "LOCKED", "Too many attempts. Try again in 30 minutes or contact Michael Atkinson."); }
      const g = (await grants()).list.find((x) => norm(x.email) === email);
      const okPass = await verifySecret(b.password, g?.hash);
      const today = new Date(now()).toISOString().slice(0, 10);
      const ok = g && okPass && g.status === "active" && norm(g.name) === norm(b.name) && !(g.expiresOn && g.expiresOn < today);
      if (!ok) {
        const locked = await noteFail("login", email);
        await log(ctx, "login_rejected", { email, name: clean(b.name), reason: !g ? "unknown email" : !okPass ? "wrong password" : g.status !== "active" ? "revoked" : norm(g.name) !== norm(b.name) ? "name mismatch" : "expired", locked });
        fail(401, "DENIED", DENIED);
      }
      await clearFails("login", email);
      await log(ctx, "signed_in", { email: g.email, name: g.name, grant: g.id, nda_acknowledged: true });
      return { ok: true, _cookie: cookieFor({ t: "v", sub: g.id, email: g.email, name: g.name, unl: [], exp: now() + VISITOR_HOURS * 3600000 }) };
    },

    async logout(ctx) {
      const s = readSession(ctx.cookies[COOKIE], secret, now());
      if (s) await log(ctx, "signed_out", { email: s.email, name: s.name });
      return { ok: true, _cookie: clearCookie };
    },

    async room(ctx) {
      const { s, g } = await visitor(ctx);
      const { docs } = await manifest();
      return {
        me: { name: g.name, email: g.email, org: g.org || "" },
        folders: FOLDERS.map((f) => {
          const granted = !f.restricted || !!g.folders?.[f.id];
          const open = canOpen(g, s, f.id);
          return {
            ...f, granted, unlocked: open,
            docs: open ? docs.filter((d) => d.folder === f.id).map((d) => ({ id: d.id, ref: d.ref, title: d.title, type: d.type, size: d.size, updatedOn: d.updatedOn })) : [],
            docCount: docs.filter((d) => d.folder === f.id).length,
          };
        }),
        certified: (await certs()).list.map(publicCert),
      };
    },

    async certCheck(ctx, b) {
      const { g } = await visitor(ctx);
      const c = (await certs()).list.find((x) => x.id === b.id);
      if (!c) fail(404, "NOT_FOUND", "Record not found.");
      const seal = await checkSeal(c);
      await log(ctx, "seal_checked", { email: g.email, name: g.name, title: c.certRef || c.vaultId, reason: seal.reachable ? (seal.valid ? "seal valid" : "seal NOT valid") : "MGE unreachable" });
      return { seal, verifyUrl: MGE + verifyPath(c) };
    },

    async unlock(ctx, b) {
      const { s, g } = await visitor(ctx);
      const folder = String(b.folder || "");
      if (!RESTRICTED.has(folder)) fail(400, "INVALID", "That folder doesn't need a PIN.");
      const lockId = `${g.id}:${folder}`;
      if ((await lockState("pin", lockId)).locked) { await log(ctx, "pin_locked", { email: g.email, name: g.name, folder }); fail(429, "LOCKED", "Too many attempts for this folder. Try again in 30 minutes."); }
      const ok = !!g.folders?.[folder] && await verifySecret(String(b.pin || ""), g.folders[folder].pinHash);
      if (!ok) {
        const locked = await noteFail("pin", lockId);
        await log(ctx, "pin_rejected", { email: g.email, name: g.name, folder, granted: !!g.folders?.[folder], locked });
        fail(401, "DENIED", "That PIN is not correct for this folder.");
      }
      await clearFails("pin", lockId);
      await log(ctx, "pin_accepted", { email: g.email, name: g.name, folder });
      const unl = Array.from(new Set([...(s.unl || []), folder]));
      return { ok: true, _cookie: cookieFor({ ...s, unl }) };
    },

    async open(ctx, b) {
      const { s, g } = await visitor(ctx);
      const d = (await manifest()).docs.find((x) => x.id === b.doc);
      if (!d) fail(404, "NOT_FOUND", "Document not found.");
      if (!canOpen(g, s, d.folder)) { await log(ctx, "open_refused", { email: g.email, name: g.name, folder: d.folder, doc: d.id, title: d.title }); fail(403, "LOCKED_FOLDER", "Enter this folder's PIN first."); }
      await log(ctx, "document_opened", { email: g.email, name: g.name, folder: d.folder, doc: d.id, title: d.title });
      return { _redirect: await store.downloadUrl(d.key, d.filename || d.title) };
    },

    // ---------- administrator ----------
    async adminLogin(ctx, b) {
      const email = norm(b.email);
      if ((await lockState("admin", email)).locked) { await log(ctx, "admin_login_locked", { email }); fail(429, "LOCKED", "Too many attempts. Try again in 30 minutes."); }
      const a = await admin();
      const ok = a && norm(a.email) === email && await verifySecret(b.password || "", a.hash);
      if (!ok) { const locked = await noteFail("admin", email); await log(ctx, "admin_login_rejected", { email, locked }); fail(401, "DENIED", DENIED); }
      await clearFails("admin", email);
      await log(ctx, "admin_signed_in", { email: a.email, name: a.name });
      return { ok: true, _cookie: cookieFor({ t: "a", email: a.email, name: a.name, exp: now() + ADMIN_HOURS * 3600000 }) };
    },

    async adminMe(ctx) { const { a } = await adminSession(ctx); return { name: a.name, email: a.email, folders: FOLDERS }; },

    async adminGrants(ctx) { await adminSession(ctx); return { grants: (await grants()).list.map(publicGrant) }; },

    // Create or update a visitor. Blank password/PIN fields are generated; values are returned once and never stored in clear.
    async adminGrant(ctx, b) {
      const { a } = await adminSession(ctx);
      const email = clean(b.email).toLowerCase();
      if (!isEmail(email) || !clean(b.name)) fail(400, "INVALID", "Enter the recipient's full legal name and email address.");
      const folders = Array.isArray(b.folders) ? b.folders.map(String).filter((f) => RESTRICTED.has(f)) : [];
      const pins = b.pins && typeof b.pins === "object" ? b.pins : {};
      for (const f of folders) if (pins[f] && !/^\d{6}$/.test(String(pins[f]))) fail(400, "INVALID_PIN", `The PIN for folder ${f} must be six digits.`);
      if (b.password && String(b.password).length < 10) fail(400, "WEAK_PASSWORD", "Use a password of at least 10 characters, or leave it blank to generate one.");
      const { list, etag } = await grants();
      let g = list.find((x) => norm(x.email) === email);
      const isNew = !g;
      const issued = { password: null, pins: {} };
      const ts = new Date(now()).toISOString();
      if (isNew) { g = { id: newId("g"), email, createdAt: ts, folders: {}, status: "active" }; list.push(g); }
      g.name = clean(b.name); g.org = clean(b.org); g.ndaSignedOn = clean(b.ndaSignedOn, 10); g.expiresOn = clean(b.expiresOn, 10); g.updatedAt = ts;
      if (b.reactivate) g.status = "active";
      if (isNew || b.resetPassword || b.password) { issued.password = b.password ? String(b.password) : generatePassword(); g.hash = await hashSecret(issued.password); }
      const nextFolders = {};
      for (const f of folders) {
        const resetThis = !g.folders?.[f] || (b.resetPins || []).includes(f) || pins[f];
        if (resetThis) { issued.pins[f] = pins[f] ? String(pins[f]) : generatePin(); nextFolders[f] = { pinHash: await hashSecret(issued.pins[f]), issuedAt: ts }; }
        else nextFolders[f] = g.folders[f];
      }
      g.folders = nextFolders;
      try { await saveGrants(list, etag); } catch (e) { if (e instanceof ConflictError) fail(409, "CONFLICT", "Someone else changed access at the same moment. Reload and try again."); throw e; }
      await log(ctx, isNew ? "access_granted" : "access_updated", { by: a.email, email: g.email, name: g.name, folders, password_issued: !!issued.password, pins_issued: Object.keys(issued.pins) });
      return { grant: publicGrant(g), issued };
    },

    async adminRevoke(ctx, b) {
      const { a } = await adminSession(ctx);
      const { list, etag } = await grants();
      const g = list.find((x) => x.id === b.id);
      if (!g) fail(404, "NOT_FOUND", "No such recipient.");
      g.status = "revoked"; g.updatedAt = new Date(now()).toISOString();
      await saveGrants(list, etag);
      await log(ctx, "access_revoked", { by: a.email, email: g.email, name: g.name });
      return { grant: publicGrant(g) };
    },

    async adminLog(ctx, b) {
      await adminSession(ctx);
      const days = Math.min(Math.max(parseInt(b.days || "30", 10) || 30, 1), 365);
      const out = [];
      for (let i = 0; i < days && out.length < 2000; i++) {
        const day = new Date(now() - i * 86400000).toISOString().slice(0, 10);
        const keys = (await store.list(`log/${day}/`)).reverse();
        for (const k of keys) { const v = (await store.getJson(k)).value; if (v) out.push(v); if (out.length >= 2000) break; }
      }
      if (b.format === "csv") {
        const cols = ["at", "event", "name", "email", "folder", "title", "ip", "ua", "reason", "by"];
        const esc = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        return { _csv: [cols.join(","), ...out.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") };
      }
      return { events: out };
    },

    async adminCerts(ctx) { await adminSession(ctx); return { records: (await certs()).list.map(publicCert), mge: MGE, keyConfigured: !!env.DATAROOM_MGE_READ_KEY }; },

    // Add a certified record by its vault id: the record is read from MGE with the data room's read key, then its seal is checked.
    async adminCertAdd(ctx, b) {
      const { a } = await adminSession(ctx);
      const vaultId = clean(b.vaultId, 80);
      if (!/^vr_[0-9a-f]{16,64}$/.test(vaultId)) fail(400, "INVALID", "Enter a vault id (it starts with vr_).");
      if (!env.DATAROOM_MGE_READ_KEY) fail(503, "NO_MGE_KEY", "The data room has no MGE read key yet (DATAROOM_MGE_READ_KEY).");
      const r = await mgeGet(`/vault/${encodeURIComponent(vaultId)}`, true);
      if (!r.ok) fail(r.status === 404 ? 404 : 502, "MGE", r.status === 404 ? "MGE has no record with that vault id for this key." : "MGE could not be reached or refused the request.");
      const v = r.json, m = v.certified_metrics || {};
      if (typeof m.trust_score !== "number" || !/^[0-9a-f]{64}$/.test(v.sha256_hash || "")) fail(502, "MGE", "MGE returned a record without a Trust Score or seal.");
      const c = {
        id: newId("cr"), vaultId, label: clean(b.label, 120), note: clean(b.note, 300), certRef: v.cert_ref || "", module: v.module_id || "",
        period: v.period_label || v.period || "", outcome: m.outcome || "", trustScore: m.trust_score, testRun: !!v.test_run,
        certifiedAt: v.certified_at || "", sha256: v.sha256_hash, addedAt: new Date(now()).toISOString(), addedBy: a.email,
      };
      c.lastCheck = await checkSeal(c);
      if (!c.lastCheck.valid) fail(422, "SEAL_INVALID", "MGE's public verify did not confirm this record's seal, so it was not added.");
      const { list, etag } = await certs();
      if (list.some((x) => x.vaultId === vaultId)) fail(409, "DUPLICATE", "That record is already shown.");
      list.push(c);
      await store.putJson("config/certified.json", { records: list }, etag ? { ifMatch: etag } : { ifNoneMatch: true });
      await log(ctx, "certified_record_added", { by: a.email, title: c.certRef || vaultId });
      return { record: publicCert(c) };
    },

    async adminCertRemove(ctx, b) {
      const { a } = await adminSession(ctx);
      const { list, etag } = await certs();
      const c = list.find((x) => x.id === b.id);
      if (!c) fail(404, "NOT_FOUND", "Record not found.");
      await store.putJson("config/certified.json", { records: list.filter((x) => x.id !== b.id) }, { ifMatch: etag });
      await log(ctx, "certified_record_removed", { by: a.email, title: c.certRef || c.vaultId });
      return { ok: true };
    },

    async adminDocs(ctx) { await adminSession(ctx); return { docs: (await manifest()).docs, folders: FOLDERS }; },

    async adminUploadUrl(ctx, b) {
      await adminSession(ctx);
      const folder = String(b.folder || "");
      if (!FOLDER_IDS.has(folder)) fail(400, "INVALID", "Choose a folder.");
      const size = Number(b.size || 0);
      if (!size || size > MAX_UPLOAD) fail(400, "TOO_LARGE", "Files up to 100 MB.");
      const filename = clean(b.filename, 120).replace(/[^\w.\- ]+/g, "_") || "document";
      const key = `docs/${folder}/${newId("d").slice(2)}-${filename}`;
      const contentType = clean(b.contentType, 100) || "application/octet-stream";
      return { key, uploadUrl: await store.uploadUrl(key, contentType), contentType };
    },

    async adminDocAdd(ctx, b) {
      const { a } = await adminSession(ctx);
      const folder = String(b.folder || "");
      const key = String(b.key || "");
      if (!FOLDER_IDS.has(folder) || !key.startsWith(`docs/${folder}/`) || key.includes("..")) fail(400, "INVALID", "Upload the file first.");
      if (!clean(b.title)) fail(400, "INVALID", "Give the document a title.");
      const { docs, etag } = await manifest();
      const n = docs.filter((d) => d.folder === folder).length + 1;
      const d = {
        id: newId("doc"), folder, ref: `${folder}.${String(n).padStart(2, "0")}`, title: clean(b.title), key,
        filename: clean(b.filename, 120) || clean(b.title), type: clean(b.type, 10).toUpperCase() || "FILE", size: Number(b.size || 0),
        updatedOn: clean(b.updatedOn, 10) || new Date(now()).toISOString().slice(0, 10), addedAt: new Date(now()).toISOString(), addedBy: a.email,
      };
      docs.push(d);
      try { await saveManifest(docs, etag); } catch (e) { if (e instanceof ConflictError) fail(409, "CONFLICT", "The document list changed at the same moment. Reload and try again."); throw e; }
      await log(ctx, "document_added", { by: a.email, folder, doc: d.id, title: d.title });
      return { doc: d };
    },

    async adminDocRemove(ctx, b) {
      const { a } = await adminSession(ctx);
      const { docs, etag } = await manifest();
      const d = docs.find((x) => x.id === b.id);
      if (!d) fail(404, "NOT_FOUND", "Document not found.");
      await saveManifest(docs.filter((x) => x.id !== b.id), etag);
      await store.del(d.key);
      await log(ctx, "document_removed", { by: a.email, folder: d.folder, doc: d.id, title: d.title });
      return { ok: true };
    },
  };

  const POST_OPS = new Set(["setup", "login", "logout", "unlock", "certCheck", "adminCertAdd", "adminCertRemove", "adminLogin", "adminGrant", "adminRevoke", "adminUploadUrl", "adminDocAdd", "adminDocRemove"]);

  return async function handle(op, ctx) {
    if (!store || !secret || secret.length < 32) return { status: 503, json: { error: { code: "NOT_CONFIGURED", message: "The data room is not configured yet." } } };
    const fn = Object.prototype.hasOwnProperty.call(ops, op) ? ops[op] : null;
    if (!fn) return { status: 404, json: { error: { code: "NOT_FOUND", message: "Unknown operation." } } };
    if (POST_OPS.has(op)) {
      if (ctx.method !== "POST") return { status: 405, json: { error: { code: "METHOD", message: "Use POST." } } };
      if (!String(ctx.contentType || "").startsWith("application/json")) return { status: 415, json: { error: { code: "JSON_ONLY", message: "JSON only." } } };
      if (ctx.origin && ctx.host && new URL(ctx.origin).host !== ctx.host) return { status: 403, json: { error: { code: "ORIGIN", message: "Cross-site request refused." } } };
    } else if (ctx.method !== "GET") return { status: 405, json: { error: { code: "METHOD", message: "Use GET." } } };
    try {
      const out = await fn(ctx, ctx.body || {});
      const headers = {};
      if (out._cookie) { headers["Set-Cookie"] = out._cookie; delete out._cookie; }
      if (out._redirect) return { status: 302, headers: { ...headers, Location: out._redirect } };
      if (out._csv) return { status: 200, headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="dataroom-access-log.csv"' }, text: out._csv };
      return { status: 200, headers, json: out };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, json: { error: { code: e.code, message: e.message } } };
      console.error(JSON.stringify({ type: "dataroom_error", op, error: e?.name || "Error" }));
      return { status: 500, json: { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } } };
    }
  };
}
