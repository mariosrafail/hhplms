import { componentPublicationAssetStorageTarget } from "../../../lib/book-assets/publication-asset-storage.js";
import { readBoundedImageResponse, verifyImageBytes } from "../../../lib/book-assets/verified-image-bytes.js";
import { ComponentPublicationAssetError } from "./_builder-publication-assets.js";

export function canonicalPublicationAssetFetcher(context, deploymentUrl = process.env.URL) {
  if (context?.cloudflare?.staticAssets?.fetch) return (path) => context.cloudflare.staticAssets.fetch(new Request(new URL(path, "https://builder-assets.invalid")));
  // Netlify supplies this trusted deployment URL; never derive a server fetch
  // destination from request Host/Origin, an authored URL or a preview token.
  const url = deploymentUrl && new URL(deploymentUrl);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("canonical_asset_source_unavailable");
  return (path) => fetch(new URL(path, url), { redirect: "error", credentials: "omit" });
}

export async function materializeCanonicalReleaseAssets(storage, { bookSlug, componentSlug, canonicalAssetSources = [], assetManifest, publicProjection, fetchAsset }) {
  const expectedAssets = assetManifest.filter((asset) => asset.role === "canonical_page_image");
  const unique = new Map();
  try {
    if (bookSlug !== "ultimate-b2" || componentSlug !== "ultimate-b2-students-book") {
      if (canonicalAssetSources.length || expectedAssets.length) throw new Error("canonical_asset_scope_invalid");
      return;
    }
    for (const source of canonicalAssetSources) {
      const { descriptor, pageId, path, byteSize, width, height } = source;
      const page = publicProjection.pages.find((entry) => entry.id === pageId);
      const identity = `${descriptor.sha256}.${descriptor.extension}.${descriptor.role}`;
      if (descriptor.role !== "canonical_page_image" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(pageId)
        || !page || page.origin !== "canonical" || page.image.role !== descriptor.role || page.image.sha256 !== descriptor.sha256
        || page.image.extension !== descriptor.extension || page.image.mediaType !== descriptor.mediaType || page.image.byteSize !== byteSize || page.image.width !== width || page.image.height !== height
        || path !== `/page-library/${bookSlug}/${componentSlug}/${pageId}.${descriptor.extension}`) throw new Error("canonical_asset_identity_invalid");
      unique.set(identity, source);
    }
    if (unique.size !== expectedAssets.length || expectedAssets.some((asset) => !unique.has(`${asset.sha256}.${asset.extension}.${asset.role}`))
      || publicProjection.pages.filter((page) => page.image.role === "canonical_page_image").some((page) => !canonicalAssetSources.some((source) => source.pageId === page.id))) throw new Error("canonical_asset_manifest_invalid");
    // Sequential: memory is bounded independently of the number of pages.
    for (const { descriptor, path, byteSize, width, height } of unique.values()) {
      const target = componentPublicationAssetStorageTarget({ bookSlug, componentSlug, ...descriptor });
      const expected = { ...descriptor, byteSize, width, height };
      const bytes = await readBoundedImageResponse(await fetchAsset(path), expected);
      // upload is create-only. Existing or racing objects are never replaced.
      await storage.upload({ profile: "private", objectKey: target.objectKey, body: bytes, contentType: descriptor.mediaType, checksumSha256: descriptor.sha256, byteSize });
      const head = await storage.head({ profile: "private", objectKey: target.objectKey });
      if (head.byteSize !== byteSize || head.checksumSha256 !== descriptor.sha256 || head.contentType !== descriptor.mediaType) throw new Error("canonical_immutable_identity_invalid");
      await verifyImageBytes(await storage.download({ profile: "private", objectKey: target.objectKey }), expected);
    }
  } catch (error) {
    throw new ComponentPublicationAssetError({ role: "canonical_page_image", stage: "canonical-materialize", failureClass: /^canonical_|^image_/.test(error?.message || "") ? error.message : "canonical_storage_unavailable" });
  }
}
