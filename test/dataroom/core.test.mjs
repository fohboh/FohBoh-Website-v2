import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDataRoom } from "../../api/_lib/dataroom/core.js";
import { makeStore } from "../../api/_lib/dataroom/store.js";

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "dr-"));
  const env = { DATAROOM_STORE_DIR: dir, DATAROOM_SECRET: "x".repeat(40), DATAROOM_SETUP_TOKEN: "setup-token-123" };
  let t = Date.parse("2026-10-12T15:00:00Z");
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const store = makeStore(env);
  const handle = createDataRoom({ store, env, now: clock.now });
  const jar = { visitor: {}, admin: {} };
  const call = async (op, body, who = "visitor", method) => {
    const isPost = method ? method === "POST" : body !== undefined;
    const r = await handle(op, { method: isPost ? "POST" : "GET", contentType: "application/json", origin: "https://www.fohboh.ai", host: "www.fohboh.ai", ip: "203.0.113.9", ua: "test", cookies: jar[who], body: body || {} });
    const sc = r.headers?.["Set-Cookie"];
    if (sc) { const [kv] = sc.split(";"); const [k, v] = kv.split("="); if (v) jar[who][k] = v; else delete jar[who][k]; }
    return r;
  };
  return { dir, env, store, call, clock, jar };
}

async function withAdmin(s) {
  assert.equal((await s.call("setup", { token: "setup-token-123", name: "Michael Atkinson", email: "owner@example.com", password: "a-long-admin-pass" })).status, 200);
  assert.equal((await s.call("adminLogin", { email: "owner@example.com", password: "a-long-admin-pass" }, "admin")).status, 200);
}

test("not configured without a secret", async () => {
  const h = createDataRoom({ store: null, env: {} });
  assert.equal((await h("status", { method: "GET", cookies: {} })).status, 503);
});

test("setup is one time and needs the token", async () => {
  const s = setup();
  assert.equal((await s.call("setup", { token: "wrong", name: "A", email: "a@b.co", password: "123456789012" })).status, 403);
  assert.equal((await s.call("setup", { token: "setup-token-123", name: "A", email: "a@b.co", password: "short" })).status, 400);
  await withAdmin(s);
  assert.equal((await s.call("setup", { token: "setup-token-123", name: "B", email: "b@b.co", password: "123456789012" })).status, 409);
  assert.equal((await s.call("status")).json.setupNeeded, false);
});

