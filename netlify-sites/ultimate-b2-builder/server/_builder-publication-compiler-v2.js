import { nativeMultiPartAssetRequirements } from "../../../src/data/native-activities/nativeMultiPart.js";
import { nativeTeacherAnswerImages, nativeTeacherAnswerAssetDescriptors } from "../../../src/data/native-activities/nativeImageSampleAnswer.js";
import { nativeMarkWordsAssetRequirements } from "../../../src/data/native-activities/nativeMarkWords.js";
import repositoryHotspots from "../../../src/data/ultimate-b2/authoring/studentsBookHotspots.json" with { type: "json" };
import { nativeAudioTextAssetRequirements } from "../../../src/data/native-activities/nativeAudioTextHotspots.js";
import { createEmptyNativeActivityIndex, nativeReadableTextAssetRequirements, nativeSupplementalAudioAssetRequirements, nativeVideoAssetRequirements, NATIVE_ACTIVITY_INDEX_SCHEMA_VERSION, NATIVE_ACTIVITY_SCHEMA_VERSION } from "../../../src/data/native-activities/nativeActivityPublic.js";
import { nativeSingleChoicePresentationAssetRequirements } from "../../../src/data/native-activities/nativeSingleChoice.js";
import { nativeCompleteSentencesAssetRequirements } from "../../../src/data/native-activities/nativeCompleteSentences.js";
import { nativeListeningAssetRequirements } from "../../../src/data/native-activities/nativeListening.js";
import { nativeOldschoolListeningAssetRequirements } from "../../../src/data/native-activities/nativeOldschoolListening.js";
import { nativeDragDropAssetRequirements } from "../../../src/data/native-activities/nativeDragDrop.js";
import { nativeOpenResponseAssetRequirements } from "../../../src/data/native-activities/nativeOpenResponse.js";
import { ultimateB2StudentsBookAuthoringActivities } from "../../../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import { applyUltimateB2ActivityLifecycle, createEmptyUltimateB2ActivityLifecycle } from "../../../src/data/ultimate-b2/activityLifecycle.js";
import { createEmptyUltimateB2UnitExtras, projectUltimateB2UnitExtrasForPublication, ULTIMATE_B2_UNIT_EXTRAS_SCHEMA_VERSION } from "../../../src/data/ultimate-b2/unitExtras.js";
import { COMPONENT_PUBLICATION_ASSET_ROLES } from "../../../src/data/ultimate-b2/componentPublicationAssetRoles.js";
import {
  normalizeUltimateB2PublicReleaseV2Projection,
  normalizeUltimateB2ReleaseV2SourceSnapshot,
  normalizeUltimateB2TeacherReleaseV2Projection,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_MARK_WORDS_NATIVE_KINDS,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPILER_ID,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_EXPANDED_NATIVE_KINDS,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPLETE_SENTENCES_NATIVE_KINDS,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_LISTENING_NATIVE_KINDS,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_DRAG_DROP_NATIVE_KINDS,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_OLDSCHOOL_LISTENING_NATIVE_KINDS,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_INITIAL_NATIVE_KINDS,
  ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION,
} from "../../../src/data/ultimate-b2/componentPublicationV2.js";
import { validateAndNormalizeUltimateB2HotspotManifest } from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import { builderDocumentSha256, stableBuilderJson } from "./_builder-content-security.js";
import { resolveNativeActivityKind } from "./_native-activity-registry.js";
import { compileUltimateB2ComponentRelease, ultimateB2PublicationCanonicalSeeds, ultimateB2PublicationCompatibility, ultimateB2PublicationCompatibilityBeforeVideoWorksheetBinding } from "./_builder-publication-compiler.js";
import { canonicalStudentsBookPages } from "./_builder-page-catalog.js";

const extensionByMediaType = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "audio/mpeg": "mp3", "video/mp4": "mp4", "application/pdf": "pdf", "font/ttf": "ttf" });
const V2_PUBLISHABLE_NATIVE_KINDS = new Set(ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS);

