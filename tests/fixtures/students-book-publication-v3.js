import { currentStudentsBookSources, studentsBookUnits } from "./students-book-current.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { buildNativeActivityAssetObjectKey } from "../../lib/book-assets/object-keys.js";

export function studentsBookV3Sources() {
  const sources = currentStudentsBookSources();
  sources.pages = { revision: 2, units: structuredClone(studentsBookUnits), rows: [] };
  return sources;
}
export function studentsBookV3ReleaseRow(compiled) {
  return { compiler_id: compiled.compilerId, release_schema_version: compiled.releaseSchemaVersion, runtime_compatibility_sha256: compiled.compatibility,
    source_snapshot: compiled.sourceSnapshot, source_snapshot_sha256: compiled.sourceSnapshotSha256,
    public_projection: compiled.publicProjection, public_projection_sha256: compiled.publicProjectionSha256,
    teacher_projection: compiled.teacherProjection, teacher_projection_sha256: compiled.teacherProjectionSha256,
    release_sha256: compiled.releaseSha256, asset_manifest: compiled.assetManifest };
}

// Descriptor observed in restored acceptance; the activity content and asset
// rows below are synthetic and contain no publisher PDF bytes or stored release.
export const studentsBookPdfArtwork = Object.freeze({
  sha256: "300746b72bea14be75404053b468804a466c778495a959a739f9bc1ec011011f",
  extension: "pdf", mediaType: "application/pdf", role: "activity_artwork",
});

export function studentsBookV3PdfSources() {
  const sources = studentsBookV3Sources();
  const oldId = sources.native.index.payload.activities.find((entry) => entry.kind === "open-response").activityId;
  const activityId = "ultimate-b2-sb-u1-p2-o7";
  const entry = sources.native.activities[oldId];
  delete sources.native.activities[oldId]; sources.native.activities[activityId] = entry;
  entry.index.activityId = activityId;
  entry.public.payload.activityId = activityId; entry.teacher.payload.activityId = activityId;
  for (const hotspots of Object.values(sources.documents.hotspots.payload.pages)) {
    for (const hotspot of hotspots) if (hotspot.activityKey === oldId) hotspot.activityKey = activityId;
  }
  const video = sources.unitExtras.document.payload.units[0].categories.videos[0];
  const references = [
    { assetId: "10000000-0000-4000-8000-000000000070", checksumSha256: video.asset.checksumSha256, role: "activity_artwork", slot: "video-companion" },
    { assetId: "10000000-0000-4000-8000-000000000071", checksumSha256: studentsBookPdfArtwork.sha256, role: studentsBookPdfArtwork.role, slot: "video-worksheet" },
  ];
  entry.public.payload.assets = references;
  entry.public.payload.video = { kind: "managed-mp4", assetSlot: references[0].slot, fileName: "synthetic-companion.mp4", byteSize: video.byteSize, durationMs: video.durationMs, cues: structuredClone(video.cues),
    worksheet: { assetSlot: references[1].slot, fileName: "synthetic-worksheet.pdf", byteSize: 4096 } };
  for (const [index, reference] of references.entries()) {
    const extension = index ? "pdf" : "mp4";
    sources.native.assetRows.push({ id: reference.assetId, checksum_sha256: reference.checksumSha256, asset_role: reference.role,
      object_key: buildNativeActivityAssetObjectKey({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", activityId, assetSlot: reference.slot, checksum: reference.checksumSha256, extension: `.${extension}` }),
      storage_profile: "private", storage_bucket: "private", mime_type: index ? studentsBookPdfArtwork.mediaType : "video/mp4", byte_size: index ? 4096 : video.byteSize,
      width: null, height: null, publication_status: "draft", access_level: "internal", source_metadata: { native_activity_id: activityId, asset_slot: reference.slot } });
  }
  for (const source of [entry.public, entry.teacher, sources.native.index, sources.documents.hotspots]) source.sha256 = builderDocumentSha256(source.payload);
  return sources;
}
