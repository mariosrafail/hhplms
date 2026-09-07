import { createHash } from "node:crypto";
import { publicationAssetPinFingerprint } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js";
import { componentPublicationCanonicalPrivateSourceObjectKey } from "./publication-asset-storage.js";

function containsReference(value, pin) {
  if (!value || typeof value !== "object") return false;
  if (value.assetId === pin.book_asset_id && value.checksumSha256 === pin.checksum_sha256 && value.role === pin.asset_role && value.slot === pin.source_asset_slot) return true;
  return Object.values(value).some((child) => containsReference(child, pin));
}

// The pin and its source are immutable publication records. Never resolve
// current draft asset rows when serving an older assignment.
export function verifiedPublicAssetPin({ row, projection, asset, pin }) {
  if (!pin || pin.component_release_id !== row.id || pin.asset_role !== asset.role
    || pin.source_asset_role !== (asset.role === "managed_page_image" ? "page_image" : asset.role)
    || pin.checksum_sha256 !== asset.sha256 || pin.extension !== asset.extension || pin.media_type !== asset.mediaType
    || pin.storage_profile !== "private" || !Number.isSafeInteger(Number(pin.byte_size)) || Number(pin.byte_size) < 1
    || asset.role === "native_teacher_answer") throw new Error("release_pin_integrity_failed");
  const fingerprint = publicationAssetPinFingerprint({ assetId: pin.book_asset_id, role: pin.asset_role, sourceAssetRole: pin.source_asset_role,
    checksumSha256: pin.checksum_sha256, extension: pin.extension, mediaType: pin.media_type, byteSize: Number(pin.byte_size),
    storageProfile: pin.storage_profile, storageBucket: pin.storage_bucket, objectKey: pin.object_key, ownerKey: pin.source_owner_key, assetSlot: pin.source_asset_slot });
  if (createHash("sha256").update(fingerprint).digest("hex") !== pin.pin_sha256) throw new Error("release_pin_integrity_failed");
  let metadata;
  if (asset.role === "managed_page_image") {
    if (!projection.pages?.some((page) => page.id === pin.source_owner_key && page.image.sha256 === asset.sha256)) throw new Error("release_pin_integrity_failed");
    metadata = { publication_page_id: pin.source_owner_key };
  } else if (asset.role === "activity_artwork") {
    if (!containsReference(projection.nativeActivities?.[pin.source_owner_key], pin)) throw new Error("release_pin_integrity_failed");
    metadata = { native_activity_id: pin.source_owner_key, asset_slot: pin.source_asset_slot };
  } else if (["unit_extra_audio", "unit_extra_video"].includes(asset.role)) {
    const unit = projection.unitExtras?.units?.find((item) => containsReference(item, pin));
    if (!unit || pin.source_owner_key !== pin.source_asset_slot) throw new Error("release_pin_integrity_failed");
    metadata = { unit_slug: unit.unitId, unit_extra_item_id: pin.source_owner_key };
  } else if (asset.role === "activity_font" && pin.source_owner_key === "component") metadata = { font_library_scope: "component" };
  else throw new Error("release_pin_integrity_failed");
  const objectKey = componentPublicationCanonicalPrivateSourceObjectKey({ bookSlug: projection.bookSlug, componentSlug: projection.componentSlug, descriptor: asset, row: { source_metadata: metadata } });
  // Released SQL 054/055/058 accepted this exact older font path. The
  // immutable, fingerprint-verified pin remains authoritative for those bytes.
  const historicalFontKey = asset.role === "activity_font"
    ? `builder-font-library/${projection.bookSlug}/${projection.componentSlug}/${asset.sha256}.ttf`
    : null;
  if (objectKey !== pin.object_key && historicalFontKey !== pin.object_key) throw new Error("release_pin_integrity_failed");
  return pin.object_key;
}