function publicationV2CompatibilityDescriptor(nativeKinds, { nativeComposition = false, unitExtras = false, pageLifecycle = false, legacyRuntimeCompatibility = ultimateB2PublicationCompatibility() } = {}) {
  return Object.freeze({
    compilerId: ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPILER_ID,
    releaseSchemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION,
    legacyRuntimeCompatibility,
    hotspotSchemaVersion: repositoryHotspots.schemaVersion,
    nativeActivitySchemaVersion: NATIVE_ACTIVITY_SCHEMA_VERSION,
    nativeIndexSchemaVersion: NATIVE_ACTIVITY_INDEX_SCHEMA_VERSION,
    nativeKinds: Object.freeze([...nativeKinds].sort()),
    releaseAssetDescriptorSchemaVersion: "1.0",
    ...(nativeComposition ? { nativeComposition: { multiPart: "multi-part.v1", dragImageItems: "1.0", oldschoolQuestionSurface: "1.0", protectedImageSampleAnswer: "1.0" } } : {}),
    ...(unitExtras ? { unitExtrasSchemaVersion: ULTIMATE_B2_UNIT_EXTRAS_SCHEMA_VERSION } : {}),
    ...(pageLifecycle ? { pageLifecycleSchemaVersion: "1.0" } : {}),
  });
}

const previousLegacyRuntimeCompatibility = ultimateB2PublicationCompatibilityBeforeVideoWorksheetBinding();
const previousDescriptorOptions = Object.freeze({ legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility });
const V2_COMPATIBILITY_IDENTITIES = Object.freeze({
  compositionExpanded: builderDocumentSha256(publicationV2CompatibilityDescriptor(ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS, { unitExtras: true, pageLifecycle: true, nativeComposition: true })),
  markWordsExpanded: builderDocumentSha256(publicationV2CompatibilityDescriptor(ULTIMATE_B2_COMPONENT_RELEASE_V2_MARK_WORDS_NATIVE_KINDS, { unitExtras: true, pageLifecycle: true })),
  initialImageOpenResponse: "ab4b8255596ce01a0e7132d37c33b62683e384f2f178eed313bfeef62091027e",
  singleChoiceExpanded: "f1fca746955e58c0c4153c97a717a2f5e024cb5d12eb9263ad8c6b2a7caf9316",
  completeSentencesExpanded: "bc5b6c72383a155d51b4dabadbc717a442df2878d57245882cba91f27bf74985",
  listeningExpanded: "705a2e4a5dbe5db38d17720e80d811496b8816a8778df89ddf616ad9617a857c",
  dragDropExpanded: builderDocumentSha256(publicationV2CompatibilityDescriptor(ULTIMATE_B2_COMPONENT_RELEASE_V2_DRAG_DROP_NATIVE_KINDS, previousDescriptorOptions)),
  unitExtrasExpanded: builderDocumentSha256(publicationV2CompatibilityDescriptor(ULTIMATE_B2_COMPONENT_RELEASE_V2_DRAG_DROP_NATIVE_KINDS, { ...previousDescriptorOptions, unitExtras: true })),
  pageLifecycleExpanded: builderDocumentSha256(publicationV2CompatibilityDescriptor(ULTIMATE_B2_COMPONENT_RELEASE_V2_DRAG_DROP_NATIVE_KINDS, { ...previousDescriptorOptions, unitExtras: true, pageLifecycle: true })),
  oldschoolListeningExpanded: builderDocumentSha256(publicationV2CompatibilityDescriptor(ULTIMATE_B2_COMPONENT_RELEASE_V2_OLDSCHOOL_LISTENING_NATIVE_KINDS, { ...previousDescriptorOptions, unitExtras: true, pageLifecycle: true })),
  nativeMediaExpanded: builderDocumentSha256(publicationV2CompatibilityDescriptor(ULTIMATE_B2_COMPONENT_RELEASE_V2_OLDSCHOOL_LISTENING_NATIVE_KINDS, { unitExtras: true, pageLifecycle: true })),
});

