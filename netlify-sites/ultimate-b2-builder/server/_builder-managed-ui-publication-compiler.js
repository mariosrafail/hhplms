import { compileUltimateB2ManagedComponentRelease, verifyUltimateB2ManagedComponentRelease, managedV1Compatibility } from "./_builder-managed-publication-compiler.js";
import { builderDocumentSha256 as hash, stableBuilderJson as json } from "./_builder-content-security.js";
import { createEmptyBuilderTeacherUiDocument, projectBuilderTeacherUiPreview } from "./_builder-teacher-ui-document.js";
import { normalizeHostedTeacherUiPreview, overviewCaptionFontManifest } from "../../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { overviewFontSources, mergeOverviewFontSources } from "./_builder-overview-font.js";
import { usesNativeComposition } from "../../../src/data/native-activities/nativeImageSampleAnswer.js";

// A closed v2 contract; v1 normalization and fingerprints never acquire UI fields.
export const managedUiV2Components = Object.freeze(["ultimate-b1-students-book", "ultimate-b1-plus-students-book"]);
const mime = Object.freeze({ png: "image/png", jpg: "image/jpeg", webp: "image/webp", gaf: "application/x-gaf", mp3: "audio/mpeg", wav: "audio/wav" });
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const fail = () => { throw new Error("release_integrity_failed"); };
const order = (a, b) => `${a.sha256}.${a.extension}.${a.role}`.localeCompare(`${b.sha256}.${b.extension}.${b.role}`);
function identity(slug) {
  if (!managedUiV2Components.includes(slug)) throw new Error("publication_compiler_mismatch");
  return { compilerId: `${slug}-v2`, releaseSchemaVersion: "2.0" };
}
function compatibility(slug, baseCompatibility) {
  return hash({ ...identity(slug), managedV1Compatibility: baseCompatibility, teacherUiSchemaVersion: "1.0" });
}

export function managedUiAssetManifest(ui, componentSlug) {
  const normalized = normalizeHostedTeacherUiPreview(ui, { packageId: componentSlug });
  if (json(normalized) !== json(ui)) fail();
  const assets = new Map();
  for (const asset of Object.values(normalized.assets)) {
    if (mime[asset.extension] !== asset.mediaType) fail();
    const key = `${asset.sha256}.${asset.extension}`;
    if (assets.has(key) && json(assets.get(key)) !== json(asset)) fail();
    assets.set(key, asset);
  }
  return [...assets.values()].map(({ sha256, extension, mediaType }) => ({ sha256, extension, mediaType, role: "teacher_ui" })).sort(order);
}
function hashes({ compatibility, sourceSnapshot, publicProjection, teacherProjection }) {
  const durable = { compatibility, sourceSnapshot, publicProjection, teacherProjection };
  return { sourceSnapshotSha256: hash(sourceSnapshot), publicProjectionSha256: hash(publicProjection), teacherProjectionSha256: hash(teacherProjection), releaseSha256: hash(durable), stableJson: json(durable) };
}
function stored(compiled) {
  return { compiler_id: compiled.compilerId, release_schema_version: compiled.releaseSchemaVersion, runtime_compatibility_sha256: compiled.compatibility,
    source_snapshot: compiled.sourceSnapshot, source_snapshot_sha256: compiled.sourceSnapshotSha256,
    public_projection: compiled.publicProjection, public_projection_sha256: compiled.publicProjectionSha256,
    teacher_projection: compiled.teacherProjection, teacher_projection_sha256: compiled.teacherProjectionSha256,
    asset_manifest: compiled.assetManifest, release_sha256: compiled.releaseSha256 };
}

export function compileManagedUiReleaseV2(sources, componentSlug) {
  identity(componentSlug);
  const base = compileUltimateB2ManagedComponentRelease(sources, componentSlug);
  const saved = sources.documents?.teacherUi;
  const document = saved?.payload ?? createEmptyBuilderTeacherUiDocument(componentSlug);
  if (saved && (!Number.isSafeInteger(saved.revision) || saved.revision < 1 || saved.sha256 !== hash(document))) fail();
  const ui = projectBuilderTeacherUiPreview(document, componentSlug);
  const uiAssets = managedUiAssetManifest(ui, componentSlug);
  const fontSources = overviewFontSources(sources, ui, { bookSlug: base.publicProjection.bookSlug, componentSlug });
  const nativeAssetSources = mergeOverviewFontSources(base.nativeAssetSources || [], fontSources);
  const compiled = { ...base, ...identity(componentSlug), compatibility: compatibility(componentSlug, base.compatibility),
    sourceSnapshot: { ...base.sourceSnapshot, schemaVersion: "2.0", teacherUi: { revision: saved?.revision ?? 0, sha256: hash(document) } },
    teacherProjection: { ...base.teacherProjection, schemaVersion: "2.0", ui },
    publicProjection: { ...base.publicProjection, schemaVersion: "2.0", compatibility: compatibility(componentSlug, base.compatibility) },
    nativeAssetSources,
    assetManifest: (fontSources.length ? [...new Map([...base.assetManifest, ...uiAssets, ...fontSources.map((entry) => entry.descriptor)].map((asset) => [`${asset.sha256}.${asset.extension}.${asset.role}`, asset])).values()] : [...base.assetManifest, ...uiAssets]).sort(order) };
  Object.assign(compiled, hashes(compiled));
  verifyManagedUiReleaseV2(stored(compiled), componentSlug);
  return compiled;
}

