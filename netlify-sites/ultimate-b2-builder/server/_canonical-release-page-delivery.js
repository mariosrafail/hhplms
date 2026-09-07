import { componentPublicationAssetStorageTarget } from "../../../lib/book-assets/publication-asset-storage.js";
import { readBoundedImageResponse } from "../../../lib/book-assets/verified-image-bytes.js";

// Called only with an authorized, verified immutable projection. No current
// Page Library/catalog or preview authorization participates in this read.
export async function deliverCanonicalReleasePageAsset({ projection, asset, storage, binding = null, method = "GET" }) {
  const unavailable = () => new Response(JSON.stringify({ error: "release_asset_integrity_failed" }), { status: 409, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Cookie" } });
  try {
    const pages = projection.pages.filter((page) => page.image.role === "canonical_page_image" && page.image.sha256 === asset.sha256 && page.image.extension === asset.extension);
    const page = pages[0];
    if (asset.role !== "canonical_page_image" || !page || pages.some((entry) => entry.image.byteSize !== page.image.byteSize || entry.image.mediaType !== asset.mediaType)) return unavailable();
    const target = componentPublicationAssetStorageTarget({ bookSlug: projection.bookSlug, componentSlug: projection.componentSlug, ...asset });
    let response;
    if (binding) {
      const object = await binding.get(target.objectKey);
      if (!object?.body || object.size !== page.image.byteSize || object.customMetadata?.sha256 !== asset.sha256 || object.httpMetadata?.contentType !== asset.mediaType) { await object?.body?.cancel(); return unavailable(); }
      response = new Response(object.body, { headers: { "Content-Type": object.httpMetadata.contentType } });
    } else {
      const object = await storage.openReadStream({ profile: "private", objectKey: target.objectKey });
      if (object.byteSize !== page.image.byteSize || object.checksumSha256 !== asset.sha256 || object.contentType !== asset.mediaType || object.contentRange !== null) { await object.body?.cancel(); return unavailable(); }
      response = new Response(object.body, { headers: { "Content-Type": object.contentType } });
    }
    const bytes = await readBoundedImageResponse(response, { ...page.image, ...asset });
    return new Response(method === "HEAD" ? null : bytes, { headers: { "Content-Type": asset.mediaType, "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch { return unavailable(); }
}
