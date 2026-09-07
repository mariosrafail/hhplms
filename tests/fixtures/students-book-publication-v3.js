import { currentStudentsBookSources, studentsBookUnits } from "./students-book-current.js";

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
