import { CloudflareR2BookAssetHeadStorage } from "./cloudflare-r2-head-storage.js";
import { validateObjectKey } from "./object-keys.js";

export class CloudflareR2ReleaseStorage extends CloudflareR2BookAssetHeadStorage {
  async upload({ profile, objectKey, body, contentType, checksumSha256, byteSize }) {
    this.bucket(profile); const key = validateObjectKey(objectKey);
    if (!key.startsWith("builder-release-assets/ultimate-b2/ultimate-b2-students-book/") || typeof this.binding.put !== "function") throw new Error("canonical_storage_unavailable");
    await this.binding.put(key, body, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType }, customMetadata: { sha256: checksumSha256 }, sha256: checksumSha256 });
    const head = await this.head({ profile, objectKey: key });
    if (head.byteSize !== byteSize || head.checksumSha256 !== checksumSha256 || head.contentType !== contentType) throw new Error("canonical_immutable_identity_invalid");
    return head;
  }
  async download({ profile, objectKey }) {
    this.bucket(profile);
    const object = await this.binding.get(validateObjectKey(objectKey));
    if (!object?.body || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > 40 * 1024 * 1024) {
      await object?.body?.cancel(); throw new Error("canonical_storage_unavailable");
    }
    return new Uint8Array(await object.arrayBuffer());
  }
}

export const createCloudflareR2ReleaseStorage = (options) => new CloudflareR2ReleaseStorage(options);