export const ULTIMATE_B2_PUBLICATION_V2_COMPATIBILITY_VARIANTS = Object.freeze([
  Object.freeze({
    name: "initial-image-open-response",
    compatibility: V2_COMPATIBILITY_IDENTITIES.initialImageOpenResponse,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_INITIAL_NATIVE_KINDS,
    legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility,
  }),
  Object.freeze({
    name: "single-choice-expanded",
    compatibility: V2_COMPATIBILITY_IDENTITIES.singleChoiceExpanded,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_EXPANDED_NATIVE_KINDS,
    legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility,
  }),
  Object.freeze({
    name: "complete-sentences-expanded",
    compatibility: V2_COMPATIBILITY_IDENTITIES.completeSentencesExpanded,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPLETE_SENTENCES_NATIVE_KINDS,
    legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility,
  }),
  Object.freeze({
    name: "listening-expanded",
    compatibility: V2_COMPATIBILITY_IDENTITIES.listeningExpanded,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_LISTENING_NATIVE_KINDS,
    legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility,
  }),
  Object.freeze({
    name: "drag-drop-expanded",
    compatibility: V2_COMPATIBILITY_IDENTITIES.dragDropExpanded,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_DRAG_DROP_NATIVE_KINDS,
    unitExtras: false,
    legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility,
  }),
  Object.freeze({
    name: "unit-extras-expanded",
    compatibility: V2_COMPATIBILITY_IDENTITIES.unitExtrasExpanded,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_DRAG_DROP_NATIVE_KINDS,
    unitExtras: true,
    legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility,
  }),
  Object.freeze({
    name: "page-lifecycle-expanded",
    compatibility: V2_COMPATIBILITY_IDENTITIES.pageLifecycleExpanded,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_DRAG_DROP_NATIVE_KINDS,
    unitExtras: true,
    pageLifecycle: true,
    legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility,
  }),
  Object.freeze({
    name: "oldschool-listening-expanded",
    compatibility: V2_COMPATIBILITY_IDENTITIES.oldschoolListeningExpanded,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_OLDSCHOOL_LISTENING_NATIVE_KINDS,
    unitExtras: true,
    pageLifecycle: true,
    legacyRuntimeCompatibility: previousLegacyRuntimeCompatibility,
  }),
  Object.freeze({
    name: "native-media-expanded",
    compatibility: V2_COMPATIBILITY_IDENTITIES.nativeMediaExpanded,
    nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_OLDSCHOOL_LISTENING_NATIVE_KINDS,
    unitExtras: true,
    pageLifecycle: true,
  }),
  Object.freeze({ name: "mark-words-expanded", compatibility: V2_COMPATIBILITY_IDENTITIES.markWordsExpanded, nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_MARK_WORDS_NATIVE_KINDS, unitExtras: true, pageLifecycle: true }),
  Object.freeze({ name: "native-composition-expanded", compatibility: V2_COMPATIBILITY_IDENTITIES.compositionExpanded, nativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS, unitExtras: true, pageLifecycle: true, nativeComposition: true }),
]);

const v2CompatibilityVariantsByIdentity = new Map(
  ULTIMATE_B2_PUBLICATION_V2_COMPATIBILITY_VARIANTS.map((variant) => [variant.compatibility, variant]),
);

export class NativePublicationError extends Error {
  constructor(code, activityId, issues = []) {
    super(code);
    this.name = "NativePublicationError";
    this.code = code;
    this.activityId = activityId || null;
    this.issues = [...issues].map((issue) => String(issue).slice(0, 200));
  }
}

export function ultimateB2PublicationV2CompatibilityDescriptor(nativeKinds, options) {
  return publicationV2CompatibilityDescriptor(nativeKinds, options);
}

export function reconstructUltimateB2PublicationV2Compatibility(nativeKinds, options) {
  return builderDocumentSha256(ultimateB2PublicationV2CompatibilityDescriptor(nativeKinds, options));
}

export function resolveUltimateB2PublicationV2CompatibilityVariant(compatibility) {
  return v2CompatibilityVariantsByIdentity.get(compatibility) || null;
}

export function ultimateB2PublicationV2Compatibility() {
  return V2_COMPATIBILITY_IDENTITIES.compositionExpanded;
}

export function isUltimateB2PublicationV2NativeKind(kind) {
  return V2_PUBLISHABLE_NATIVE_KINDS.has(kind);
}

function activityCatalog(nativeActivities, lifecycle) {
  return [
    ...applyUltimateB2ActivityLifecycle(ultimateB2StudentsBookAuthoringActivities, lifecycle),
    ...Object.values(nativeActivities).map(({ index, public: publicSource }) => ({
      activityKey: index.activityId,
      title: publicSource?.payload?.metadata?.title || index.activityId,
      pageId: index.placement.pageId,
      kind: index.kind,
      native: true,
    })),
  ];
}

