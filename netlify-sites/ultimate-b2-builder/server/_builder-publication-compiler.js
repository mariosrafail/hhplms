import repositoryHotspots from "../../../src/data/ultimate-b2/authoring/studentsBookHotspots.json" with { type: "json" };
import { builderDocumentSha256, stableBuilderJson } from "./_builder-content-security.js";
import { createUltimateB2HostedOpenResponseSeed } from "../../../src/data/ultimate-b2/hostedOpenResponseDraft.js";
import { normalizeUltimateB2HostedOpenResponseImport, normalizeUltimateB2HostedOpenResponseTeacherImport, ULTIMATE_B2_HOSTED_OPEN_RESPONSE_IMPORT_SCHEMA_VERSION, ULTIMATE_B2_HOSTED_OPEN_RESPONSE_TEACHER_SCHEMA_VERSION } from "../../../src/data/ultimate-b2/hostedOpenResponseImport.js";
import { ULTIMATE_B2_OPEN_RESPONSE_ACTIVITY_IDS } from "../../../src/data/ultimate-b2/openResponseActivityRegistry.js";
import { findStudentsBookImplementation } from "../../../src/data/ultimate-b2/studentsBookCatalog.js";
import { createEmptyHostedTeacherUiDocument, normalizeHostedTeacherUiDocument, projectHostedTeacherUiPreview } from "../../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { HOSTED_EDITABLE_UI_BINDINGS_BY_ID } from "../../../src/data/ultimate-b2/hostedTeacherUiBindingCatalog.js";
import { COMPONENT_PUBLICATION_ASSET_ROLES } from "../../../src/data/ultimate-b2/componentPublicationAssetRoles.js";
import { validateAndNormalizeUltimateB2HotspotManifest } from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import {
  assertStudentSafeReleaseProjection,
  normalizeUltimateB2PublicReleaseProjection,
  normalizeUltimateB2ReleaseSourceSnapshot,
  normalizeUltimateB2TeacherReleaseProjection,
  ULTIMATE_B2_COMPONENT_RELEASE_COMPILER_ID,
  ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION,
} from "../../../src/data/ultimate-b2/componentPublication.js";

const mediaTypes = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function ultimateB2PublicationCanonicalSeeds() {
  return Object.fromEntries([...ULTIMATE_B2_OPEN_RESPONSE_ACTIVITY_IDS].sort().map((activityId) => {
    const activity = findStudentsBookImplementation(activityId);
    if (!activity) throw new Error(`Publication activity is unavailable: ${activityId}`);
    return [activityId, createUltimateB2HostedOpenResponseSeed(activity)];
  }));
}

export function ultimateB2PublicationCompatibilityDescriptor(teacherUiBindingIds = Object.keys(HOSTED_EDITABLE_UI_BINDINGS_BY_ID).filter((id) => !["background.workbook-parts", "background.grammar-book-parts"].includes(id)).sort()) {
  const seeds = ultimateB2PublicationCanonicalSeeds();
  return {
    compilerId: ULTIMATE_B2_COMPONENT_RELEASE_COMPILER_ID,
    releaseSchemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION,
    activities: Object.values(seeds).map((seed) => ({ activityId: seed.activityId, questionIds: seed.questions.map((question) => question.id) })),
    hotspotSchemaVersion: repositoryHotspots.schemaVersion,
    hotspotPageIds: Object.keys(repositoryHotspots.pages).sort(),
    publicImportSchemaVersion: ULTIMATE_B2_HOSTED_OPEN_RESPONSE_IMPORT_SCHEMA_VERSION,
    teacherImportSchemaVersion: ULTIMATE_B2_HOSTED_OPEN_RESPONSE_TEACHER_SCHEMA_VERSION,
    teacherUiSchemaVersion: createEmptyHostedTeacherUiDocument().schemaVersion,
    teacherUiBindingIds: [...teacherUiBindingIds].sort(),
  };
}

export function ultimateB2PublicationCompatibility() {
  return builderDocumentSha256(ultimateB2PublicationCompatibilityDescriptor());
}

export function ultimateB2PublicationCompatibilityBeforeVideoWorksheetBinding() {
  return builderDocumentSha256(ultimateB2PublicationCompatibilityDescriptor(
    Object.keys(HOSTED_EDITABLE_UI_BINDINGS_BY_ID).filter((id) => id !== "navigation.videoWorksheet" && !["background.workbook-parts", "background.grammar-book-parts"].includes(id)),
  ));
}

function source(document, baselineSha256) {
  return document ? { revision: document.revision, sha256: document.sha256 } : { revision: 0, sha256: baselineSha256 };
}

