import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { CloudflareR2ReleaseStorage } from "../../lib/book-assets/cloudflare-r2-release-storage.js";
import manifest from "../../src/data/ultimate-b2/generated/students-book-page-assets.json" with { type: "json" };

export async function fullbookStorage(t, sourceStorage) {
  const directory = await mkdtemp(path.join(tmpdir(), "hhplms-fullbook-node-"));
  t.after(async () => { assert(directory.startsWith(path.join(tmpdir(), "hhplms-fullbook-node-"))); await rm(directory, { recursive: true }); });
  const metadata = new Map(); const pending = new Map();
  const counts = { put: 0, head: 0, get: 0, assetsFetch: 0, readbackBytes: 0, writes: 0, externalFetches: 0 };
  const file = (key) => path.join(directory, createHash("sha256").update(key).digest("hex"));
  const binding = {
    async put(key, bytes, options) {
      counts.put++; assert.deepEqual(options.onlyIf, { etagDoesNotMatch: "*" });
      if (pending.has(key)) await pending.get(key);
      if (metadata.has(key)) return null;
      const operation = writeFile(file(key), bytes, { flag: "wx" }).then(() => { metadata.set(key, { size: bytes.byteLength, httpMetadata: options.httpMetadata, customMetadata: options.customMetadata }); counts.writes++; });
      pending.set(key, operation); await operation; pending.delete(key);
      return metadata.get(key);
    },
    async head(key) { counts.head++; return metadata.get(key) || null; },
    async get(key) {
      counts.get++; const value = metadata.get(key); if (!value) return null;
      const bytes = await readFile(file(key)); counts.readbackBytes += bytes.length;
      return { ...value, body: new Response(bytes).body, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    },
  };
  const canonical = new CloudflareR2ReleaseStorage({ binding, privateBucket: "synthetic-private" });
  const isCanonical = (input) => input.objectKey.startsWith("builder-release-assets/ultimate-b2/ultimate-b2-students-book/");
  const storage = { ...sourceStorage,
    upload: (input) => isCanonical(input) ? canonical.upload(input) : sourceStorage.upload(input),
    head: (input) => isCanonical(input) ? canonical.head(input) : sourceStorage.head(input),
    openReadStream: async (input) => {
      if (!isCanonical(input)) return sourceStorage.openReadStream(input);
      const head = await canonical.head(input);
      return { ...head, contentRange: null, body: new Response(await canonical.download(input)).body };
    },
    download: (input) => isCanonical(input) ? canonical.download(input) : sourceStorage.download(input),
  };
  let failAt = 0; let onFetch = null;
  const fetchAsset = async (url) => {
    counts.assetsFetch++;
    if (onFetch) await onFetch(counts.assetsFetch);
    if (failAt && counts.assetsFetch === failAt) throw new Error("injected_local_materialization_failure");
    const match = manifest.pages.find((page) => url === `/page-library/ultimate-b2/ultimate-b2-students-book/${page.pageId}.png`);
    assert(match, "Only actual tracked manifest paths may be read");
    return new Response(await readFile(match.repositoryPath), { headers: { "Content-Type": match.mimeType } });
  };
  return { storage, counts, metadata, binding, fetchAsset, file, reset({ failure = 0, duringFetch = null } = {}) { Object.keys(counts).forEach((key) => { counts[key] = 0; }); failAt = failure; onFetch = duringFetch; } };
}