function referencedNativeIds(hotspots, nativeActivities) {
  const nativeIds = new Set(Object.keys(nativeActivities));
  return [...new Set(Object.values(hotspots.pages).flat().map((hotspot) => hotspot.activityKey).filter((activityId) => nativeIds.has(activityId)))].sort();
}

export function validateNativePublicationAssetRows(nativeEntries, assetRows) {
  const byId = new Map(assetRows.map((row) => [String(row.id), row]));
  const sources = new Map();
  for (const [activityId, entry] of nativeEntries) {
    const answerImages = nativeTeacherAnswerImages(entry.teacherDocument);
    const references = [...entry.publicDocument.assets, ...answerImages.map((image) => image.reference)];
    for (const reference of references) {
      const row = byId.get(reference.assetId);
      const extension = extensionByMediaType[row?.mime_type];
      const libraryFont = reference.role === COMPONENT_PUBLICATION_ASSET_ROLES.ACTIVITY_FONT;
      const owned = libraryFont
        ? row?.source_metadata?.font_library_scope === "component" && reference.slot === `font-${String(reference.assetId).replaceAll("-", "").toLowerCase()}`
        : row?.source_metadata?.native_activity_id === activityId && row?.source_metadata?.asset_slot === reference.slot;
      if (!row || row.checksum_sha256 !== reference.checksumSha256 || row.asset_role !== reference.role
        || row.publication_status !== "draft" || row.access_level !== "internal" || row.storage_profile !== "private"
        || !owned
        || !extension || !row.object_key || !Number.isSafeInteger(Number(row.byte_size)) || Number(row.byte_size) < 1
        || (row.mime_type.startsWith("image/") && (!Number.isSafeInteger(Number(row.width)) || !Number.isSafeInteger(Number(row.height))))) {
        throw new NativePublicationError("native_activity_asset_invalid", activityId, ["Managed artwork is missing, invalid, or owned by another activity."]);
      }
      const identity = `${reference.checksumSha256}.${extension}.${reference.role}`;
      const existing = sources.get(identity);
      if (existing && existing.descriptor.mediaType !== row.mime_type) throw new NativePublicationError("native_activity_asset_invalid", activityId, ["Managed artwork content identity is inconsistent."]);
      if (!existing) sources.set(identity, {
        descriptor: { sha256: reference.checksumSha256, extension, mediaType: row.mime_type, role: reference.role },
        row,
      });
    }
    {
      const requirements = [
        ...answerImages.map((image) => ({ slot: image.reference.slot, width: image.sourceWidth, height: image.sourceHeight, mediaType: image.mediaType, label: "Protected Sample answer" })),
        ...nativeReadableTextAssetRequirements(entry.publicDocument),
        ...nativeSupplementalAudioAssetRequirements(entry.publicDocument),
        ...nativeVideoAssetRequirements(entry.publicDocument),
        ...nativeAudioTextAssetRequirements(entry.publicDocument),
        ...(entry.publicDocument.kind === "multi-part" ? nativeMultiPartAssetRequirements(entry.publicDocument) : []),
        ...(entry.publicDocument.kind === "mark-the-words" ? nativeMarkWordsAssetRequirements(entry.publicDocument) : []),
        ...(entry.publicDocument.kind === "single-choice" ? nativeSingleChoicePresentationAssetRequirements(entry.publicDocument) : []),
        ...(entry.publicDocument.kind === "complete-sentences" ? nativeCompleteSentencesAssetRequirements(entry.publicDocument) : []),
        ...(entry.publicDocument.kind === "listening" ? nativeListeningAssetRequirements(entry.publicDocument) : []),
        ...(entry.publicDocument.kind === "oldschool-listening" ? nativeOldschoolListeningAssetRequirements(entry.publicDocument) : []),
        ...(entry.publicDocument.kind === "drag-drop" ? nativeDragDropAssetRequirements(entry.publicDocument) : []),
        ...(entry.publicDocument.kind === "open-response" ? nativeOpenResponseAssetRequirements(entry.publicDocument) : []),
      ];
      for (const requirement of requirements) {
        const reference = references.find((asset) => asset.slot === requirement.slot);
        const row = reference ? byId.get(reference.assetId) : null;
        if (!row || (requirement.mediaType && row.mime_type !== requirement.mediaType)) {
          throw new NativePublicationError("native_activity_asset_invalid", activityId, [`${requirement.label || "Native managed asset"} media type does not match the managed asset.`]);
        }
        if (requirement.byteSize !== undefined && Number(row.byte_size) !== requirement.byteSize) {
          throw new NativePublicationError("native_activity_asset_invalid", activityId, [`${requirement.label || "Native managed asset"} byte size does not match the managed asset.`]);
        }
        if ((requirement.width !== undefined || requirement.height !== undefined)
          && (Number(row.width) !== requirement.width || Number(row.height) !== requirement.height)) {
          throw new NativePublicationError("native_activity_asset_invalid", activityId, [`${requirement.label || "Managed image"} dimensions do not match the managed asset.`]);
        }
      }
    }
  }
  return [...sources.values()].sort((left, right) => `${left.descriptor.sha256}.${left.descriptor.extension}`.localeCompare(`${right.descriptor.sha256}.${right.descriptor.extension}`));
}

