// Password and PIN hashing, signed session cookies. Node built-ins only.
import { createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const N = 32768, R = 8, P = 1, KEYLEN = 32;

export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const key = await scrypt(String(secret), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifySecret(secret, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    // Burn comparable time so an unknown account is not distinguishable by timing.
    await scrypt(String(secret), "dummy-salt-dummy", KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
    return false;
  }
  const [, n, r, p, salt, key] = parts;
  const want = Buffer.from(key, "base64");
  const got = await scrypt(String(secret), Buffer.from(salt, "base64"), want.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function safeEqual(a, b) {
  const x = createHash("sha256").update(String(a)).digest();
  const y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function signSession(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readSession(token, secret, now = Date.now()) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const want = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || p.exp < now) return null;
    return p;
  } catch { return null; }
}

// Generated credentials: no look-alike characters (0/O, 1/l/I).
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function generatePassword() {
  const groups = [];
  for (let g = 0; g < 3; g++) { let s = ""; for (let i = 0; i < 4; i++) s += ALPHA[randomInt(ALPHA.length)]; groups.push(s); }
  return groups.join("-");
}
export function generatePin() { return String(randomInt(0, 1000000)).padStart(6, "0"); }
export function newId(prefix) { return `${prefix}_${randomBytes(8).toString("hex")}`; }
export function sha256Hex(s) { return createHash("sha256").update(String(s)).digest("hex"); }
