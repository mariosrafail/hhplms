import { normalizeOverviewCaptionFontAsset, overviewCaptionFontManifest } from "../../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { resolveBuilderPackageUi } from "./_builder-component-registry.js";
import { loadBuilderFontAsset } from "./_builder-native-activity-store.js";
import { buildBuilderFontLibraryObjectKey } from "../../../lib/book-assets/object-keys.js";
import { componentPublicationAssetStorageTarget } from "../../../lib/book-assets/publication-asset-storage.js";
import { verifiedPublicAssetPin } from "../../../lib/book-assets/verified-publication-pin.js";
import { serveBuilderPrivateFont } from "./_builder-private-font-response.js";

export function requiresOverviewFontSchema(ui) {
  return !!ui && Object.hasOwn(ui, "overviewCaptionFontAsset");
}

export async function overviewFontDatabaseReady(sql) {
  const rows = await sql`select to_regprocedure('builder_overview_font_reference_integrity(jsonb)') is not null ready`;
  return rows[0]?.ready === true;
}

export function validateOverviewFontRow(ui, row, { bookSlug, componentSlug }) {
  const owner = resolveBuilderPackageUi(bookSlug, componentSlug);
  const reference = normalizeOverviewCaptionFontAsset(ui.overviewCaptionFontAsset);
  if (!owner || owner.componentSlug !== componentSlug || ui.packageId !== owner.packageId
    || !row || String(row.id) !== reference.assetId || row.checksum_sha256 !== reference.checksumSha256
    || row.asset_role !== "activity_font" || row.mime_type !== "font/ttf" || row.publication_status !== "draft"
    || row.access_level !== "internal" || row.storage_profile !== "private" || row.source_metadata?.font_library_scope !== "component"
    || !Number.isSafeInteger(Number(row.byte_size)) || Number(row.byte_size) < 1 || Number(row.byte_size) > 12582912
    || (row.book_slug && row.book_slug !== bookSlug) || (row.component_slug && row.component_slug !== componentSlug)
    || row.object_key !== buildBuilderFontLibraryObjectKey({ bookSlug, componentSlug, checksum: reference.checksumSha256 })) {
    throw new Error("invalid_overview_font_reference");
  }
  return { descriptor: overviewCaptionFontManifest(ui)[0], row: { ...row, book_slug: bookSlug, component_slug: componentSlug } };
}

export async function collectOverviewFont(sql, ui, identity, loadFont = loadBuilderFontAsset) {
  if (!requiresOverviewFontSchema(ui)) return [];
  const reference = normalizeOverviewCaptionFontAsset(ui.overviewCaptionFontAsset);
  const row = await loadFont(sql, { ...identity, assetId: reference.assetId });
  return [validateOverviewFontRow(ui, row, identity)];
}

export function overviewFontSources(sources, ui, identity) {
  if (!requiresOverviewFontSchema(ui)) return [];
  const rows = sources.overviewFontSources || [];
  if (rows.length !== 1) throw new Error("invalid_overview_font_reference");
  return [validateOverviewFontRow(ui, rows[0].row, identity)];
}

export function mergeOverviewFontSources(sources, extra) {
  if (!extra.length) return sources;
  const entries = new Map(sources.map((entry) => [`${entry.descriptor.sha256}.${entry.descriptor.extension}.${entry.descriptor.role}`, entry]));
  for (const entry of extra) {
    const key = `${entry.descriptor.sha256}.${entry.descriptor.extension}.${entry.descriptor.role}`;
    const previous = entries.get(key);
    if (previous && (previous.row.id !== entry.row.id || previous.row.object_key !== entry.row.object_key || Number(previous.row.byte_size) !== Number(entry.row.byte_size))) throw new Error("release_pin_conflict");
    entries.set(key, entry);
  }
  return [...entries.values()];
}

// Called only after release Teacher authorization and immutable verification.
export async function deliverOverviewFont({ release, verified, method, storage, loadPin }) {
  const ui = verified.teacherProjection?.ui;
  const descriptor = overviewCaptionFontManifest(ui)[0];
  if (!descriptor || !release.asset_manifest.some((asset) => Object.keys(descriptor).every((key) => asset[key] === descriptor[key]))) throw new Error("overview_font_not_found");
  const identity = verified.publicProjection;
  let asset;
  if (release.asset_storage_mode === "pinned-source-v1") {
    const pin = await loadPin(descriptor);
    verifiedPublicAssetPin({ row: release, projection: identity, asset: descriptor, pin });
    if (pin.book_asset_id !== ui.overviewCaptionFontAsset.assetId || pin.source_asset_slot !== "") throw new Error("release_pin_integrity_failed");
    asset = { object_key: pin.object_key, byte_size: pin.byte_size, checksum_sha256: pin.checksum_sha256 };
  } else if (!release.asset_storage_mode || release.asset_storage_mode === "materialized-v1") {
    const target = componentPublicationAssetStorageTarget({ ...identity, ...descriptor });
    const head = await storage.head({ profile: "private", objectKey: target.objectKey });
    if (head.checksumSha256 !== descriptor.sha256 || head.contentType !== "font/ttf") throw new Error("release_pin_integrity_failed");
    asset = { object_key: target.objectKey, byte_size: head.byteSize, checksum_sha256: descriptor.sha256 };
  } else throw new Error("release_pin_integrity_failed");
  return serveBuilderPrivateFont({ storage, asset, method });
}
