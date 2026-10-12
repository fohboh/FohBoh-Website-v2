// Private storage for the data room: Amazon S3 in production, a local folder for tests and previews.
// Keys: config/admin.json · config/grants.json · config/manifest.json · docs/<folder>/<file> · log/<day>/<event> · ratelimit/<hash>
import { promises as fs } from "node:fs";
import path from "node:path";

export class ConflictError extends Error {}

export function makeStore(env = process.env) {
  if (env.DATAROOM_STORE_DIR) return new FsStore(env.DATAROOM_STORE_DIR);
  if (env.DATAROOM_S3_BUCKET) return new S3Store(env);
  return null;
}

class FsStore {
  constructor(root) { this.root = path.resolve(root); this.kind = "fs"; }
  p(key) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("bad key");
    return full;
  }
  async getJson(key) {
    try { const t = await fs.readFile(this.p(key), "utf8"); return { value: JSON.parse(t), etag: String(t.length) + ":" + hash(t) }; }
    catch (e) { if (e.code === "ENOENT") return { value: null, etag: null }; throw e; }
  }
  async putJson(key, value, { ifMatch, ifNoneMatch } = {}) {
    const cur = await this.getJson(key);
    if (ifNoneMatch && cur.value !== null) throw new ConflictError(key);
    if (ifMatch !== undefined && ifMatch !== null && cur.etag !== ifMatch) throw new ConflictError(key);
    await fs.mkdir(path.dirname(this.p(key)), { recursive: true });
    await fs.writeFile(this.p(key), JSON.stringify(value, null, 1));
  }
  async putBytes(key, buf) { await fs.mkdir(path.dirname(this.p(key)), { recursive: true }); await fs.writeFile(this.p(key), buf); }
  async getBytes(key) { return fs.readFile(this.p(key)); }
  async del(key) { await fs.rm(this.p(key), { force: true }); }
  async list(prefix) {
    const dir = this.p(prefix.replace(/\/$/, "") + "/.x").replace(/\/\.x$/, "");
    const out = [];
    const walk = async (d, rel) => {
      let ents = [];
      try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(d, e.name), r); else out.push(`${prefix.replace(/\/$/, "")}/${r}`);
      }
    };
    await walk(dir, "");
    return out.sort();
  }
  async downloadUrl(key, filename) { return `/api/dataroom/file?key=${encodeURIComponent(key)}&name=${encodeURIComponent(filename)}`; }
  async uploadUrl(key) { return `/api/dataroom/upload?key=${encodeURIComponent(key)}`; }
}

function hash(t) { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h; }

class S3Store {
  constructor(env) {
    this.kind = "s3";
    this.bucket = env.DATAROOM_S3_BUCKET;
    this.region = env.DATAROOM_S3_REGION || "us-east-1";
    this.creds = env.DATAROOM_AWS_ACCESS_KEY_ID
      ? { accessKeyId: env.DATAROOM_AWS_ACCESS_KEY_ID, secretAccessKey: env.DATAROOM_AWS_SECRET_ACCESS_KEY }
      : undefined;
  }
  async sdk() {
    if (!this._sdk) {
      const s3 = await import("@aws-sdk/client-s3");
      const presign = await import("@aws-sdk/s3-request-presigner");
      this._sdk = { ...s3, getSignedUrl: presign.getSignedUrl, client: new s3.S3Client({ region: this.region, credentials: this.creds }) };
    }
    return this._sdk;
  }
  async getJson(key) {
    const s = await this.sdk();
    try {
      const r = await s.client.send(new s.GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { value: JSON.parse(await r.Body.transformToString()), etag: r.ETag };
    } catch (e) { if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return { value: null, etag: null }; throw e; }
  }
  async putJson(key, value, { ifMatch, ifNoneMatch } = {}) {
    const s = await this.sdk();
    try {
      await s.client.send(new s.PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: JSON.stringify(value, null, 1), ContentType: "application/json",
        ...(ifMatch ? { IfMatch: ifMatch } : {}), ...(ifNoneMatch ? { IfNoneMatch: "*" } : {}),
      }));
    } catch (e) { if (e.$metadata?.httpStatusCode === 412 || e.$metadata?.httpStatusCode === 409) throw new ConflictError(key); throw e; }
  }
  async putBytes(key, buf, contentType = "application/octet-stream") {
    const s = await this.sdk();
    await s.client.send(new s.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: contentType }));
  }
  async del(key) { const s = await this.sdk(); await s.client.send(new s.DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async list(prefix) {
    const s = await this.sdk(); const out = []; let token;
    do {
      const r = await s.client.send(new s.ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents || []) out.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out.sort();
  }
  async downloadUrl(key, filename) {
    const s = await this.sdk();
    const safe = String(filename).replace(/[^\w.\- ]+/g, "_");
    return s.getSignedUrl(s.client, new s.GetObjectCommand({
      Bucket: this.bucket, Key: key, ResponseContentDisposition: `inline; filename="${safe}"`, ResponseCacheControl: "no-store",
    }), { expiresIn: 60 });
  }
  async uploadUrl(key, contentType) {
    const s = await this.sdk();
    return s.getSignedUrl(s.client, new s.PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn: 300 });
  }
}
