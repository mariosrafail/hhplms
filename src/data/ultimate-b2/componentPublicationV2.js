import { normalizeNativeMultiPartInteraction, normalizeNativeMultiPartSolution, validateNativeMultiPartTopology } from "../native-activities/nativeMultiPart.js";
import { normalizeNativeMarkWordsInteraction, normalizeNativeMarkWordsSolution, validateNativeMarkWordsTopology } from "../native-activities/nativeMarkWords.js";
import repositoryHotspots from "./authoring/studentsBookHotspots.json" with { type: "json" };
import { normalizeNativeActivityPublic } from "../native-activities/nativeActivityPublic.js";
import { normalizeNativeActivityTeacher, validateNativeActivityDocumentPair } from "../native-activities/nativeActivityTeacher.js";
import { normalizeNativeImageInteraction, normalizeNativeImageSolution } from "../native-activities/nativeImage.js";
import { normalizeNativeOpenResponseInteraction, normalizeNativeOpenResponseSolution, validateNativeOpenResponseTopology } from "../native-activities/nativeOpenResponse.js";
import { normalizeNativeSingleChoiceInteraction, normalizeNativeSingleChoiceSolution, validateNativeSingleChoiceTopology } from "../native-activities/nativeSingleChoice.js";
import { normalizeNativeCompleteSentencesInteraction, normalizeNativeCompleteSentencesSolution, validateNativeCompleteSentencesTopology } from "../native-activities/nativeCompleteSentences.js";
import { normalizeNativeListeningInteraction, normalizeNativeListeningSolution, validateNativeListeningTopology } from "../native-activities/nativeListening.js";
import { normalizeNativeOldschoolListeningInteraction, normalizeNativeOldschoolListeningSolution, validateNativeOldschoolListeningTopology } from "../native-activities/nativeOldschoolListening.js";
import { normalizeNativeDragDropInteraction, normalizeNativeDragDropSolution, validateNativeDragDropTopology } from "../native-activities/nativeDragDrop.js";
import { validateAndNormalizeUltimateB2HotspotManifest } from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import { ultimateB2StudentsBookAuthoringActivities } from "./studentsBookAuthoringCatalog.js";
import {
  assertStudentSafeReleaseProjection,
  normalizeUltimateB2PublicReleaseProjection,
  normalizeUltimateB2ReleaseSourceSnapshot,
  normalizeUltimateB2TeacherReleaseProjection,
} from "./componentPublication.js";
import { normalizePublishedUltimateB2UnitExtras } from "./unitExtras.js";
import {
  COMPONENT_PUBLICATION_ASSET_ROLES,
  isPublicProjectionComponentPublicationAssetRole,
} from "./componentPublicationAssetRoles.js";

export const ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION = "2.0";
export const ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPILER_ID = "ultimate-b2-students-book-v2";
export const ULTIMATE_B2_COMPONENT_RELEASE_V2_INITIAL_NATIVE_KINDS = Object.freeze(["image", "open-response"]);
export const ULTIMATE_B2_COMPONENT_RELEASE_V2_EXPANDED_NATIVE_KINDS = Object.freeze(["image", "open-response", "single-choice"]);
export const ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPLETE_SENTENCES_NATIVE_KINDS = Object.freeze(["complete-sentences", "image", "open-response", "single-choice"]);
export const ULTIMATE_B2_COMPONENT_RELEASE_V2_LISTENING_NATIVE_KINDS = Object.freeze(["complete-sentences", "image", "listening", "open-response", "single-choice"]);
export const ULTIMATE_B2_COMPONENT_RELEASE_V2_DRAG_DROP_NATIVE_KINDS = Object.freeze(["complete-sentences", "drag-drop", "image", "listening", "open-response", "single-choice"]);
export const ULTIMATE_B2_COMPONENT_RELEASE_V2_OLDSCHOOL_LISTENING_NATIVE_KINDS = Object.freeze(["complete-sentences", "drag-drop", "image", "listening", "oldschool-listening", "open-response", "single-choice"]);