export function compileUltimateB2ComponentRelease({ documents = {}, imports = {} } = {}) {
  const seeds = ultimateB2PublicationCanonicalSeeds();
  const compatibility = ultimateB2PublicationCompatibility();
  const hotspotDocument = documents.hotspots || null;
  const hotspots = validateAndNormalizeUltimateB2HotspotManifest(hotspotDocument?.payload || structuredClone(repositoryHotspots));
  const teacherUiDocument = documents.teacherUi || null;
  const teacherUi = normalizeHostedTeacherUiDocument(teacherUiDocument?.payload || createEmptyHostedTeacherUiDocument());
  const sourceSnapshot = {
    schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION,
    hotspots: source(hotspotDocument, builderDocumentSha256(validateAndNormalizeUltimateB2HotspotManifest(structuredClone(repositoryHotspots)))),
    openResponse: {},
    teacherUi: source(teacherUiDocument, builderDocumentSha256(createEmptyHostedTeacherUiDocument())),
  };
  const activities = {};
  const solutions = {};
  const assets = new Map();
  for (const activityId of Object.keys(seeds).sort()) {
    const seed = seeds[activityId];
    const document = documents.openResponse?.[activityId] || null;
    const imported = imports[activityId] || null;
    const publicImport = imported ? normalizeUltimateB2HostedOpenResponseImport(imported.publicProjection, activityId, seed.questions.map((question) => question.id)) : null;
    const authoring = document
      ? document.resource.validate(document.payload)
      : publicImport
        ? { ...structuredClone(seed), questions: seed.questions.map((question, index) => ({ ...question, prompt: publicImport.questions[index].prompt })) }
        : structuredClone(seed);
    if (publicImport) {
      for (const layer of publicImport.artworkLayers) {
        const extension = layer.assetPath.match(/\.([a-z]+)$/)?.[1];
        assets.set(`${layer.sha256}.${extension}`, { sha256: layer.sha256, extension, mediaType: mediaTypes[extension], role: COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK });
      }
    }
    if (imported) solutions[activityId] = normalizeUltimateB2HostedOpenResponseTeacherImport(imported.teacherProjection, activityId, seed.questions.map((question) => question.id));
    activities[activityId] = { authoring, import: publicImport ? {
      ...publicImport,
      artworkLayers: publicImport.artworkLayers.map((layer) => {
        const extension = layer.assetPath.match(/\.([a-z]+)$/)?.[1];
        const { assetPath: _assetPath, ...rest } = layer;
        return { ...rest, asset: { sha256: layer.sha256, extension, mediaType: mediaTypes[extension], role: COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK } };
      }),
    } : null };
    sourceSnapshot.openResponse[activityId] = {
      document: source(document, builderDocumentSha256(seed)),
      import: imported ? { revision: imported.revision, sha256: imported.fingerprint } : { revision: 0, sha256: null },
    };
  }
  for (const asset of Object.values(projectHostedTeacherUiPreview(teacherUi).assets)) {
    assets.set(`${asset.sha256}.${asset.extension}`, { sha256: asset.sha256, extension: asset.extension, mediaType: asset.mediaType, role: COMPONENT_PUBLICATION_ASSET_ROLES.TEACHER_UI });
  }
  const normalizedSourceSnapshot = normalizeUltimateB2ReleaseSourceSnapshot(sourceSnapshot, seeds);
  const publicProjection = normalizeUltimateB2PublicReleaseProjection({ schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION, bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", compatibility, hotspots, activities, assets: [...assets.values()].filter((asset) => asset.role !== COMPONENT_PUBLICATION_ASSET_ROLES.TEACHER_UI).sort((a, b) => a.sha256.localeCompare(b.sha256)) }, seeds);
  const teacherProjection = normalizeUltimateB2TeacherReleaseProjection({ schemaVersion: ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION, bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", solutions, ui: projectHostedTeacherUiPreview(teacherUi) }, seeds);
  assertStudentSafeReleaseProjection(publicProjection);
  const hashes = {
    sourceSnapshotSha256: builderDocumentSha256(normalizedSourceSnapshot),
    publicProjectionSha256: builderDocumentSha256(publicProjection),
    teacherProjectionSha256: builderDocumentSha256(teacherProjection),
  };
  return {
    compilerId: ULTIMATE_B2_COMPONENT_RELEASE_COMPILER_ID,
    compatibility,
    sourceSnapshot: normalizedSourceSnapshot,
    publicProjection,
    teacherProjection,
    assetManifest: [...assets.values()].sort((a, b) => `${a.sha256}.${a.extension}`.localeCompare(`${b.sha256}.${b.extension}`)),
    ...hashes,
    releaseSha256: builderDocumentSha256({ compatibility, sourceSnapshot: normalizedSourceSnapshot, publicProjection, teacherProjection }),
    stableJson: stableBuilderJson({ compatibility, sourceSnapshot: normalizedSourceSnapshot, publicProjection, teacherProjection }),
  };
}