export function validateUnitExtraAssetRows(document, assetRows) {
  const byId = new Map(assetRows.map((row) => [String(row.id), row]));
  const sources = new Map();
  for (const unit of document.units) for (const video of unit.categories.videos) {
    if (!video.asset) throw new NativePublicationError("unit_extra_video_not_ready", video.id, ["A managed MP4 is required."]);
    const row = byId.get(video.asset.assetId);
    if (!row || row.checksum_sha256 !== video.asset.checksumSha256 || row.asset_role !== COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_VIDEO
      || row.mime_type !== "video/mp4" || row.publication_status !== "draft" || row.access_level !== "internal" || row.storage_profile !== "private"
      || row.activity_id !== null || row.page_id !== null || row.source_metadata?.unit_slug !== unit.unitId
      || row.source_metadata?.unit_extra_item_id !== video.id || row.source_metadata?.asset_slot !== video.assetSlot
      || Number(row.byte_size) !== video.byteSize || Math.round(Number(row.duration_seconds) * 1_000) !== video.durationMs || !row.object_key) {
      throw new NativePublicationError("unit_extra_asset_invalid", video.id, ["Managed MP4 is missing, invalid, or owned by another Unit."]);
    }
    const identity = `${row.checksum_sha256}.mp4`;
    if (!sources.has(identity)) sources.set(identity, { descriptor: { sha256: row.checksum_sha256, extension: "mp4", mediaType: "video/mp4", role: COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_VIDEO }, row });
  }
  for (const unit of document.units) for (const audio of unit.categories.audios || []) {
    if (!audio.asset) throw new NativePublicationError("unit_extra_audio_not_ready", audio.id, ["A managed MP3 is required."]);
    const row = byId.get(audio.asset.assetId);
    if (!row || row.checksum_sha256 !== audio.asset.checksumSha256 || row.asset_role !== COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_AUDIO
      || row.mime_type !== "audio/mpeg" || row.publication_status !== "draft" || row.access_level !== "internal" || row.storage_profile !== "private"
      || row.activity_id !== null || row.page_id !== null || row.source_metadata?.unit_slug !== unit.unitId
      || row.source_metadata?.unit_extra_item_id !== audio.id || row.source_metadata?.asset_slot !== audio.assetSlot
      || Number(row.byte_size) !== audio.byteSize || !row.object_key) {
      throw new NativePublicationError("unit_extra_audio_asset_invalid", audio.id, ["Managed MP3 is missing, invalid, or owned by another Unit."]);
    }
    const identity = `${row.checksum_sha256}.mp3`;
    if (!sources.has(identity)) sources.set(identity, { descriptor: { sha256: row.checksum_sha256, extension: "mp3", mediaType: "audio/mpeg", role: COMPONENT_PUBLICATION_ASSET_ROLES.UNIT_EXTRA_AUDIO }, row });
  }
  return [...sources.values()].sort((left, right) => left.descriptor.sha256.localeCompare(right.descriptor.sha256));
}

