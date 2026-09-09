import { loadComponentReleaseAssetPin } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-publication-store.js";
import { parseReleaseAssetRange } from "../../../netlify-sites/ultimate-b2-builder/server/_builder-release-source-delivery.js";
import { verifiedPublicAssetPin } from "./published-asset-pin.js";
import { json } from "./shared.js";
import { readBoundedImageResponse } from "../../../lib/book-assets/verified-image-bytes.js";
import { newManagedPublicationComponents } from "../../../src/data/publicationRegistry.js";

const failure = (status, error) => json(status, { error }, { "Cache-Control": "private, no-store", Vary: "Cookie" });

export async function deliverPublishedPinnedAsset(sql, query, { row, projection, asset, storage, method, rangeHeader }) {
  try {
    const pin = await loadComponentReleaseAssetPin(sql, { ...query, role: asset.role });
    const objectKey = verifiedPublicAssetPin({ row, projection, asset, pin });
    if (storage.bucket("private") !== pin.storage_bucket) return failure(503, "release_asset_storage_unavailable");
    const range = parseReleaseAssetRange(rangeHeader, Number(pin.byte_size));
    if (range === false) return { ...failure(416, "invalid_range"), headers: { "Cache-Control": "private, no-store", "Content-Range": `bytes */${pin.byte_size}` } };
    const size = range?.length || Number(pin.byte_size);
    const contentRange = range ? `bytes ${range.offset}-${range.offset + range.length - 1}/${pin.byte_size}` : null;
    const headers = { "Content-Type": asset.mediaType, "Content-Length": String(size), "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store", Vary: "Cookie", "Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff",
      ...(contentRange ? { "Content-Range": contentRange } : {}) };
    if ((row.compiler_id === "ultimate-b2-students-book-v3" || newManagedPublicationComponents.some((entry) => entry.compilerId === row.compiler_id)) && asset.role === "managed_page_image") {
      const page = projection.pages.find((entry) => entry.image.sha256 === asset.sha256 && entry.image.extension === asset.extension);
      const object = await storage.openReadStream({ profile: "private", objectKey });
      if (!page || object.byteSize !== Number(pin.byte_size) || object.checksumSha256 !== asset.sha256 || object.contentType !== asset.mediaType || object.contentRange !== null) {
        await object.body?.cancel(); return failure(409, "release_pin_integrity_failed");
      }
      try {
        const bytes = await readBoundedImageResponse(new Response(object.body, { headers: { "Content-Type": object.contentType } }), page.image);
        return new Response(method === "HEAD" ? null : range ? bytes.subarray(range.offset, range.offset + range.length) : bytes, { status: range ? 206 : 200, headers });
      } catch { return failure(409, "release_pin_integrity_failed"); }
    }
    if (method === "HEAD") {
      const head = await storage.head({ profile: "private", objectKey });
      if (head.checksumSha256 !== asset.sha256 || Number(head.byteSize) !== Number(pin.byte_size) || head.contentType !== asset.mediaType) return failure(409, "release_pin_integrity_failed");
      return { statusCode: range ? 206 : 200, headers, body: "" };
    }
    const object = await storage.openReadStream({ profile: "private", objectKey, range });
    if (object.byteSize !== size || object.checksumSha256 !== asset.sha256 || object.contentType !== asset.mediaType || object.contentRange !== contentRange) {
      await object.body.cancel();
      return failure(409, "release_pin_integrity_failed");
    }
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch (error) {
    return failure(error.message === "release_pin_integrity_failed" ? 409 : 503, error.message === "release_pin_integrity_failed" ? "release_pin_integrity_failed" : "release_asset_unavailable");
  }
}