test("full visitor journey: grant, sign in, open, PIN, revoke; everything logged", async () => {
  const s = setup();
  await withAdmin(s);
  // documents: one open, one restricted (file placed as if uploaded)
  for (const [folder, name] of [["02", "deck.pdf"], ["09", "cap.pdf"]]) {
    const up = await s.call("adminUploadUrl", { folder, filename: name, contentType: "application/pdf", size: 10 }, "admin");
    assert.equal(up.status, 200);
    mkdirSync(path.join(s.dir, path.dirname(up.json.key)), { recursive: true });
    writeFileSync(path.join(s.dir, up.json.key), "%PDF-1.4");
    assert.equal((await s.call("adminDocAdd", { folder, key: up.json.key, title: name, filename: name, type: "pdf", size: 10 }, "admin")).status, 200);
  }
  const g = await s.call("adminGrant", { name: "Jane Q Investor", email: "Jane@Fund.example", org: "Fund", ndaSignedOn: "2026-10-01", folders: ["09"], pins: { "09": "482913" } }, "admin");
  assert.equal(g.status, 200);
  const pw = g.json.issued.password;
  assert.match(pw, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  assert.equal(g.json.issued.pins["09"], "482913");
  assert.ok(!JSON.stringify((await s.call("adminGrants", undefined, "admin")).json).includes(pw), "no clear password in listings");

  // NDA acknowledgment and exact name are required
  assert.equal((await s.call("login", { name: "Jane Q Investor", email: "jane@fund.example", password: pw })).status, 400);
  assert.equal((await s.call("login", { name: "Jane Investor", email: "jane@fund.example", password: pw, ack: true })).status, 401);
  assert.equal((await s.call("login", { name: "  jane q  INVESTOR ", email: "JANE@fund.example", password: pw, ack: true })).status, 200);

  const room = (await s.call("room")).json;
  const f02 = room.folders.find((f) => f.id === "02"), f09 = room.folders.find((f) => f.id === "09"), f10 = room.folders.find((f) => f.id === "10");
  assert.equal(f02.docs.length, 1);
  assert.equal(f09.unlocked, false); assert.equal(f09.docs.length, 0); assert.equal(f09.granted, true);
  assert.equal(f10.granted, false);

  const restrictedDoc = (await s.call("adminDocs", undefined, "admin")).json.docs.find((d) => d.folder === "09");
  assert.equal((await s.call("open", { doc: restrictedDoc.id }, "visitor", "GET")).status, 403);
  assert.equal((await s.call("open", { doc: f02.docs[0].id }, "visitor", "GET")).status, 302);

  assert.equal((await s.call("unlock", { folder: "09", pin: "000000" })).status, 401);
  assert.equal((await s.call("unlock", { folder: "10", pin: "482913" })).status, 401, "PIN only for granted folders");
  assert.equal((await s.call("unlock", { folder: "09", pin: "482913" })).status, 200);
  assert.equal((await s.call("open", { doc: restrictedDoc.id }, "visitor", "GET")).status, 302);

  await s.call("adminRevoke", { id: g.json.grant.id }, "admin");
  assert.equal((await s.call("room")).status, 401, "revocation takes effect at once");

  const log = (await s.call("adminLog", undefined, "admin")).json.events.map((e) => e.event);
  for (const e of ["admin_created", "access_granted", "signed_in", "login_rejected", "document_opened", "open_refused", "pin_rejected", "pin_accepted", "access_revoked"]) assert.ok(log.includes(e), e);
  const csv = await s.call("adminLog", { format: "csv" }, "admin", "GET");
  assert.match(csv.headers["Content-Type"], /text\/csv/);
});

test("lockout after five wrong passwords, lifted after 30 minutes", async () => {
  const s = setup();
  await withAdmin(s);
  const g = await s.call("adminGrant", { name: "A B", email: "ab@x.example", password: "correct-horse-1" }, "admin");
  assert.equal(g.json.issued.password, "correct-horse-1");
  for (let i = 0; i < 5; i++) assert.equal((await s.call("login", { name: "A B", email: "ab@x.example", password: "nope", ack: true })).status, 401);
  assert.equal((await s.call("login", { name: "A B", email: "ab@x.example", password: "correct-horse-1", ack: true })).status, 429);
  s.clock.advance(31 * 60000);
  assert.equal((await s.call("login", { name: "A B", email: "ab@x.example", password: "correct-horse-1", ack: true })).status, 200);
});

test("visitors cannot use administrator operations; sessions expire; tampered cookies fail", async () => {
  const s = setup();
  await withAdmin(s);
  const g = await s.call("adminGrant", { name: "C D", email: "cd@x.example" }, "admin");
  await s.call("login", { name: "C D", email: "cd@x.example", password: g.json.issued.password, ack: true });
  assert.equal((await s.call("adminGrants")).status, 401);
  assert.equal((await s.call("adminGrant", { name: "E", email: "e@x.example" })).status, 401);
  const tampered = { dr_s: s.jar.visitor.dr_s.replace(/.$/, (c) => (c === "A" ? "B" : "A")) };
  s.jar.tamper = tampered;
  assert.equal((await s.call("room", undefined, "tamper")).status, 401);
  s.clock.advance(9 * 3600000);
  assert.equal((await s.call("room")).status, 401);
});

test("cross-site and non-JSON posts are refused", async () => {
  const s = setup();
  const h = createDataRoom({ store: s.store, env: s.env, now: s.clock.now });
  assert.equal((await h("login", { method: "POST", contentType: "application/json", origin: "https://evil.example", host: "www.fohboh.ai", cookies: {}, body: {} })).status, 403);
  assert.equal((await h("login", { method: "POST", contentType: "text/plain", cookies: {}, body: {} })).status, 415);
  assert.equal((await h("room", { method: "POST", contentType: "application/json", cookies: {}, body: {} })).status, 405);
});

test("PINs must be six digits; editing keeps existing PINs unless reset", async () => {
  const s = setup();
  await withAdmin(s);
  assert.equal((await s.call("adminGrant", { name: "F G", email: "fg@x.example", folders: ["10"], pins: { "10": "12ab" } }, "admin")).status, 400);
  const a = await s.call("adminGrant", { name: "F G", email: "fg@x.example", folders: ["10"] }, "admin");
  assert.match(a.json.issued.pins["10"], /^\d{6}$/);
  const b = await s.call("adminGrant", { name: "F G", email: "fg@x.example", folders: ["10", "11"] }, "admin");
  assert.equal(b.json.issued.password, null);
  assert.deepEqual(Object.keys(b.json.issued.pins), ["11"]);
  const c = await s.call("adminGrant", { name: "F G", email: "fg@x.example", folders: ["10", "11"], resetPins: ["10"] }, "admin");
  assert.deepEqual(Object.keys(c.json.issued.pins), ["10"]);
});

test("Certified by MGE: records come from MGE, seals are checked, invalid seals are refused (DR-095)", async () => {
  const s = setup();
  const sha = "a".repeat(64);
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, auth: opts?.headers?.Authorization || null });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (url.endsWith("/vault/vr_0123456789abcdef0123456789abcdef")) return ok({ vault_id: "vr_0123456789abcdef0123456789abcdef", cert_ref: "CRT-2026-0007", module_id: "M01", period_label: "June 2026", test_run: true, certified_at: "2026-10-01T00:00:00Z", sha256_hash: sha, certified_metrics: { trust_score: 91, outcome: "CERTIFIED" } });
    if (url.endsWith("/vault/vr_ffffffffffffffffffffffffffffffff")) return ok({ vault_id: "vr_ffffffffffffffffffffffffffffffff", sha256_hash: "b".repeat(64), certified_metrics: { trust_score: 50, outcome: "FAILED" } });
    if (url.includes("/verify?sha256_hash=" + sha)) return ok({ valid: true, signature_valid: true, superseded_by: null });
    if (url.includes("/verify?")) return ok({ valid: false, signature_valid: null, superseded_by: null });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const env = { ...s.env, DATAROOM_MGE_URL: "https://mge.example/mge/v1", DATAROOM_MGE_READ_KEY: "mge_read_sbx_test" };
  const h = createDataRoom({ store: s.store, env, now: s.clock.now, fetchImpl: fakeFetch });
  const jar = { v: {}, a: {} };
  const call = async (op, body, who) => {
    const r = await h(op, { method: body === undefined ? "GET" : "POST", contentType: "application/json", cookies: jar[who], body: body || {} });
    const sc = r.headers?.["Set-Cookie"]; if (sc) { const [kv] = sc.split(";"); const [k, v] = kv.split("="); jar[who][k] = v; }
    return r;
  };
  await call("setup", { token: "setup-token-123", name: "M A", email: "owner@example.com", password: "a-long-admin-pass" }, "a");
  await call("adminLogin", { email: "owner@example.com", password: "a-long-admin-pass" }, "a");
  assert.equal((await call("adminCertAdd", { vaultId: "not-an-id" }, "a")).status, 400);
  assert.equal((await call("adminCertAdd", { vaultId: "vr_ffffffffffffffffffffffffffffffff" }, "a")).status, 422, "seal not confirmed → refused");
  const added = await call("adminCertAdd", { vaultId: "vr_0123456789abcdef0123456789abcdef", label: "M01 pilot" }, "a");
  assert.equal(added.status, 200);
  assert.equal(added.json.record.trustScore, 91);
  assert.equal(added.json.record.testRun, true);
  assert.ok(calls.some((c) => c.auth === "Bearer mge_read_sbx_test" && !c.url.includes("/verify")), "record read with the read key");
  assert.ok(calls.filter((c) => c.url.includes("/verify")).every((c) => c.auth === null), "public verify uses no key");
  const g = await call("adminGrant", { name: "V W", email: "vw@x.example" }, "a");
  await call("login", { name: "V W", email: "vw@x.example", password: g.json.issued.password, ack: true }, "v");
  const room = (await call("room", undefined, "v")).json;
  assert.equal(room.certified.length, 1);
  assert.equal(room.certified[0].verifyUrl, `https://mge.example/mge/v1/vault/vr_0123456789abcdef0123456789abcdef/verify?sha256_hash=${sha}`);
  const chk = await call("certCheck", { id: room.certified[0].id }, "v");
  assert.equal(chk.json.seal.valid, true);
  assert.ok(!JSON.stringify(room).includes("mge_read_sbx_test"), "key never reaches the visitor");
});