export const ULTIMATE_B2_COMPONENT_RELEASE_V2_MARK_WORDS_NATIVE_KINDS = Object.freeze([...ULTIMATE_B2_COMPONENT_RELEASE_V2_OLDSCHOOL_LISTENING_NATIVE_KINDS, "mark-the-words"].sort());
export const ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS = Object.freeze([...ULTIMATE_B2_COMPONENT_RELEASE_V2_MARK_WORDS_NATIVE_KINDS, "multi-part"].sort());

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const mediaTypeByExtension = Object.freeze({ png: "image/png", jpg: "image/jpeg", webp: "image/webp", mp3: "audio/mpeg", mp4: "video/mp4", pdf: "application/pdf", ttf: "font/ttf" });

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unsupported fields.`);
}

function sourceIdentity(value, label, { nullableZeroSha = false } = {}) {
  exactObject(value, ["revision", "sha256"], label);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error(`${label} revision is invalid.`);
  if (value.revision === 0 && nullableZeroSha ? value.sha256 !== null : !SHA256.test(String(value.sha256 || ""))) throw new Error(`${label} checksum is invalid.`);
  return { revision: value.revision, sha256: value.sha256 };
}

export function nativeDefinition(kind, allowedNativeKinds = ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS) {
  if (!allowedNativeKinds.includes(kind)) throw new Error("Published native activity kind is unsupported by this release compatibility variant.");
  if (kind === "multi-part") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeMultiPartInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeMultiPartSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeActivityDocumentPair(publicDocument, teacherDocument); validateNativeMultiPartTopology(publicDocument, teacherDocument); },
  };
  if (kind === "mark-the-words") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeMarkWordsInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeMarkWordsSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeMarkWordsTopology(publicDocument, teacherDocument); },
  };
  if (kind === "open-response") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeOpenResponseInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeOpenResponseSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeActivityDocumentPair(publicDocument, teacherDocument); validateNativeOpenResponseTopology(publicDocument, teacherDocument); },
  };
  if (kind === "image") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeImageInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeImageSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeActivityDocumentPair(publicDocument, teacherDocument); },
  };
  if (kind === "single-choice") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeSingleChoiceInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeSingleChoiceSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeActivityDocumentPair(publicDocument, teacherDocument); validateNativeSingleChoiceTopology(publicDocument, teacherDocument); },
  };
  if (kind === "complete-sentences") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeCompleteSentencesInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeCompleteSentencesSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeActivityDocumentPair(publicDocument, teacherDocument); validateNativeCompleteSentencesTopology(publicDocument, teacherDocument); },
  };
  if (kind === "listening") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeListeningInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeListeningSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeActivityDocumentPair(publicDocument, teacherDocument); validateNativeListeningTopology(publicDocument, teacherDocument); },
  };
  if (kind === "oldschool-listening") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeOldschoolListeningInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeOldschoolListeningSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeActivityDocumentPair(publicDocument, teacherDocument); validateNativeOldschoolListeningTopology(publicDocument, teacherDocument); },
  };
  if (kind === "drag-drop") return {
    normalizePublic(document, activityId) { return normalizeNativeActivityPublic(document, { expectedActivityId: activityId, expectedKind: kind, normalizeInteraction: normalizeNativeDragDropInteraction }); },
    normalizeTeacher(document, activityId) { return normalizeNativeActivityTeacher(document, { expectedActivityId: activityId, expectedKind: kind, normalizeSolution: normalizeNativeDragDropSolution }); },
    validate(publicDocument, teacherDocument) { validateNativeActivityDocumentPair(publicDocument, teacherDocument); validateNativeDragDropTopology(publicDocument, teacherDocument); },
  };
  throw new Error("Published native activity kind is unsupported.");
}

function normalizeAsset(value, label) {
  exactObject(value, ["sha256", "extension", "mediaType", "role"], label);
  const extension = String(value.extension || "").toLowerCase();
  if (!SHA256.test(String(value.sha256 || "")) || !mediaTypeByExtension[extension] || value.mediaType !== mediaTypeByExtension[extension]) throw new Error(`${label} identity is invalid.`);
  if (!isPublicProjectionComponentPublicationAssetRole(value.role)) throw new Error(`${label} role is invalid.`);
  return { sha256: value.sha256, extension, mediaType: value.mediaType, role: value.role };
}

const assetIdentity = (asset) => `${asset.sha256}.${asset.extension}.${asset.role}`;

export function normalizeUltimateB2ReleaseV2SourceSnapshot(value, canonicalSeedsById, { allowedNativeKinds = ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS, includeUnitExtras = Object.hasOwn(value || {}, "unitExtras"), includePageLifecycle = Object.hasOwn(value || {}, "pageLibrary") } = {}) {
  exactObject(value, ["schemaVersion", "hotspots", "openResponse", "teacherUi", "nativeIndex", "nativeActivities", ...(includeUnitExtras ? ["unitExtras"] : []), ...(includePageLifecycle ? ["pageLibrary"] : []), ...(Object.hasOwn(value, "activityLifecycle") ? ["activityLifecycle"] : [])], "Release v2 source snapshot");
  if (value.schemaVersion !== ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION) throw new Error("Release v2 source snapshot version is invalid.");
  const legacy = normalizeUltimateB2ReleaseSourceSnapshot({
    schemaVersion: "1.0",
    hotspots: value.hotspots,
    openResponse: value.openResponse,
    teacherUi: value.teacherUi,
  }, canonicalSeedsById);
  exactObject(value.nativeActivities, Object.keys(value.nativeActivities || {}), "Release v2 native source map");
  const nativeActivities = {};
  for (const activityId of Object.keys(value.nativeActivities).sort()) {
    if (!SAFE_ID.test(activityId)) throw new Error("Release v2 native source identity is invalid.");
    const entry = value.nativeActivities[activityId];
    exactObject(entry, ["kind", "public", "teacher"], `Release v2 native source ${activityId}`);
    nativeDefinition(entry.kind, allowedNativeKinds);
    nativeActivities[activityId] = {
      kind: entry.kind,
      public: sourceIdentity(entry.public, `Release v2 native source ${activityId} public`),
      teacher: sourceIdentity(entry.teacher, `Release v2 native source ${activityId} Teacher`),
    };
  }
  return {
    schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION,
    hotspots: legacy.hotspots,
    openResponse: legacy.openResponse,
    teacherUi: legacy.teacherUi,
    nativeIndex: sourceIdentity(value.nativeIndex, "Release v2 native index"),
    ...(Object.hasOwn(value, "activityLifecycle") ? { activityLifecycle: sourceIdentity(value.activityLifecycle, "Release v2 activity lifecycle") } : {}),
    nativeActivities,
    ...(includeUnitExtras ? { unitExtras: sourceIdentity(value.unitExtras, "Release v2 Unit Extras") } : {}),
    ...(includePageLifecycle ? { pageLibrary: sourceIdentity(value.pageLibrary, "Release v2 page library") } : {}),
  };
}

function normalizeNativePublicMap(value, allowedNativeKinds) {
  exactObject(value, Object.keys(value || {}), "Published native activity map");
  const nativeActivities = {};
  for (const activityId of Object.keys(value).sort()) {
    if (!SAFE_ID.test(activityId)) throw new Error("Published native activity identity is invalid.");
    const entry = value[activityId];
    exactObject(entry, ["kind", "document"], `Published native activity ${activityId}`);
    const definition = nativeDefinition(entry.kind, allowedNativeKinds);
    nativeActivities[activityId] = { kind: entry.kind, document: definition.normalizePublic(entry.document, activityId) };
  }
  return nativeActivities;
}

function hotspotCatalog(nativeActivities) {
  return [
    ...ultimateB2StudentsBookAuthoringActivities,
    ...Object.values(nativeActivities).map((entry) => ({
      activityKey: entry.document.activityId,
      title: entry.document.metadata.title,
      pageId: entry.document.placement.pageId,
      native: true,
      kind: entry.kind,
    })),
  ];
}

export function normalizeUltimateB2PublicReleaseV2Projection(value, canonicalSeedsById, {
  allowedNativeKinds = ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS,
  expectedCompatibility = null,
  includeUnitExtras = Object.hasOwn(value || {}, "unitExtras"),
  includePageLifecycle = Object.hasOwn(value || {}, "activePageIds"),
} = {}) {
  exactObject(value, ["schemaVersion", "bookSlug", "componentSlug", "compatibility", "hotspots", "activities", "nativeActivities", "assets", ...(includeUnitExtras ? ["unitExtras"] : []), ...(includePageLifecycle ? ["activePageIds"] : []), ...(Object.hasOwn(value, "activityOrder") ? ["activityOrder"] : [])], "Public release v2");
  if (value.schemaVersion !== ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION || value.bookSlug !== "ultimate-b2" || value.componentSlug !== "ultimate-b2-students-book" || !SHA256.test(String(value.compatibility || "")) || (expectedCompatibility !== null && value.compatibility !== expectedCompatibility)) throw new Error("Public release v2 identity is invalid.");
  const nativeActivities = normalizeNativePublicMap(value.nativeActivities, allowedNativeKinds);
  const hotspots = validateAndNormalizeUltimateB2HotspotManifest(value.hotspots, hotspotCatalog(nativeActivities));
  const rawAssets = Array.isArray(value.assets) ? value.assets.map((asset, index) => normalizeAsset(asset, `Public release v2 assets[${index}]`)) : null;
  if (!rawAssets) throw new Error("Public release v2 assets are invalid.");
  const legacyAssets = rawAssets.filter((asset) => asset.role === COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK);
  const legacy = normalizeUltimateB2PublicReleaseProjection({
    schemaVersion: "1.0",
    bookSlug: value.bookSlug,
    componentSlug: value.componentSlug,
    compatibility: value.compatibility,
    hotspots: structuredClone(repositoryHotspots),
    activities: value.activities,
    assets: legacyAssets,
  }, canonicalSeedsById);
  const expectedNative = Object.values(nativeActivities).flatMap((entry) => entry.document.assets.map((asset) => `${asset.checksumSha256}.${asset.role}`));
  const actualNative = rawAssets.filter((asset) => [COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_ARTWORK, COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_FONT].includes(asset.role)).map((asset) => `${asset.sha256}.${asset.role}`);
  const unitExtras = includeUnitExtras ? normalizePublishedUltimateB2UnitExtras(value.unitExtras) : null;
  const activePageIds = includePageLifecycle && Array.isArray(value.activePageIds) ? value.activePageIds.map((id) => String(id)) : null;
  if (includePageLifecycle && (!activePageIds || activePageIds.some((id) => !SAFE_ID.test(id)) || new Set(activePageIds).size !== activePageIds.length)) throw new Error("Public release v2 active page identities are invalid.");
  const expectedUnitExtras = unitExtras ? unitExtras.units.flatMap((unit) => [
    ...unit.categories.videos.map((entry) => `${entry.video.asset.checksumSha256}.${COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_VIDEO}`),
    ...(unit.categories.audios ?? []).map((entry) => `${entry.audio.asset.checksumSha256}.${COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_AUDIO}`),
  ]) : [];
  const actualUnitExtras = rawAssets.filter((asset) => [COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_VIDEO, COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_AUDIO].includes(asset.role)).map((asset) => `${asset.sha256}.${asset.role}`);
  if (new Set(rawAssets.map(assetIdentity)).size !== rawAssets.length
    || new Set(actualNative).size !== actualNative.length
    || [...new Set(expectedNative)].sort().join("\0") !== [...actualNative].sort().join("\0")
    || new Set(actualUnitExtras).size !== actualUnitExtras.length
    || [...new Set(expectedUnitExtras)].sort().join("\0") !== [...actualUnitExtras].sort().join("\0")) throw new Error("Public release v2 managed asset manifest is inconsistent.");
  const normalized = {
    schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION,
    bookSlug: value.bookSlug,
    componentSlug: value.componentSlug,
    compatibility: value.compatibility,
    hotspots,
    activities: legacy.activities,
    ...(Object.hasOwn(value, "activityOrder") ? { activityOrder: normalizeComponentActivityOrder(value.activityOrder, {
      pageIds: activePageIds ? new Set(activePageIds) : null,
      activityIds: new Set([...ultimateB2StudentsBookAuthoringActivities.map((entry) => entry.activityKey), ...Object.keys(nativeActivities)]),
      nativeActivities,
    }) } : {}),
    nativeActivities,
    ...(unitExtras ? { unitExtras } : {}),
    ...(activePageIds ? { activePageIds } : {}),
    assets: rawAssets,
  };
  assertStudentSafeReleaseProjection(normalized);
  return normalized;
}

export function normalizeUltimateB2TeacherReleaseV2Projection(value, canonicalSeedsById, publicProjection = null, { allowedNativeKinds = ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS } = {}) {
  exactObject(value, ["schemaVersion", "bookSlug", "componentSlug", "solutions", "ui", "nativeActivities"], "Teacher release v2");
  if (value.schemaVersion !== ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION || value.bookSlug !== "ultimate-b2" || value.componentSlug !== "ultimate-b2-students-book") throw new Error("Teacher release v2 identity is invalid.");
  const legacy = normalizeUltimateB2TeacherReleaseProjection({ schemaVersion: "1.0", bookSlug: value.bookSlug, componentSlug: value.componentSlug, solutions: value.solutions, ui: value.ui }, canonicalSeedsById);
  exactObject(value.nativeActivities, Object.keys(value.nativeActivities || {}), "Teacher release v2 native activity map");
  const nativeActivities = {};
  for (const activityId of Object.keys(value.nativeActivities).sort()) {
    const entry = value.nativeActivities[activityId];
    exactObject(entry, ["kind", "document"], `Teacher release v2 native activity ${activityId}`);
    const definition = nativeDefinition(entry.kind, allowedNativeKinds);
    const teacherDocument = definition.normalizeTeacher(entry.document, activityId);
    const publicEntry = publicProjection?.nativeActivities?.[activityId];
    if (publicProjection && (!publicEntry || publicEntry.kind !== entry.kind)) throw new Error("Teacher release v2 native topology is inconsistent.");
    if (publicEntry) definition.validate(publicEntry.document, teacherDocument);
    nativeActivities[activityId] = { kind: entry.kind, document: teacherDocument };
  }
  if (publicProjection && Object.keys(nativeActivities).sort().join("\0") !== Object.keys(publicProjection.nativeActivities).sort().join("\0")) throw new Error("Teacher release v2 native topology is incomplete.");
  return { schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION, bookSlug: value.bookSlug, componentSlug: value.componentSlug, solutions: legacy.solutions, ui: legacy.ui, nativeActivities };
}
import { normalizeComponentActivityOrder } from "../native-activities/nativeActivityOrder.js";