export function verifyManagedUiReleaseV2(release, componentSlug) {
  const contract = identity(componentSlug);
  if (release.compiler_id !== contract.compilerId || release.release_schema_version !== contract.releaseSchemaVersion) throw new Error("publication_compiler_mismatch");
  const sourceSnapshot = release.source_snapshot, publicProjection = release.public_projection, teacherProjection = release.teacher_projection;
  if (!exact(sourceSnapshot, ["schemaVersion", "pages", "hotspots", "activityLifecycle", "nativeIndex", "nativeActivities", "teacherUi"])
    || !exact(publicProjection, ["schemaVersion", "bookSlug", "componentSlug", "compatibility", "units", "pages", "hotspots", "nativeActivities", "activityOrder", "assets"])
    || !exact(teacherProjection, ["schemaVersion", "bookSlug", "componentSlug", "nativeActivities", "ui"])
    || sourceSnapshot.schemaVersion !== "2.0" || publicProjection?.schemaVersion !== "2.0" || teacherProjection.schemaVersion !== "2.0"
    || !exact(sourceSnapshot.teacherUi, ["revision", "sha256"]) || !Number.isSafeInteger(sourceSnapshot.teacherUi.revision)
    || sourceSnapshot.teacherUi.revision < 0 || !/^[a-f0-9]{64}$/.test(sourceSnapshot.teacherUi.sha256)) fail();
  const uiAssets = managedUiAssetManifest(teacherProjection.ui, componentSlug);
  const fontAssets = overviewCaptionFontManifest(teacherProjection.ui);
  if (sourceSnapshot.teacherUi.revision === 0 && (uiAssets.length || fontAssets.length || sourceSnapshot.teacherUi.sha256 !== hash(createEmptyBuilderTeacherUiDocument(componentSlug)))) fail();
  const native = Object.entries(publicProjection.nativeActivities || {});
  const baseCompatibility = managedV1Compatibility(componentSlug, new Set(native.map(([, entry]) => entry.kind)), native.some(([id, entry]) => usesNativeComposition(entry.document, teacherProjection.nativeActivities?.[id]?.document)));
  const expectedCompatibility = compatibility(componentSlug, baseCompatibility);
  const actual = hashes({ compatibility: expectedCompatibility, sourceSnapshot, publicProjection, teacherProjection });
  if (release.runtime_compatibility_sha256 !== expectedCompatibility || publicProjection.compatibility !== expectedCompatibility
    || actual.sourceSnapshotSha256 !== release.source_snapshot_sha256 || actual.publicProjectionSha256 !== release.public_projection_sha256
    || actual.teacherProjectionSha256 !== release.teacher_projection_sha256 || actual.releaseSha256 !== release.release_sha256
    || !Array.isArray(release.asset_manifest)) fail();
  const privateManifest = release.asset_manifest.filter((asset) => asset.role !== "teacher_ui" && !(fontAssets.some((font) => json(font) === json(asset)) && !publicProjection.assets.some((entry) => json(entry) === json(asset))));
  const expectedManifest = (fontAssets.length ? [...new Map([...privateManifest, ...uiAssets, ...fontAssets].map((asset) => [`${asset.sha256}.${asset.extension}.${asset.role}`, asset])).values()] : [...privateManifest, ...uiAssets]).sort(order);
  if (json(release.asset_manifest) !== json(expectedManifest)) fail();
  // Validate the complete closed managed representation with the frozen v1 reader.
  // This is an in-memory structural projection, never a rewrite of a stored row.
  const { teacherUi, ...baseSource } = sourceSnapshot;
  const { ui, ...baseTeacher } = teacherProjection;
  const base = { compilerId: `${componentSlug}-v1`, releaseSchemaVersion: "1.0", compatibility: baseCompatibility,
    sourceSnapshot: { ...baseSource, schemaVersion: "1.0" }, teacherProjection: { ...baseTeacher, schemaVersion: "1.0" },
    publicProjection: { ...publicProjection, schemaVersion: "1.0", compatibility: baseCompatibility },
    assetManifest: privateManifest.sort((a, b) => `${a.sha256}.${a.role}`.localeCompare(`${b.sha256}.${b.role}`)) };
  Object.assign(base, hashes(base));
  const verified = verifyUltimateB2ManagedComponentRelease(stored(base), componentSlug);
  if (json(verified.sourceSnapshot) !== json(base.sourceSnapshot)) fail();
  return { compatibility: expectedCompatibility, sourceSnapshot, publicProjection, teacherProjection };
}