export function collectNativeEntriesForPublication(sources, hotspots) {
  const selected = [];
  for (const activityId of referencedNativeIds(hotspots, sources.native.activities)) {
    const source = sources.native.activities[activityId];
    if (!source?.public || !source?.teacher) throw new NativePublicationError("native_activity_not_found", activityId, ["The saved native activity pair is incomplete."]);
    if (!isUltimateB2PublicationV2NativeKind(source.index.kind)) throw new NativePublicationError("native_activity_pair_invalid", activityId, ["The native activity kind is unsupported by publication v2."]);
    const kind = resolveNativeActivityKind(source.index.kind);
    if (!kind) throw new NativePublicationError("native_activity_pair_invalid", activityId, ["The native activity kind is unsupported."]);
    let publicDocument;
    let teacherDocument;
    try {
      publicDocument = kind.normalizePublic(source.public.payload, activityId);
      teacherDocument = kind.normalizeTeacher(source.teacher.payload, activityId);
      if (publicDocument.kind !== source.index.kind || teacherDocument.kind !== source.index.kind
        || publicDocument.placement.pageId !== source.index.placement.pageId) throw new Error("Native index and document identity do not match.");
      kind.validatePair(publicDocument, teacherDocument);
    } catch {
      throw new NativePublicationError("native_activity_pair_invalid", activityId, ["Public, Teacher, and index activity identities do not match."]);
    }
    const readiness = kind.assessReadiness(publicDocument, teacherDocument);
    if (!readiness.ready) throw new NativePublicationError("native_activity_not_ready", activityId, readiness.issues);
    selected.push([activityId, { source, publicDocument, teacherDocument }]);
  }
  return selected;
}

