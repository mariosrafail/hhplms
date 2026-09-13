import { normalizeUltimateB2HostedOpenResponseDraft } from "./hostedOpenResponseDraft.js";
import { normalizeUltimateB2HostedOpenResponseImport, normalizeUltimateB2HostedOpenResponseTeacherImport } from "./hostedOpenResponseImport.js";
import { normalizeHostedTeacherUiPreview } from "./hostedTeacherUiDocument.js";
import { validateAndNormalizeUltimateB2HotspotManifest } from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import { COMPONENT_PUBLICATION_ASSET_ROLES, isPublicProjectionComponentPublicationAssetRole } from "./componentPublicationAssetRoles.js";

export const ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION = "1.0";
export const ULTIMATE_B2_COMPONENT_RELEASE_COMPILER_ID = "ultimate-b2-students-book-v1";
export const ULTIMATE_B2_PUBLISHED_ASSET_PATH = /^\/\.netlify\/functions\/book-content\?action=published-release-asset&bookSlug=ultimate-b2&componentSlug=ultimate-b2-(?:students-book|workbook|grammar-book)&releaseId=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})&sha256=([a-f0-9]{64})&extension=(png|jpg|webp|mp3|mp4|pdf|ttf)$/i;

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ACTIVITY_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const forbiddenPublicKeys = new Set([
  "correctwordids", "correcttargetids", "iscorrect", "answercount", "markedsource",
  "acceptedanswers", "correctanswers", "correctoption", "correctoptionid", "teacherprojection",
  "teachersolutions", "modelanswer", "teacheranswer", "answerkey", "sourceprovenance", "rawxml",
  "archivemanifest", "privateobjectkey", "signedurl",
]);

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unsupported fields.`);
}

function normalizedKey(key) { return String(key).toLowerCase().replace(/[^a-z0-9]/g, ""); }

export function assertStudentSafeReleaseProjection(value, path = "publicProjection") {
  if (Array.isArray(value)) return value.forEach((child, index) => assertStudentSafeReleaseProjection(child, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPublicKeys.has(normalizedKey(key))) throw new Error(`Student release contains forbidden field ${path}.${key}.`);
    assertStudentSafeReleaseProjection(child, `${path}.${key}`);
  }
}

function normalizeSourceIdentity(value, label, { nullableZeroSha = false } = {}) {
  exactObject(value, ["revision", "sha256"], label);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || (value.revision === 0 ? nullableZeroSha ? value.sha256 !== null : !SHA256.test(value.sha256) : !SHA256.test(value.sha256))) throw new Error(`${label} is invalid.`);
  return { revision: value.revision, sha256: value.sha256 };
}

export function normalizeUltimateB2ReleaseSourceSnapshot(value, canonicalSeedsById) {
  exactObject(value, ["schemaVersion", "hotspots", "openResponse", "teacherUi"], "Release source snapshot");
  if (value.schemaVersion !== ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION) throw new Error("Release source snapshot version is invalid.");
  exactObject(value.openResponse, Object.keys(value.openResponse || {}), "Release source Open Response map");
  const expectedActivityIds = Object.keys(canonicalSeedsById || {}).sort();
  const actualActivityIds = Object.keys(value.openResponse).sort();
  if (actualActivityIds.length !== expectedActivityIds.length || actualActivityIds.some((activityId, index) => activityId !== expectedActivityIds[index])) throw new Error("Release source activity topology is incomplete.");
  const openResponse = Object.fromEntries(actualActivityIds.map((activityId) => {
    const entry = value.openResponse[activityId];
    exactObject(entry, ["document", "import"], `Release source ${activityId}`);
    return [activityId, { document: normalizeSourceIdentity(entry.document, `Release source ${activityId} document`), import: normalizeSourceIdentity(entry.import, `Release source ${activityId} import`, { nullableZeroSha: true }) }];
  }));
  return { schemaVersion: value.schemaVersion, hotspots: normalizeSourceIdentity(value.hotspots, "Release source hotspots"), openResponse, teacherUi: normalizeSourceIdentity(value.teacherUi, "Release source Teacher UI") };
}

function normalizeAsset(value, label) {
  exactObject(value, ["sha256", "extension", "mediaType", "role"], label);
  const extension = String(value.extension || "").toLowerCase();
  if (!SHA256.test(value.sha256) || !["png", "jpg", "webp", "gaf", "json"].includes(extension)) throw new Error(`${label} identity is invalid.`);
  if (typeof value.mediaType !== "string" || !value.mediaType || typeof value.role !== "string" || !value.role) throw new Error(`${label} metadata is invalid.`);
  return { sha256: value.sha256, extension, mediaType: value.mediaType, role: value.role };
}

export function publishedReleaseAssetPath(asset, releaseId, { bookSlug = "ultimate-b2", componentSlug = "ultimate-b2-students-book" } = {}) {
  exactObject(asset, ["sha256", "extension", "mediaType", "role"], "Published release asset");
  const extension = String(asset.extension || "").toLowerCase();
  const expectedMediaType = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", mp3: "audio/mpeg", mp4: "video/mp4", pdf: "application/pdf", ttf: "font/ttf" }[extension];
  if (!SHA256.test(String(asset.sha256 || "")) || !expectedMediaType || asset.mediaType !== expectedMediaType || !isPublicProjectionComponentPublicationAssetRole(asset.role)) throw new Error("Published release asset identity is invalid");
  if (!UUID.test(String(releaseId || ""))) throw new Error("Published release identity is invalid");
  if (bookSlug !== "ultimate-b2" || !["ultimate-b2-students-book", "ultimate-b2-workbook", "ultimate-b2-grammar-book"].includes(componentSlug)) throw new Error("Published component identity is invalid");
  return `/.netlify/functions/book-content?action=published-release-asset&bookSlug=${bookSlug}&componentSlug=${componentSlug}&releaseId=${releaseId}&sha256=${asset.sha256}&extension=${extension}`;
}

function normalizeReleaseImport(input, activityId, questionIds) {
  if (!input || typeof input !== "object" || !Array.isArray(input.artworkLayers)) throw new Error("Published Open Response import is invalid.");
  const hydrated = {
    ...input,
    artworkLayers: input.artworkLayers.map((layer, index) => {
      exactObject(layer, ["id", "binding", "asset", "sha256", "naturalSize", "area", "order", "altText", "accessibilityStatus"], `Published artworkLayers[${index}]`);
      const asset = normalizeAsset(layer.asset, `Published artworkLayers[${index}].asset`);
      if (asset.role !== COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK || asset.sha256 !== layer.sha256 || !["png", "jpg", "webp"].includes(asset.extension)) throw new Error("Published artwork identity is invalid.");
      const { asset: _asset, ...rest } = layer;
      return { ...rest, assetPath: `/preview/open-response-assets/${asset.sha256}.${asset.extension}` };
    }),
  };
  const normalized = normalizeUltimateB2HostedOpenResponseImport(hydrated, activityId, questionIds);
  return {
    ...normalized,
    artworkLayers: normalized.artworkLayers.map((layer, index) => {
      const extension = layer.assetPath.match(/\.([a-z]+)$/)?.[1];
      const { assetPath: _assetPath, ...rest } = layer;
      return { ...rest, asset: normalizeAsset({ sha256: layer.sha256, extension, mediaType: extension === "png" ? "image/png" : extension === "jpg" ? "image/jpeg" : "image/webp", role: COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK }, `Published artworkLayers[${index}].asset`) };
    }),
  };
}

export function hydrateUltimateB2ReleaseImport(input, activityId, questionIds, assetUrl) {
  const normalized = normalizeReleaseImport(input, activityId, questionIds);
  return normalizeUltimateB2HostedOpenResponseImport({
    ...normalized,
    artworkLayers: normalized.artworkLayers.map((layer) => {
      const { asset, ...rest } = layer;
      return { ...rest, assetPath: assetUrl(asset) };
    }),
  }, activityId, questionIds, { assetPathPolicy: "runtime" });
}

export function normalizeUltimateB2PublicReleaseProjection(value, canonicalSeedsById) {
  exactObject(value, ["schemaVersion", "bookSlug", "componentSlug", "compatibility", "hotspots", "activities", "assets"], "Public release");
  if (value.schemaVersion !== ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION || value.bookSlug !== "ultimate-b2" || value.componentSlug !== "ultimate-b2-students-book" || !SHA256.test(value.compatibility)) throw new Error("Public release identity is invalid.");
  const hotspots = validateAndNormalizeUltimateB2HotspotManifest(value.hotspots);
  exactObject(value.activities, Object.keys(value.activities || {}), "Public release activities");
  const expectedActivityIds = Object.keys(canonicalSeedsById || {}).sort();
  const actualActivityIds = Object.keys(value.activities).sort();
  if (actualActivityIds.length !== expectedActivityIds.length || actualActivityIds.some((activityId, index) => activityId !== expectedActivityIds[index])) throw new Error("Public release activity topology is incomplete.");
  const activities = {};
  for (const activityId of actualActivityIds) {
    if (!SAFE_ACTIVITY_ID.test(activityId) || !canonicalSeedsById?.[activityId]) throw new Error("Public release activity is unsupported.");
    const entry = value.activities[activityId];
    exactObject(entry, ["authoring", "import"], `Public release activity ${activityId}`);
    activities[activityId] = {
      authoring: normalizeUltimateB2HostedOpenResponseDraft(entry.authoring, canonicalSeedsById[activityId]),
      import: entry.import === null ? null : normalizeReleaseImport(entry.import, activityId, canonicalSeedsById[activityId].questions.map((question) => question.id)),
    };
  }
  if (!Array.isArray(value.assets)) throw new Error("Public release assets are invalid.");
  const assets = value.assets.map((asset, index) => {
    const normalized = normalizeAsset(asset, `Public release assets[${index}]`);
    const expectedMediaType = normalized.extension === "png" ? "image/png" : normalized.extension === "jpg" ? "image/jpeg" : normalized.extension === "webp" ? "image/webp" : null;
    if (normalized.role !== COMPONENT_PUBLICATION_ASSET_ROLES.OPEN_RESPONSE_ARTWORK || normalized.mediaType !== expectedMediaType) throw new Error("Public release asset role is invalid.");
    return normalized;
  });
  const expectedAssets = Object.values(activities).flatMap((entry) => entry.import?.artworkLayers?.map((layer) => layer.asset) || []);
  const identity = (asset) => `${asset.sha256}.${asset.extension}.${asset.role}`;
  const actualAssetIds = assets.map(identity).sort();
  const expectedAssetIds = [...new Set(expectedAssets.map(identity))].sort();
  if (new Set(actualAssetIds).size !== actualAssetIds.length || actualAssetIds.length !== expectedAssetIds.length || actualAssetIds.some((assetId, index) => assetId !== expectedAssetIds[index])) throw new Error("Public release asset manifest is inconsistent.");
  const normalized = { schemaVersion: value.schemaVersion, bookSlug: value.bookSlug, componentSlug: value.componentSlug, compatibility: value.compatibility, hotspots, activities, assets };
  assertStudentSafeReleaseProjection(normalized);
  return normalized;
}

export function normalizeUltimateB2TeacherReleaseProjection(value, canonicalSeedsById) {
  exactObject(value, ["schemaVersion", "bookSlug", "componentSlug", "solutions", "ui"], "Teacher release");
  if (value.schemaVersion !== ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION || value.bookSlug !== "ultimate-b2" || value.componentSlug !== "ultimate-b2-students-book") throw new Error("Teacher release identity is invalid.");
  exactObject(value.solutions, Object.keys(value.solutions || {}), "Teacher release solutions");
  const solutions = {};
  for (const activityId of Object.keys(value.solutions).sort()) {
    const seed = canonicalSeedsById?.[activityId];
    if (!SAFE_ACTIVITY_ID.test(activityId) || !seed) throw new Error("Teacher release activity is invalid.");
    solutions[activityId] = normalizeUltimateB2HostedOpenResponseTeacherImport(value.solutions[activityId], activityId, seed.questions.map((question) => question.id));
  }
  return { schemaVersion: value.schemaVersion, bookSlug: value.bookSlug, componentSlug: value.componentSlug, solutions, ui: normalizeHostedTeacherUiPreview(value.ui) };
}