test("link entries: https only, import checks every line, open logs and redirects", async () => {
  const s = setup();
  await withAdmin(s);
  assert.equal((await s.call("adminLinkAdd", { folder: "02", title: "Deck", url: "http://example.com/" }, "admin")).status, 400);
  assert.equal((await s.call("adminLinkAdd", { folder: "02", title: "Deck", url: "javascript:alert(1)" }, "admin")).status, 400);
  assert.equal((await s.call("adminLinkAdd", { folder: "02", title: "Deck", url: "https://u:p@example.com/" }, "admin")).status, 400);
  const one = await s.call("adminLinkAdd", { folder: "02", title: "Investor deck", url: "https://deck.example.com/" }, "admin");
  assert.equal(one.status, 200);
  assert.equal(one.json.doc.ref, "02.01");
  // a bad line rejects the whole import
  const bad = await s.call("adminLinksImport", { text: "03 | Brief | https://brief.example.com/\n99 | Nowhere | https://x.example.com/" }, "admin");
  assert.equal(bad.status, 400);
  assert.match(bad.json.error.message, /Line 2/);
  assert.equal((await s.call("adminDocs", undefined, "admin")).json.docs.length, 1);
  const dup = await s.call("adminLinksImport", { text: "02 | Again | https://deck.example.com/" }, "admin");
  assert.equal(dup.status, 409);
  const ok = await s.call("adminLinksImport", { text: "# investor links\n3 | Brief | https://brief.example.com/\n07 | Graphic | https://graphic.example.com/a?b=1\n" }, "admin");
  assert.equal(ok.status, 200);
  assert.equal(ok.json.added, 2);
  assert.equal(ok.json.docs[0].folder, "03");
  // restricted folder links still need the PIN
  await s.call("adminLinksImport", { text: "10 | Patent summary | https://ip.example.com/" }, "admin");
  const g = await s.call("adminGrant", { name: "Jane Q Investor", email: "jane@fund.example", folders: [] }, "admin");
  assert.equal((await s.call("login", { name: "Jane Q Investor", email: "jane@fund.example", password: g.json.issued.password, ack: true })).status, 200);
  const room = (await s.call("room")).json;
  const link = room.folders.find((f) => f.id === "03").docs[0];
  assert.equal(link.kind, "link");
  assert.equal(room.folders.find((f) => f.id === "10").docs.length, 0);
  const r = await s.call("open", { doc: link.id }, "visitor", "GET");
  assert.equal(r.status, 302);
  assert.equal(r.headers.Location, "https://brief.example.com/");
  const ipDoc = (await s.call("adminDocs", undefined, "admin")).json.docs.find((d) => d.folder === "10");
  assert.equal((await s.call("open", { doc: ipDoc.id }, "visitor", "GET")).status, 403);
  const events = (await s.call("adminLog", undefined, "admin")).json.events.map((e) => e.event);
  assert.ok(events.includes("link_opened"));
  assert.equal(events.filter((e) => e === "link_added").length, 4);
  // removing a link never touches storage
  assert.equal((await s.call("adminDocRemove", { id: link.id }, "admin")).status, 200);
});