export function compileUltimateB2ComponentReleaseV2(sources = {}) {
  const nativeActivities = sources.native?.activities || {};
  const activityLifecycle = sources.documents?.activityLifecycle?.payload || createEmptyUltimateB2ActivityLifecycle();
  const hotspotSource = sources.documents?.hotspots || null;
  let hotspots;
  try {
    hotspots = validateAndNormalizeUltimateB2HotspotManifest(hotspotSource?.payload || structuredClone(repositoryHotspots), activityCatalog(nativeActivities, activityLifecycle));
  } catch (error) {
    const ambiguous = String(error?.message || "").startsWith("Ambiguous Students Book activity id:");
    throw new NativePublicationError(ambiguous ? "native_activity_pair_invalid" : "native_activity_not_found", null, [String(error?.message || "Saved hotspot target is invalid.")]);
  }
  const selectedNative = collectNativeEntriesForPublication(sources, hotspots);
  const nativeAssetSources = validateNativePublicationAssetRows(selectedNative, sources.native?.assetRows || []);
  const unitExtrasSource = sources.unitExtras?.document || null;
  const unitExtrasDocument = unitExtrasSource?.payload || createEmptyUltimateB2UnitExtras();
  const unitExtraAssetSources = validateUnitExtraAssetRows(unitExtrasDocument, sources.unitExtras?.assetRows || []);
  const unitExtras = projectUltimateB2UnitExtrasForPublication(unitExtrasDocument);
  const rowsByPageId = new Map((sources.pages?.rows || []).map((row) => [String(row.stable_key).split("/").pop(), row]));
  const activePageIds = canonicalStudentsBookPages.filter((page) => rowsByPageId.get(page.id)?.source_metadata?.is_deleted !== true).map((page) => page.id);
  const pageLibrarySource = { revision: Number(sources.pages?.revision || 0), sha256: builderDocumentSha256(activePageIds) };

  const legacy = compileUltimateB2ComponentRelease({
    documents: { ...sources.documents, hotspots: null },
    imports: sources.imports,
  });
  const compatibility = ultimateB2PublicationV2Compatibility();
  const seeds = ultimateB2PublicationCanonicalSeeds();
  const sourceSnapshot = normalizeUltimateB2ReleaseV2SourceSnapshot({
    schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION,
    hotspots: hotspotSource ? { revision: hotspotSource.revision, sha256: hotspotSource.sha256 } : { revision: 0, sha256: builderDocumentSha256(validateAndNormalizeUltimateB2HotspotManifest(structuredClone(repositoryHotspots))) },
    openResponse: legacy.sourceSnapshot.openResponse,
    teacherUi: legacy.sourceSnapshot.teacherUi,
    activityLifecycle: sources.documents?.activityLifecycle ? { revision: sources.documents.activityLifecycle.revision, sha256: sources.documents.activityLifecycle.sha256 } : { revision: 0, sha256: builderDocumentSha256(createEmptyUltimateB2ActivityLifecycle()) },
    nativeIndex: sources.native?.index ? { revision: sources.native.index.revision, sha256: sources.native.index.sha256 } : { revision: 0, sha256: builderDocumentSha256(createEmptyNativeActivityIndex()) },
    nativeActivities: Object.fromEntries(selectedNative.map(([activityId, entry]) => [activityId, {
      kind: entry.publicDocument.kind,
      public: { revision: entry.source.public.revision, sha256: entry.source.public.sha256 },
      teacher: { revision: entry.source.teacher.revision, sha256: entry.source.teacher.sha256 },
    }])),
    unitExtras: unitExtrasSource ? { revision: unitExtrasSource.revision, sha256: unitExtrasSource.sha256 } : { revision: 0, sha256: builderDocumentSha256(createEmptyUltimateB2UnitExtras()) },
    pageLibrary: pageLibrarySource,
  }, seeds, { allowedNativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS, includeUnitExtras: true, includePageLifecycle: true });
  const publicProjection = normalizeUltimateB2PublicReleaseV2Projection({
    schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION,
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    compatibility,
    hotspots,
    activities: legacy.publicProjection.activities,
    activityOrder: projectComponentActivityOrder(componentActivityOrderEntries(ultimateB2StudentsBookAuthoringActivities, { activities: Object.values(nativeActivities).map((entry) => entry.index) }, activityLifecycle).filter((entry) => activePageIds.includes(entry.pageId)), new Set([...ultimateB2StudentsBookAuthoringActivities.map((entry) => entry.activityKey), ...selectedNative.map(([id]) => id)])),
    nativeActivities: Object.fromEntries(selectedNative.map(([activityId, entry]) => [activityId, { kind: entry.publicDocument.kind, document: entry.publicDocument }])),
    unitExtras,
    activePageIds,
    assets: [...legacy.publicProjection.assets, ...nativeAssetSources.filter((asset) => asset.descriptor.role !== "native_teacher_answer").map((asset) => asset.descriptor), ...unitExtraAssetSources.map((asset) => asset.descriptor)],
  }, seeds, {
    allowedNativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS,
    expectedCompatibility: compatibility,
    includeUnitExtras: true,
    includePageLifecycle: true,
  });
  const teacherProjection = normalizeUltimateB2TeacherReleaseV2Projection({
    schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION,
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    solutions: legacy.teacherProjection.solutions,
    ui: legacy.teacherProjection.ui,
    nativeActivities: Object.fromEntries(selectedNative.map(([activityId, entry]) => [activityId, { kind: entry.teacherDocument.kind, document: entry.teacherDocument }])),
  }, seeds, publicProjection, { allowedNativeKinds: ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPOSITION_NATIVE_KINDS });
  const assetManifest = [...legacy.assetManifest, ...nativeAssetSources.map((asset) => asset.descriptor), ...unitExtraAssetSources.map((asset) => asset.descriptor)]
    .sort((left, right) => `${left.sha256}.${left.extension}.${left.role}`.localeCompare(`${right.sha256}.${right.extension}.${right.role}`));
  const hashes = {
    sourceSnapshotSha256: builderDocumentSha256(sourceSnapshot),
    publicProjectionSha256: builderDocumentSha256(publicProjection),
    teacherProjectionSha256: builderDocumentSha256(teacherProjection),
  };
  return {
    compilerId: ULTIMATE_B2_COMPONENT_RELEASE_V2_COMPILER_ID,
    releaseSchemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_V2_SCHEMA_VERSION,
    compatibility,
    sourceSnapshot,
    publicProjection,
    teacherProjection,
    assetManifest,
    nativeAssetSources: [...nativeAssetSources, ...unitExtraAssetSources],
    ...hashes,
    releaseSha256: builderDocumentSha256({ compatibility, sourceSnapshot, publicProjection, teacherProjection }),
    stableJson: stableBuilderJson({ compatibility, sourceSnapshot, publicProjection, teacherProjection }),
  };
}
import { componentActivityOrderEntries, projectComponentActivityOrder } from "../../../src/data/native-activities/nativeActivityOrder.js";
