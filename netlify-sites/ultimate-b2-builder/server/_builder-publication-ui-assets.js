import { componentPublicationAssetStorageTarget } from "../../../lib/book-assets/publication-asset-storage.js";
import { managedUiV2Components, managedUiAssetManifest } from "./_builder-managed-ui-publication-compiler.js";
import { ComponentPublicationAssetError } from "./_builder-publication-assets.js";

export async function verifyManagedPublicationUiAssets(storage, compiled, { bookSlug, componentSlug }, cloudflare = null) {
  if (!managedUiV2Components.includes(componentSlug) || compiled.compilerId !== `${componentSlug}-v2`) return;
  const ui = compiled.teacherProjection.ui;
  for (const descriptor of managedUiAssetManifest(ui, componentSlug)) {
    const asset = Object.values(ui.assets).find((entry) => entry.sha256 === descriptor.sha256 && entry.extension === descriptor.extension);
    const target = componentPublicationAssetStorageTarget({ bookSlug, componentSlug, ...descriptor });
    const diagnostic = (failureClass) => new ComponentPublicationAssetError({ assetId: descriptor.sha256, role: "teacher_ui", stage: "verify", failureClass });
    let head;
    try {
      if (cloudflare !== null) {
        const object = await cloudflare.publicUiAssets.head(target.objectKey);
        head = object && { byteSize: object.size, checksumSha256: object.customMetadata?.sha256, contentType: object.httpMetadata?.contentType };
      } else head = await storage.head({ profile: target.profile, objectKey: target.objectKey });
    }
    catch { throw diagnostic("immutable_object_missing"); }
    if (!head) throw diagnostic("immutable_object_missing");
    if (head.checksumSha256 !== descriptor.sha256) throw diagnostic("immutable_checksum_mismatch");
    if (head.byteSize !== asset.sizeBytes) throw diagnostic("immutable_byte_size_mismatch");
    if (head.contentType !== descriptor.mediaType) throw diagnostic("immutable_media_type_mismatch");
  }
}
