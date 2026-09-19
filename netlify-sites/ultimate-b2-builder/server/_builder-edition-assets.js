import { createHash } from "node:crypto";
import { ContentEditionError } from "../../../src/data/contentEditions.js";
import { resolvePublicationCompiler } from "./_builder-publication-compilers.js";
import { stableBuilderJson } from "./_builder-content-security.js";
import { freezeComponentPublicationAssetPins } from "./_builder-publication-pins.js";
import { materializeCanonicalReleaseAssets, canonicalPublicationAssetFetcher } from "./_builder-canonical-release-assets.js";
import { componentPublicationAssetStorageTarget } from "../../../lib/book-assets/publication-asset-storage.js";
import { readBoundedImageResponse } from "../../../lib/book-assets/verified-image-bytes.js";

export function editionSourceAssetIds(record) {
  const inputs = record.source.inputs;
  return [...new Set([
    ...(inputs.pages?.rows || []).map((row) => row.asset_id),
    ...(inputs.native?.assetRows || []).map((row) => row.id),
    ...(inputs.unitExtras?.assetRows || []).map((row) => row.id),
    ...(inputs.overviewFontSources || []).map(({ row }) => row.id),
  ].filter(Boolean))].sort();
}
export async function validateEditionSourceAssets(sql, record) {
  const ids = editionSourceAssetIds(record);
  if (!ids.length) return ids;
  const { bookSlug, componentSlug } = record.reference;
  const rows = await sql`select asset.*,package.slug book_slug,component.slug component_slug
    from book_assets asset join book_packages package on package.id=asset.book_package_id
    join book_components component on component.id=asset.book_component_id and component.book_package_id=package.id
    where asset.id=any(${ids}::uuid[]) and package.slug=${bookSlug} and component.slug=${componentSlug}`;
  if (rows.length !== ids.length) throw new ContentEditionError("edition_asset_owner_mismatch");
  const byId = new Map(rows.map((row) => [row.id, row]));
  const inputs = record.source.inputs;
  const sources = [...(inputs.pages?.rows || []).map((row) => ({ ...row, id: row.asset_id })),
    ...(inputs.native?.assetRows || []), ...(inputs.unitExtras?.assetRows || []), ...(inputs.overviewFontSources || []).map(({ row }) => row)];
  for (const source of sources) {
    if (!source.id) continue;
    const actual = byId.get(source.id);
    for (const key of ["checksum_sha256", "object_key", "storage_profile", "storage_bucket", "mime_type", "asset_role"]) {
      if (source[key] !== actual[key]) throw new ContentEditionError("edition_asset_context_mismatch");
    }
    for (const key of ["byte_size", "width", "height"]) {
      if (Number(source[key]) !== Number(actual[key])) throw new ContentEditionError("edition_asset_context_mismatch");
    }
    if (source.asset_role !== "page_image" && stableBuilderJson(source.source_metadata) !== stableBuilderJson(actual.source_metadata)) throw new ContentEditionError("edition_asset_context_mismatch");
  }
  return ids;
}
export async function prepareEditionAssets(storage, release, context) {
  for (const member of release.members) {
    const { bookSlug, componentSlug } = member.reference;
    const compiled = resolvePublicationCompiler(member.content.compilerId).compile(structuredClone(member.source.inputs));
    // Native bytes remain at their verified immutable private paths; source
    // revisions capture their metadata, and asset owner FKs protect identity.
    await freezeComponentPublicationAssetPins(storage, { bookSlug, componentSlug, ...compiled });
    await materializeCanonicalReleaseAssets(storage, { bookSlug, componentSlug, ...compiled, fetchAsset: canonicalPublicationAssetFetcher(context) });
  }
}
export async function readEditionAsset(storage, release, { componentSlug, role, sha256, extension, teacher = false, canonicalFetcher = null }) {
  const member = release.members.find((entry) => entry.reference.componentSlug === componentSlug);
  if (!member) throw new ContentEditionError("edition_asset_context_mismatch");
  const allowed = teacher ? member.content.assetManifest : member.content.publicProjection.assets;
  const descriptor = allowed.find((entry) => entry.role === role && entry.sha256 === sha256 && entry.extension === extension);
  if (!descriptor || !teacher && ["native_teacher_answer", "teacher_ui"].includes(role)) throw new ContentEditionError("edition_asset_context_mismatch");
  const compiled = resolvePublicationCompiler(member.content.compilerId).compile(structuredClone(member.source.inputs));
  if (canonicalFetcher && role === "canonical_page_image") {
    const canonical = compiled.canonicalAssetSources.find((entry) => entry.descriptor.sha256 === sha256 && entry.descriptor.extension === extension);
    if (!canonical) throw new ContentEditionError("edition_asset_context_mismatch");
    const bytes = await readBoundedImageResponse(await canonicalFetcher(canonical.path), { ...descriptor, byteSize: canonical.byteSize, width: canonical.width, height: canonical.height });
    return { bytes, mediaType: descriptor.mediaType };
  }
  const source = compiled.nativeAssetSources?.find((entry) => entry.descriptor.role === role && entry.descriptor.sha256 === sha256 && entry.descriptor.extension === extension);
  if (source && (source.row.storage_profile !== "private" || source.row.storage_bucket !== storage.bucket("private"))) throw new ContentEditionError("edition_asset_context_mismatch");
  const target = source ? { profile: "private", objectKey: source.row.object_key }
    : componentPublicationAssetStorageTarget({ bookSlug: member.reference.bookSlug, componentSlug, ...descriptor });
  const bytes = await storage.download(target);
  if (createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) throw new ContentEditionError("edition_asset_integrity_failed");
  return { bytes, mediaType: descriptor.mediaType };
}
