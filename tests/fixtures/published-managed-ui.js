import { createHash } from "node:crypto";
import sharp from "sharp";
import { createEmptyBuilderTeacherUiDocument } from "../../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-document.js";
import { componentPublicationAssetStorageTarget } from "../../lib/book-assets/publication-asset-storage.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

export const componentReleaseRow = (c) => ({ compiler_id: c.compilerId, release_schema_version: c.releaseSchemaVersion,
  runtime_compatibility_sha256: c.compatibility, source_snapshot: c.sourceSnapshot, source_snapshot_sha256: c.sourceSnapshotSha256,
  public_projection: c.publicProjection, public_projection_sha256: c.publicProjectionSha256,
  teacher_projection: c.teacherProjection, teacher_projection_sha256: c.teacherProjectionSha256,
  asset_manifest: c.assetManifest, release_sha256: c.releaseSha256 });

export async function publishedManagedUiFixture(componentSlug, variant = 0) {
  const bookSlug = componentSlug.replace(/-students-book$/, "");
  const color = variant ? "#a43287" : bookSlug === "ultimate-b1" ? "#ab3521" : "#2369b5";
  const graphic = await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer();
  // Real, tiny PCM WAV. Browser acceptance verifies bytes/MIME/URL, not speakers.
  const sound = Buffer.alloc(76); sound.write("RIFF", 0); sound.writeUInt32LE(68, 4); sound.write("WAVEfmt ", 8);
  sound.writeUInt32LE(16, 16); sound.writeUInt16LE(1, 20); sound.writeUInt16LE(1, 22); sound.writeUInt32LE(8000, 24);
  sound.writeUInt32LE(16000, 28); sound.writeUInt16LE(2, 32); sound.writeUInt16LE(16, 34); sound.write("data", 36); sound.writeUInt32LE(32, 40);
  sound.writeInt16LE(bookSlug === "ultimate-b1" ? 128 : 256, 44);
  const assets = {}, objects = new Map(), heads = new Map();
  for (const binding of ["background.main", "navigation.next", "toolbar.pencil.normal", "media-player.background", "sound.button", "sound.correct", "sound.incorrect", "sound.page-turn"]) {
    const audio = binding.startsWith("sound."); const bytes = audio ? Buffer.from(sound) : graphic;
    if (audio) bytes.writeInt16LE(sound.readInt16LE(44) + ["button", "correct", "incorrect", "page-turn"].indexOf(binding.slice(6)), 44);
    const asset = { sha256: createHash("sha256").update(bytes).digest("hex"), extension: audio ? "wav" : "png", mediaType: audio ? "audio/wav" : "image/png",
      sizeBytes: bytes.length, width: audio ? null : 8, height: audio ? null : 8, originalFilename: audio ? "synthetic.wav" : "synthetic.png" };
    assets[binding] = asset;
    const target = componentPublicationAssetStorageTarget({ bookSlug, componentSlug, ...asset, role: "teacher_ui" });
    objects.set(target.objectKey, bytes); heads.set(target.objectKey, { byteSize: bytes.length, checksumSha256: asset.sha256, contentType: asset.mediaType });
  }
  const payload = { ...createEmptyBuilderTeacherUiDocument(componentSlug), assets };
  return { payload, revision: 1, sha256: builderDocumentSha256(payload), objects, heads, color };
}
