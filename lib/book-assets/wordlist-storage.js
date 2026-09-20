import { createHash } from "node:crypto";
import { CloudflareR2ReleaseStorage } from "./cloudflare-r2-release-storage.js";
import { createBookAssetStorage } from "./storage.js";
import { validateObjectKey } from "./object-keys.js";
import { WORDLIST_LIMITS, reject } from "../../src/data/wordlists/portable.js";

export class WordListR2Storage extends CloudflareR2ReleaseStorage {
  constructor(options) { super(options); this.publicUiBinding = options.publicUiBinding; }
  async download({ profile, objectKey }) {
    if (profile === "public") {
      if (!/^publishers\/hamilton-house\/books\/(ultimate-b2|ultimate-b1|ultimate-b1-plus)\/editions\/students-book\/versions\/hosted-draft\/components\/\1-students-book\/teacher-ui\/assets\/[a-f0-9]{64}\.(png|jpg|webp|mp3|wav|gaf)$/.test(objectKey)) reject("wordlist_ui_asset_scope");
      const object = await this.publicUiBinding?.get(objectKey);
      if (!object?.body || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > 16 * 1024 * 1024) { await object?.body?.cancel(); reject("wordlist_ui_asset_limit"); }
      const reader = object.body.getReader(); const chunks = []; let size = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > object.size) { await reader.cancel(); reject("wordlist_ui_asset_limit"); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      if (size !== object.size) reject("wordlist_ui_asset_integrity");
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    }
    if (!objectKey.startsWith("builder-wordlist-audio/")) return super.download({ profile, objectKey });
    this.bucket(profile); validateObjectKey(objectKey);
    const object = await this.binding.get(objectKey);
    if (!object?.body || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > WORDLIST_LIMITS.file) {
      await object?.body?.cancel(); reject("wordlist_audio_limit");
    }
    const reader = object.body.getReader(); const chunks = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > object.size || length > WORDLIST_LIMITS.file) { await reader.cancel(); reject("wordlist_audio_limit"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (length !== object.size) reject("wordlist_audio_integrity");
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
  async upload({ profile, objectKey, body, contentType, checksumSha256, byteSize }) {
    if (objectKey.startsWith("builder-release-assets/")) return super.upload({ profile, objectKey, body, contentType, checksumSha256, byteSize });
    this.bucket(profile); validateObjectKey(objectKey);
    if (!/^builder-wordlist-audio\/[a-z0-9-]+\/[a-z0-9-]+\/[a-f0-9-]+\/[a-f0-9]{64}\.mp3$/.test(objectKey)
      || byteSize !== body.length || byteSize > WORDLIST_LIMITS.file || contentType !== "audio/mpeg") reject("wordlist_storage_context");
    await this.binding.put(objectKey, body, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType }, customMetadata: { sha256: checksumSha256 }, sha256: checksumSha256 });
    const actual = await this.head({ profile, objectKey });
    if (actual.byteSize !== byteSize || actual.checksumSha256 !== checksumSha256 || actual.contentType !== contentType) reject("wordlist_storage_integrity");
  }
}
export const wordListStorage = (context = {}) => context.cloudflare
  ? new WordListR2Storage({ binding: context.cloudflare.releaseSourceAssets, privateBucket: context.cloudflare.releaseSourceAssetsBucket, publicUiBinding: context.cloudflare.publicUiAssets })
  : createBookAssetStorage();
export async function readWordListAudio(storage, record, sha256) {
  const binding = record.bindings.find((item) => item.sha256 === sha256);
  if (!binding || binding.storageBucket !== storage.bucket("private")) reject("wordlist_audio_owner");
  const target = { profile: "private", objectKey: binding.objectKey };
  const head = await storage.head(target);
  if (head.byteSize !== binding.byteSize || head.contentType !== binding.mediaType) reject("wordlist_audio_integrity");
  const bytes = await storage.download(target);
  if (bytes.length !== binding.byteSize || createHash("sha256").update(bytes).digest("hex") !== binding.sha256) reject("wordlist_audio_integrity");
  return bytes;
}
