import { nativeMultiPartAssetRequirements } from "../../../src/data/native-activities/nativeMultiPart.js";
import { normalizeAssetDescriptor } from "./_builder-native-upload-descriptor.js";
import { builderTeacherAnswerAssetsReady, validateTeacherImageDraftAssets, serveProtectedNativeAnswer } from "./_builder-native-teacher-assets.js";
import { nativeMarkWordsAssetRequirements } from "../../../src/data/native-activities/nativeMarkWords.js";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { createBookAssetStorage } from "../../../lib/book-assets/storage.js";
import { inspectManagedMp3 } from "../../../lib/book-assets/audio-inspection.js";
import { inspectManagedMp4 } from "../../../lib/book-assets/video-inspection.js";
import { inspectManagedPdf } from "../../../lib/book-assets/pdf-inspection.js";
import { inspectManagedTtf, MANAGED_TTF_MAXIMUM_BYTES, MANAGED_TTF_MEDIA_TYPE } from "../../../lib/book-assets/font-inspection.js";
import { buildBuilderFontLibraryObjectKey, buildBuilderFontLibraryStagingKey, buildNativeActivityAssetObjectKey, buildNativeActivityAssetStagingKey } from "../../../lib/book-assets/object-keys.js";
import { inspectManagedRaster, MANAGED_RASTER_MAXIMUM_BYTES, MANAGED_RASTER_TYPES } from "../../../lib/book-assets/raster-inspection.js";
import { nativeAudioTextAssetRequirements } from "../../../src/data/native-activities/nativeAudioTextHotspots.js";
import { appendNativeActivityIndexEntry, createEmptyNativeActivityIndex, nativeReadableTextAssetRequirements, nativeSupplementalAudioAssetRequirements, nativeVideoAssetRequirements, NATIVE_ACTIVITY_SCHEMA_VERSION, normalizeNativeActivityIndex, removeNativeActivityIndexEntry } from "../../../src/data/native-activities/nativeActivityPublic.js";
import { nativeSingleChoicePresentationAssetRequirements } from "../../../src/data/native-activities/nativeSingleChoice.js";
import { nativeCompleteSentencesAssetRequirements } from "../../../src/data/native-activities/nativeCompleteSentences.js";
import { nativeListeningAssetRequirements } from "../../../src/data/native-activities/nativeListening.js";
import { nativeOldschoolListeningAssetRequirements } from "../../../src/data/native-activities/nativeOldschoolListening.js";
import { nativeDragDropAssetRequirements } from "../../../src/data/native-activities/nativeDragDrop.js";
import { nativeOpenResponseAssetRequirements } from "../../../src/data/native-activities/nativeOpenResponse.js";
import { isNativeActivityPlacementError } from "../../../src/data/native-activities/nativeActivityPlacementError.js";
import { currentUltimateB2ActivityLifecycleEntry, updateUltimateB2ActivityLifecycle } from "../../../src/data/ultimate-b2/activityLifecycle.js";
import { ultimateB2StudentsBookAuthoringActivities } from "../../../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import { pruneComponentActivityHotspots } from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import { pruneStudentsBookCurrentHotspots } from "../../../src/data/ultimate-b2/studentsBookCurrentHotspots.js";
import { getBuilderSql, json, requireBuilderOrigin, requireBuilderUser } from "./_builder-auth.js";
import { resolveBuilderContentResource } from "./_builder-content-registry.js";
import { assertPublicBuilderDocument, builderClientMutationIdPattern, builderDocumentSha256, stableBuilderJson } from "./_builder-content-security.js";
import { loadBuilderComponentDocument } from "./_builder-content-store.js";
import {
  claimBuilderNativeAssetUpload,
  completeBuilderNativeAssetUpload,
  createBuilderNativeActivity,
  deleteBuilderNativeActivity,
  failBuilderNativeAssetUpload,
  loadBuilderNativeAsset,
  loadBuilderNativeAssetUploadScope,
  isBuilderNativeDraftAssetRecord,
  loadBuilderNativeActivityIds,
  mutateBuilderActivityLifecycle,
  prepareBuilderNativeAssetUpload,
  saveBuilderNativeActivityPair,
  validateBuilderNativeAssetReferences,
  claimBuilderFontUpload,
  completeBuilderFontUpload,
  failBuilderFontUpload,
  listBuilderFonts,
  loadBuilderFontAsset,
  loadBuilderFontUploadScope,
  prepareBuilderFontUpload,
} from "./_builder-native-activity-store.js";
import { resolveNativeActivityAdapter } from "./_native-activity-adapters.js";
import {
  nativeActivityFailureLogFields,
  nativeCatalogBoundary,
  nativeCatalogIdentityContext,
  nativeCatalogSafeIdPattern,
  withNativeCatalogProcessing,
} from "./_native-catalog-failure.js";
import { resolveNativeActivityKind, validateNativeActivityPair } from "./_native-activity-registry.js";
import { collectBuilderNativeActivityCatalogSources, loadBuilderNativeActivityCatalogAssets, normalizeStoredBuilderDocument } from "./_builder-publication-store.js";
import { serveBuilderPrivateFont } from "./_builder-private-font-response.js";
import { loadBuilderActivityOrder, saveBuilderActivityOrder } from "./_builder-activity-order.js";

const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId = nativeCatalogSafeIdPattern;
const uploadTtlSeconds = 15 * 60;
const previewTtlSeconds = 5 * 60;
const extensionTypes = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".mp3", "audio/mpeg"], [".mp4", "video/mp4"], [".pdf", "application/pdf"]]);

function decode(value) { try { return decodeURIComponent(value); } catch { return ""; } }

function route(event) {
  const pathname = String(event?.path || "").split("?")[0];
  const root = /(?:\/builder\/api\/native-activities|\/\.netlify\/functions\/builder-native-activities)\/books\/([^/]+)\/components\/([^/]+)/;
  const prefix = pathname.match(root);
  if (!prefix) return null;
  const scope = { bookSlug: decode(prefix[1]), componentSlug: decode(prefix[2]) };
  const suffix = pathname.slice(prefix.index + prefix[0].length).replace(/^\/+|\/+$/g, "");
  if (suffix === "catalog") return { ...scope, action: "catalog" };
  if (suffix === "lifecycle") return { ...scope, action: "lifecycle" };
  if (suffix === "order") return { ...scope, action: "order" };
  if (suffix === "reorder") return { ...scope, action: "reorder" };
  if (suffix === "create") return { ...scope, action: "create" };
  if (suffix === "fonts") return { ...scope, action: "font-list" };
  let match = suffix.match(/^fonts\/(prepare|finalize)$/);
  if (match) return { ...scope, action: `font-${match[1]}` };
  match = suffix.match(/^fonts\/([0-9a-f-]+)\/preview$/);
  if (match) return { ...scope, assetId: match[1], action: "font-preview" };
  match = suffix.match(/^activities\/([a-z0-9-]+)\/save$/);
  if (match) return { ...scope, activityId: match[1], action: "save" };
  match = suffix.match(/^activities\/([a-z0-9-]+)\/delete$/);
  if (match) return { ...scope, activityId: match[1], action: "delete" };
  match = suffix.match(/^activities\/([a-z0-9-]+)\/(retire|move)$/);
  if (match) return { ...scope, activityId: match[1], action: match[2] };
  match = suffix.match(/^activities\/([a-z0-9-]+)\/assets\/(prepare|finalize)$/);
  if (match) return { ...scope, activityId: match[1], action: `asset-${match[2]}` };
  match = suffix.match(/^activities\/([a-z0-9-]+)\/assets\/([0-9a-f-]+)\/preview$/);
  if (match) return { ...scope, activityId: match[1], assetId: match[2], action: "asset-preview" };
  return null;
}

function parseJson(event, keys, maximumBytes = 1024 * 1024, optionalKeys = []) {
  if (!String(Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "").toLowerCase().startsWith("application/json")) return { error: json(415, { error: "expected_application_json" }) };
  const encoded = String(event.body || "");
  const bytes = event.isBase64Encoded ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
  if (bytes.length > maximumBytes) return { error: json(413, { error: "request_too_large" }) };
  let value; try { value = JSON.parse(bytes.toString("utf8") || "{}"); } catch { return { error: json(400, { error: "invalid_json" }) }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: json(400, { error: "invalid_request" }) };
  const actualKeys = Object.keys(value);
  if (keys.some((key) => !Object.hasOwn(value, key)) || actualKeys.some((key) => !keys.includes(key) && !optionalKeys.includes(key))) return { error: json(400, { error: "invalid_request" }) };
  return { value };
}

function createBody(event) {
  const parsed = parseJson(event, ["kind", "pageId", "title", "clientMutationId"]);
  if (parsed.error) return parsed;
  if (!builderClientMutationIdPattern.test(String(parsed.value.clientMutationId || "")) || typeof parsed.value.title !== "string") return { error: json(400, { error: "invalid_request" }) };
  return parsed;
}

function failureCode(error) {
  const value = String(error?.message || "native_asset_rejected");
  return /^[a-z0-9_]{3,64}$/.test(value) ? value : "native_asset_rejected";
}

function normalizeFontDescriptor(input) {
  if (!exact(input, ["name", "size", "type"])) throw new Error("invalid_file_descriptor");
  const name = String(input.name || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._() -]{0,179}$/.test(name) || path.basename(name) !== name || path.extname(name).toLowerCase() !== ".ttf" || /^(?:[a-z]:|\\\\|\/)|%2f|%5c|[\u0000-\u001f\u007f]/i.test(name)) throw new Error("invalid_filename");
  const declaredType = String(input.type || "").toLowerCase();
  if (![MANAGED_TTF_MEDIA_TYPE, "application/x-font-ttf", "application/octet-stream"].includes(declaredType)) throw new Error("declared_mime_mismatch");
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MANAGED_TTF_MAXIMUM_BYTES) throw new Error("declared_file_too_large");
  const displayLabel = path.basename(name, path.extname(name)).trim().slice(0, 120);
  if (!displayLabel) throw new Error("invalid_filename");
  return { name, size: input.size, type: MANAGED_TTF_MEDIA_TYPE, displayLabel };
}

function isBuilderFontRecord(asset) {
  return asset?.asset_role === "activity_font" && asset?.mime_type === MANAGED_TTF_MEDIA_TYPE
    && asset?.publication_status === "draft" && asset?.access_level === "internal"
    && asset?.storage_profile === "private" && asset?.source_metadata?.font_library_scope === "component";
}

function fontReference(asset, parsedRoute) {
  if (!isBuilderFontRecord(asset)) return null;
  const assetId = String(asset.id).toLowerCase();
  return {
    assetId,
    checksumSha256: asset.checksum_sha256,
    role: "activity_font",
    slot: `font-${assetId.replaceAll("-", "")}`,
    displayLabel: String(asset.source_metadata?.display_label || "Uploaded font").slice(0, 120),
    familyAlias: `hh-native-font-${assetId.replaceAll("-", "")}`,
    byteSize: Number(asset.byte_size),
    previewUrl: `/builder/api/native-activities/books/${encodeURIComponent(parsedRoute.bookSlug)}/components/${encodeURIComponent(parsedRoute.componentSlug)}/fonts/${encodeURIComponent(assetId)}/preview`,
  };
}

async function fontList(dependencies, sql, parsedRoute) {
  const rows = await dependencies.listFonts(sql, parsedRoute);
  return json(200, { bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug, fonts: rows.map((row) => fontReference(row, parsedRoute)).filter(Boolean) }, { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
}

async function prepareFont(dependencies, sql, auth, parsedRoute, event) {
  const parsed = parseJson(event, ["name", "size", "type", "clientMutationId"]);
  if (parsed.error) return parsed.error;
  if (!builderClientMutationIdPattern.test(String(parsed.value.clientMutationId || ""))) return json(400, { error: "invalid_client_mutation_id" });
  let descriptor;
  try { descriptor = normalizeFontDescriptor({ name: parsed.value.name, size: parsed.value.size, type: parsed.value.type }); } catch (error) { return json(400, { error: failureCode(error) }); }
  const uploadId = dependencies.randomUuid();
  const stagingObjectKey = buildBuilderFontLibraryStagingKey({ ...parsedRoute, uploadId });
  const requestSha256 = sha256(stableBuilderJson(descriptor));
  const result = await dependencies.prepareFont(sql, { ...parsedRoute, clientMutationId: parsed.value.clientMutationId, uploadId, requestSha256, fileDescriptor: descriptor, stagingObjectKey, builderUserId: auth.builderUser.id, expiresAt: new Date(dependencies.now() + uploadTtlSeconds * 1000).toISOString() });
  if (!result) throw new Error("Font upload preparation returned no result");
  if (result.outcome === "mutation_id_conflict") return json(409, { error: result.outcome });
  if (result.outcome === "resource_not_found") return json(404, { error: "font_library_not_found" });
  if (!['prepared', 'idempotent'].includes(result.outcome) || result.state !== "prepared") return json(409, { error: result.outcome || "invalid_session_state" });
  const authorization = await dependencies.storage().signedPutUrl({ profile: "private", objectKey: result.stagingObjectKey, contentType: MANAGED_TTF_MEDIA_TYPE, ttlSeconds: uploadTtlSeconds });
  return json(200, { uploadId: result.uploadId, expiresIn: uploadTtlSeconds, authorization, idempotent: result.outcome === "idempotent" });
}

async function finalizeFont(dependencies, sql, auth, parsedRoute, event) {
  const parsed = parseJson(event, ["uploadId", "clientMutationId"]); if (parsed.error) return parsed.error;
  if (!uuidV4.test(String(parsed.value.uploadId || "")) || !builderClientMutationIdPattern.test(String(parsed.value.clientMutationId || ""))) return json(400, { error: "invalid_finalize_identity" });
  const uploadScope = await dependencies.loadFontUploadScope(sql, { uploadId: parsed.value.uploadId, builderUserId: auth.builderUser.id });
  if (!uploadScope) return json(404, { error: "session_not_found" });
  if (uploadScope.bookSlug !== parsedRoute.bookSlug || uploadScope.componentSlug !== parsedRoute.componentSlug) return json(409, { error: "upload_scope_conflict" });
  const claimed = await dependencies.claimFont(sql, { uploadId: parsed.value.uploadId, clientMutationId: parsed.value.clientMutationId, builderUserId: auth.builderUser.id });
  if (!claimed) throw new Error("Font upload claim returned no result");
  if (claimed.outcome === "idempotent") {
    const asset = await dependencies.loadFont(sql, { ...parsedRoute, assetId: claimed.resultingAssetId });
    const font = fontReference(asset, parsedRoute);
    return font ? json(200, { font, idempotent: true }) : json(404, { error: "font_not_found" });
  }
  if (claimed.outcome !== "claimed") return json(claimed.outcome === "session_not_found" ? 404 : claimed.outcome === "expired_session" ? 410 : 409, { error: claimed.outcome });
  const storage = dependencies.storage();
  try {
    const head = await storage.head({ profile: "private", objectKey: claimed.stagingObjectKey });
    if (head.byteSize !== claimed.fileDescriptor.size) throw new Error("actual_object_size_mismatch");
    const bytes = await storage.download({ profile: "private", objectKey: claimed.stagingObjectKey });
    if (bytes.length !== claimed.fileDescriptor.size) throw new Error("actual_object_size_mismatch");
    const inspected = dependencies.inspectFont(bytes);
    const objectKey = buildBuilderFontLibraryObjectKey({ ...parsedRoute, checksum: inspected.checksumSha256 });
    await storage.upload({ profile: "private", objectKey, body: inspected.bytes, contentType: inspected.mimeType, checksumSha256: inspected.checksumSha256, byteSize: inspected.byteSize });
    const assetId = await dependencies.completeFont(sql, { uploadId: parsed.value.uploadId, builderUserId: auth.builderUser.id, objectKey, storageBucket: storage.bucket("private"), ...inspected, displayLabel: claimed.fileDescriptor.displayLabel, originalFilename: claimed.fileDescriptor.name });
    await storage.delete({ profile: "private", objectKey: claimed.stagingObjectKey }).catch(() => {});
    const asset = await dependencies.loadFont(sql, { ...parsedRoute, assetId });
    const font = fontReference(asset, parsedRoute);
    if (!font) throw new Error("font_record_unavailable");
    return json(200, { font, idempotent: false });
  } catch (error) {
    await Promise.allSettled([dependencies.failFont(sql, { uploadId: parsed.value.uploadId, builderUserId: auth.builderUser.id, failureCode: failureCode(error) }), storage.delete({ profile: "private", objectKey: claimed.stagingObjectKey })]);
    return json(400, { error: failureCode(error) });
  }
}

async function createActivity(dependencies, sql, auth, parsedRoute, event) {
  const parsed = createBody(event); if (parsed.error) return parsed.error;
  const adapter = dependencies.resolveAdapter(parsedRoute.bookSlug, parsedRoute.componentSlug);
  const kind = resolveNativeActivityKind(parsed.value.kind);
  if (!adapter) return json(404, { error: "native_activity_component_not_found" });
  if (!kind || !adapter.kinds.includes(kind.kind)) return json(400, { error: "unsupported_native_activity_kind" });
  let placement; try { placement = await (adapter.normalizeDestinationPlacement || adapter.normalizePlacement)({ pageId: parsed.value.pageId }, { sql, bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug }); } catch { return json(400, { error: "invalid_native_activity_placement" }); }
  const title = parsed.value.title.trim() || `New ${kind.label}`;
  if (title.length > 300 || /[\u0000-\u001f\u007f]/.test(title)) return json(400, { error: "invalid_native_activity_title" });
  const requestSha256 = sha256(stableBuilderJson({ bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug, kind: kind.kind, pageId: placement.pageId, title }));
  const indexResource = await dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-index", "");
  if (!indexResource) return json(404, { error: "native_activity_component_not_found" });
  const occupiedActivityIds = await dependencies.loadKnownActivityIds(sql, parsedRoute);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const storedIndex = await dependencies.loadDocument(sql, indexResource);
    const index = storedIndex?.document || createEmptyNativeActivityIndex();
    const activityId = adapter.nextActivityId({ placement, nativeIndex: index, occupiedActivityIds });
    const publicDocument = kind.createBlankPublic({ activityId, title, placement });
    const teacherDocument = kind.createBlankTeacher({ activityId, placement });
    validateNativeActivityPair(publicDocument, teacherDocument); assertPublicBuilderDocument(publicDocument);
    const indexDocument = appendNativeActivityIndexEntry(index, { activityId, kind: kind.kind, placement: { pageId: placement.pageId }, sortOrder: adapter.sortOrder({ placement, activityId, nativeIndex: index }) }, { allowedKinds: adapter.kinds });
    const result = await dependencies.create(sql, {
      ...parsedRoute, activityId, kind: kind.kind, expectedIndexRevision: storedIndex?.revision || 0,
      indexDocument, indexSha256: builderDocumentSha256(indexDocument), publicDocument, publicSha256: builderDocumentSha256(publicDocument),
      teacherDocument, teacherSha256: builderDocumentSha256(teacherDocument), schemaVersion: NATIVE_ACTIVITY_SCHEMA_VERSION,
      requestSha256, builderUserId: auth.builderUser.id, clientMutationId: parsed.value.clientMutationId,
    });
    if (["revision_conflict", "identity_conflict"].includes(result.outcome)) continue;
    if (result.outcome === "mutation_id_conflict") return json(409, { error: result.outcome });
    if (result.outcome === "unauthorized_actor") return json(401, { error: "Unauthorized" });
    if (result.outcome === "resource_not_found") return json(404, { error: "native_activity_component_not_found" });
    if (!["created", "idempotent"].includes(result.outcome)) throw new Error("Unexpected native activity creation outcome");
    return json(200, { ...result, kind: kind.kind, placement: { pageId: placement.pageId }, idempotent: result.outcome === "idempotent" });
  }
  return json(409, { error: "native_activity_creation_conflict" });
}

function isInactiveActivityError(error) {
  return String(error?.message || "").includes("native activity is not active");
}

async function requireActiveActivity(dependencies, sql, parsedRoute) {
  const resource = await dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-index", "");
  if (!resource) return false;
  const stored = await dependencies.loadDocument(sql, resource);
  const activities = stored?.document?.activities;
  return Array.isArray(activities) ? activities.find((entry) => entry?.activityId === parsedRoute.activityId) || null : null;
}

async function deleteActivity(dependencies, sql, auth, parsedRoute, event) {
  const parsed = parseJson(event, ["clientMutationId"]);
  if (parsed.error) return parsed.error;
  if (!builderClientMutationIdPattern.test(String(parsed.value.clientMutationId || ""))) return json(400, { error: "invalid_client_mutation_id" });
  const adapter = dependencies.resolveAdapter(parsedRoute.bookSlug, parsedRoute.componentSlug);
  if (!adapter) return json(404, { error: "native_activity_component_not_found" });
  const [indexResource, hotspotResource] = await Promise.all([
    dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-index", ""),
    dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "hotspots", ""),
  ]);
  if (!indexResource || !hotspotResource) return json(404, { error: "native_activity_component_not_found" });
  const [storedIndex, storedHotspots] = await Promise.all([
    dependencies.loadDocument(sql, indexResource), dependencies.loadDocument(sql, hotspotResource),
  ]);
  const index = storedIndex?.document || createEmptyNativeActivityIndex();
  const removed = removeNativeActivityIndexEntry(index, parsedRoute.activityId, { allowedKinds: adapter.kinds });
  const currentHotspots = storedHotspots?.document || hotspotResource.baseline();
  const pruned = (parsedRoute.componentSlug === "ultimate-b2-students-book" ? pruneStudentsBookCurrentHotspots : pruneComponentActivityHotspots)(currentHotspots, parsedRoute.activityId);
  const requestSha256 = sha256(stableBuilderJson({
    bookSlug: parsedRoute.bookSlug,
    componentSlug: parsedRoute.componentSlug,
    activityId: parsedRoute.activityId,
  }));
  const result = await dependencies.delete(sql, {
    ...parsedRoute,
    expectedIndexRevision: storedIndex?.revision || 0,
    indexDocument: removed.index,
    indexSha256: builderDocumentSha256(removed.index),
    indexSchemaVersion: indexResource.schemaVersion,
    expectedHotspotRevision: storedHotspots?.revision || 0,
    hotspotDocument: pruned.manifest,
    hotspotSha256: builderDocumentSha256(pruned.manifest),
    hotspotSchemaVersion: hotspotResource.schemaVersion,
    hotspotChanged: pruned.removedCount > 0,
    removedHotspotCount: pruned.removedCount,
    requestSha256,
    builderUserId: auth.builderUser.id,
    clientMutationId: parsed.value.clientMutationId,
  });
  if (["revision_conflict", "mutation_id_conflict"].includes(result.outcome)) return json(409, {
    error: result.outcome,
    currentIndexRevision: result.indexRevision,
    currentHotspotRevision: result.hotspotRevision,
  });
  if (["resource_not_found", "activity_not_active"].includes(result.outcome)) return json(404, { error: "native_activity_not_found" });
  if (result.outcome === "unauthorized_actor") return json(401, { error: "Unauthorized" });
  if (!["deleted", "idempotent"].includes(result.outcome)) throw new Error("Unexpected native activity deletion outcome");
  return json(200, { ...result, idempotent: result.outcome === "idempotent" });
}

async function activityLifecycleCatalog(dependencies, sql, parsedRoute) {
  const resource = await dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "activity-lifecycle", "");
  if (!resource) return json(404, { error: "native_activity_component_not_found" });
  const stored = await dependencies.loadDocument(sql, resource);
  return json(200, {
    schemaVersion: resource.schemaVersion,
    revision: stored?.revision || 0,
    document: stored?.document || resource.baseline(),
  });
}

async function mutateActivityLifecycle(dependencies, sql, auth, parsedRoute, event) {
  const move = parsedRoute.action === "move";
  const parsed = parseJson(event, move ? ["sourcePageId", "destinationPageId", "clientMutationId"] : ["sourcePageId", "clientMutationId"]);
  if (parsed.error) return parsed.error;
  const input = parsed.value;
  if (!safeId.test(String(input.sourcePageId || "")) || (move && !safeId.test(String(input.destinationPageId || "")))
    || !builderClientMutationIdPattern.test(String(input.clientMutationId || ""))
    || (move && input.destinationPageId === input.sourcePageId)) return json(400, { error: "invalid_request" });
  const adapter = dependencies.resolveAdapter(parsedRoute.bookSlug, parsedRoute.componentSlug);
  if (!adapter) return json(404, { error: "native_activity_component_not_found" });
  let destination = null;
  if (move) {
    try { destination = await (adapter.normalizeDestinationPlacement || adapter.normalizePlacement)({ pageId: input.destinationPageId }, { sql, bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug }); }
    catch { return json(400, { error: "invalid_native_activity_placement" }); }
  }
  const [lifecycleResource, indexResource, hotspotResource] = await Promise.all([
    dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "activity-lifecycle", ""),
    dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-index", ""),
    dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "hotspots", ""),
  ]);
  if (!lifecycleResource || !indexResource || !hotspotResource) return json(404, { error: "native_activity_component_not_found" });
  const [storedLifecycle, storedIndex, storedHotspots] = await Promise.all([
    dependencies.loadDocument(sql, lifecycleResource), dependencies.loadDocument(sql, indexResource), dependencies.loadDocument(sql, hotspotResource),
  ]);
  const lifecycle = storedLifecycle?.document || lifecycleResource.baseline();
  const index = storedIndex?.document || createEmptyNativeActivityIndex();
  const nativeEntry = index.activities.find((entry) => entry.activityId === parsedRoute.activityId) || null;
  const canonical = parsedRoute.bookSlug === "ultimate-b2" && parsedRoute.componentSlug === "ultimate-b2-students-book"
    ? ultimateB2StudentsBookAuthoringActivities.find((entry) => entry.activityKey === parsedRoute.activityId) || null
    : null;
  if (!nativeEntry && !canonical) return json(404, { error: "activity_not_found" });
  const family = nativeEntry ? "native" : "canonical";
  if (!move && family === "native") return json(400, { error: "use_native_retirement" });

  let currentPageId;
  let lifecycleDocument = null;
  let indexDocument = null;
  let publicDocument = null;
  let storedPublic = null;
  if (family === "canonical") {
    const current = currentUltimateB2ActivityLifecycleEntry(lifecycle, parsedRoute.activityId, canonical.pageId);
    // Retire replays must reach the mutation function, whose request digest is
    // the authoritative idempotency check. A fresh mutation against an already
    // retired activity is still rejected there as activity_not_active.
    if (move && current.status !== "active") return json(404, { error: "activity_not_found" });
    currentPageId = current.pageId;
    lifecycleDocument = updateUltimateB2ActivityLifecycle(lifecycle, parsedRoute.activityId, {
      status: move ? "active" : "retired",
      pageId: move ? destination.pageId : current.pageId,
    });
  } else {
    currentPageId = nativeEntry.placement.pageId;
    const publicResource = await dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-public", parsedRoute.activityId);
    storedPublic = publicResource ? await dependencies.loadDocument(sql, publicResource) : null;
    const kind = resolveNativeActivityKind(nativeEntry.kind);
    if (!storedPublic || !kind || storedPublic.document.placement.pageId !== currentPageId) return json(409, { error: "native_activity_pair_invalid" });
    indexDocument = normalizeNativeActivityIndex({
      ...index,
      activities: index.activities.map((entry) => entry.activityId === parsedRoute.activityId
        ? { ...entry, placement: { pageId: destination.pageId } }
        : entry),
    }, { allowedKinds: adapter.kinds });
    publicDocument = kind.normalizePublic({ ...storedPublic.document, placement: { pageId: destination.pageId } }, parsedRoute.activityId);
    assertPublicBuilderDocument(publicDocument);
  }
  try {
    const resolvedSource = await (adapter.resolveExistingPlacement || adapter.normalizePlacement)({ pageId: currentPageId }, { sql, bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug });
    if (resolvedSource.pageId !== currentPageId) return json(409, { error: "activity_placement_invalid" });
  } catch {
    return json(409, { error: "activity_placement_invalid" });
  }
  const currentHotspots = storedHotspots?.document || hotspotResource.baseline();
  const pruned = (parsedRoute.componentSlug === "ultimate-b2-students-book" ? pruneStudentsBookCurrentHotspots : pruneComponentActivityHotspots)(currentHotspots, parsedRoute.activityId);
  const requestSha256 = sha256(stableBuilderJson({
    bookSlug: parsedRoute.bookSlug,
    componentSlug: parsedRoute.componentSlug,
    activityId: parsedRoute.activityId,
    family,
    operation: move ? "move" : "retire",
    sourcePageId: input.sourcePageId,
    destinationPageId: destination?.pageId || null,
  }));
  const result = await dependencies.mutateLifecycle(sql, {
    ...parsedRoute,
    activityFamily: family,
    operation: move ? "move" : "retire",
    sourcePageId: input.sourcePageId,
    authoritativeSourcePageId: currentPageId,
    destinationPageId: destination?.pageId || null,
    expectedLifecycleRevision: storedLifecycle?.revision || 0,
    lifecycleDocument,
    lifecycleSha256: lifecycleDocument ? builderDocumentSha256(lifecycleDocument) : null,
    lifecycleSchemaVersion: lifecycleResource.schemaVersion,
    expectedIndexRevision: storedIndex?.revision || 0,
    indexDocument,
    indexSha256: indexDocument ? builderDocumentSha256(indexDocument) : null,
    indexSchemaVersion: indexResource.schemaVersion,
    expectedPublicRevision: storedPublic?.revision || 0,
    publicDocument,
    publicSha256: publicDocument ? builderDocumentSha256(publicDocument) : null,
    publicSchemaVersion: NATIVE_ACTIVITY_SCHEMA_VERSION,
    expectedHotspotRevision: storedHotspots?.revision || 0,
    hotspotDocument: pruned.manifest,
    hotspotSha256: builderDocumentSha256(pruned.manifest),
    hotspotSchemaVersion: hotspotResource.schemaVersion,
    hotspotChanged: pruned.removedCount > 0,
    removedHotspotCount: pruned.removedCount,
    requestSha256,
    builderUserId: auth.builderUser.id,
    clientMutationId: input.clientMutationId,
  });
  if (["revision_conflict", "location_conflict", "mutation_id_conflict"].includes(result.outcome)) return json(409, { error: result.outcome, ...result });
  if (["resource_not_found", "activity_not_active"].includes(result.outcome)) return json(404, { error: "activity_not_found" });
  if (result.outcome === "unauthorized_actor") return json(401, { error: "Unauthorized" });
  if (![move ? "moved" : "retired", "idempotent"].includes(result.outcome)) return json(400, { error: result.outcome });
  return json(200, { ...result, family, destinationPageId: destination?.pageId || null, destinationHotspotRequired: move, idempotent: result.outcome === "idempotent" });
}

async function savePair(dependencies, sql, auth, parsedRoute, event) {
  const parsed = parseJson(event, ["expectedPublicRevision", "expectedTeacherRevision", "clientMutationId", "publicDocument", "teacherDocument"]);
  if (parsed.error) return parsed.error;
  const input = parsed.value;
  if (![input.expectedPublicRevision, input.expectedTeacherRevision].every((revision) => Number.isSafeInteger(revision) && revision >= 1)
    || !builderClientMutationIdPattern.test(String(input.clientMutationId || ""))) return json(400, { error: "invalid_request" });
  const activeEntry = await requireActiveActivity(dependencies, sql, parsedRoute);
  if (!activeEntry) return json(404, { error: "native_activity_not_found" });
  let publicDocument; let teacherDocument;
  try {
    const [publicResource, teacherResource] = await Promise.all([
      dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-public", parsedRoute.activityId),
      dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-teacher", parsedRoute.activityId),
    ]);
    if (!publicResource || !teacherResource) throw new Error("Native activity resources are unavailable.");
    const [currentPublic, currentTeacher] = await Promise.all([
      dependencies.loadDocument(sql, publicResource), dependencies.loadDocument(sql, teacherResource),
    ]);
    if (!currentPublic || !currentTeacher || currentPublic.document.kind !== input.publicDocument?.kind || currentTeacher.document.kind !== input.teacherDocument?.kind
      || currentPublic.document.activityId !== parsedRoute.activityId || currentTeacher.document.activityId !== parsedRoute.activityId
      || currentPublic.document.placement?.pageId !== activeEntry.placement?.pageId
      || input.publicDocument?.placement?.pageId !== activeEntry.placement?.pageId) throw new Error("Native activity identity, kind, and placement are immutable.");
    const adapter = dependencies.resolveAdapter(parsedRoute.bookSlug, parsedRoute.componentSlug);
    const placement = await (adapter?.resolveExistingPlacement || adapter?.normalizePlacement)?.(activeEntry.placement, { sql, bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug });
    if (!placement || placement.pageId !== activeEntry.placement.pageId) throw new Error("Native activity placement is outside its component.");
    const kind = resolveNativeActivityKind(input.publicDocument?.kind);
    if (!kind) throw new Error("Native activity kind is not registered for paired authoring save.");
    publicDocument = kind.normalizePublic(input.publicDocument, parsedRoute.activityId);
    teacherDocument = kind.normalizeTeacher(input.teacherDocument, parsedRoute.activityId);
    validateNativeActivityPair(publicDocument, teacherDocument);
    assertPublicBuilderDocument(publicDocument);
    await validateTeacherImageDraftAssets(dependencies, sql, parsedRoute, teacherDocument);
    await dependencies.validateAssets(sql, {
      ...parsedRoute,
      assets: publicDocument.assets,
      requirements: [
        ...nativeReadableTextAssetRequirements(publicDocument),
        ...nativeSupplementalAudioAssetRequirements(publicDocument),
        ...nativeVideoAssetRequirements(publicDocument),
        ...nativeAudioTextAssetRequirements(publicDocument),
        ...(publicDocument.kind === "multi-part" ? nativeMultiPartAssetRequirements(publicDocument) : []),
        ...(publicDocument.kind === "mark-the-words" ? nativeMarkWordsAssetRequirements(publicDocument) : []),
        ...(publicDocument.kind === "single-choice" ? nativeSingleChoicePresentationAssetRequirements(publicDocument) : []),
        ...(publicDocument.kind === "complete-sentences" ? nativeCompleteSentencesAssetRequirements(publicDocument) : []),
        ...(publicDocument.kind === "listening" ? nativeListeningAssetRequirements(publicDocument) : []),
        ...(publicDocument.kind === "oldschool-listening" ? nativeOldschoolListeningAssetRequirements(publicDocument) : []),
        ...(publicDocument.kind === "drag-drop" ? nativeDragDropAssetRequirements(publicDocument) : []),
        ...(publicDocument.kind === "open-response" ? nativeOpenResponseAssetRequirements(publicDocument) : []),
      ],
    });
  } catch (error) {
    return json(400, { error: "invalid_native_activity_pair", detail: String(error.message || "Invalid pair").slice(0, 240) });
  }
  const requestSha256 = sha256(stableBuilderJson({
    expectedPublicRevision: input.expectedPublicRevision, expectedTeacherRevision: input.expectedTeacherRevision,
    publicDocument, teacherDocument,
  }));
  let result;
  try {
    result = await dependencies.savePair(sql, {
      ...parsedRoute, schemaVersion: NATIVE_ACTIVITY_SCHEMA_VERSION,
      expectedPublicRevision: input.expectedPublicRevision, expectedTeacherRevision: input.expectedTeacherRevision,
      publicDocument, publicSha256: builderDocumentSha256(publicDocument), teacherDocument, teacherSha256: builderDocumentSha256(teacherDocument),
      requestSha256, builderUserId: auth.builderUser.id, clientMutationId: input.clientMutationId,
    });
  } catch (error) {
    if (isInactiveActivityError(error)) return json(404, { error: "native_activity_not_found" });
    throw error;
  }
  if (["revision_conflict", "mutation_id_conflict"].includes(result.outcome)) return json(409, { error: result.outcome, currentPublicRevision: result.currentPublicRevision, currentTeacherRevision: result.currentTeacherRevision });
  if (result.outcome === "resource_not_found") return json(404, { error: "native_activity_not_found" });
  if (result.outcome === "unauthorized_actor") return json(401, { error: "Unauthorized" });
  if (!["saved", "idempotent"].includes(result.outcome)) throw new Error("Unexpected native activity pair save outcome");
  return json(200, { activityId: parsedRoute.activityId, publicRevision: result.publicRevision, teacherRevision: result.teacherRevision, publicDocument, teacherDocument, idempotent: result.outcome === "idempotent" });
}


async function prepareAsset(dependencies, sql, auth, parsedRoute, event) {
  const parsed = parseJson(event, ["name", "size", "type", "assetSlot", "clientMutationId"], 1024 * 1024, ["purpose"]);
  if (parsed.error) return parsed.error;
  if (!builderClientMutationIdPattern.test(String(parsed.value.clientMutationId || ""))) return json(400, { error: "invalid_client_mutation_id" });
  if (!await requireActiveActivity(dependencies, sql, parsedRoute)) return json(404, { error: "native_activity_not_found" });
  let descriptor; try { descriptor = normalizeAssetDescriptor({ name: parsed.value.name, size: parsed.value.size, type: parsed.value.type, assetSlot: parsed.value.assetSlot, purpose: parsed.value.purpose }); } catch (error) { return json(400, { error: failureCode(error) }); }
  if (descriptor.purpose === "teacher-answer" && !await dependencies.teacherAssetsReady(sql)) return json(503, { error: "protected_teacher_assets_unavailable" });
  const uploadId = dependencies.randomUuid();
  const stagingObjectKey = buildNativeActivityAssetStagingKey({ ...parsedRoute, uploadId });
  const requestSha256 = sha256(stableBuilderJson(descriptor));
  let result;
  try {
    result = await dependencies.prepareAsset(sql, { ...parsedRoute, assetSlot: descriptor.assetSlot, clientMutationId: parsed.value.clientMutationId, uploadId, requestSha256, fileDescriptor: descriptor, stagingObjectKey, builderUserId: auth.builderUser.id, expiresAt: new Date(dependencies.now() + uploadTtlSeconds * 1000).toISOString() });
  } catch (error) {
    if (isInactiveActivityError(error)) return json(404, { error: "native_activity_not_found" });
    throw error;
  }
  if (!result) throw new Error("Native asset preparation returned no result");
  if (result.outcome === "mutation_id_conflict") return json(409, { error: result.outcome });
  if (result.outcome === "resource_not_found") return json(404, { error: "native_activity_not_found" });
  if (!["prepared", "idempotent"].includes(result.outcome) || result.state !== "prepared") return json(409, { error: result.outcome || "invalid_session_state" });
  const storage = dependencies.storage();
  const authorization = await storage.signedPutUrl({ profile: "private", objectKey: result.stagingObjectKey, contentType: result.fileDescriptor.type, ttlSeconds: uploadTtlSeconds });
  return json(200, { uploadId: result.uploadId, expiresIn: uploadTtlSeconds, authorization, idempotent: result.outcome === "idempotent" });
}

async function assetResponse(dependencies, sql, parsedRoute, assetId) {
  const asset = await dependencies.loadAsset(sql, { ...parsedRoute, assetId });
  if (!isBuilderNativeDraftAssetRecord(asset, { activityId: parsedRoute.activityId })) return null;
  return {
    asset,
    reference: { assetId: String(asset.id), checksumSha256: asset.checksum_sha256, role: asset.asset_role, slot: asset.source_metadata.asset_slot },
    previewUrl: `/builder/api/native-activities/books/${encodeURIComponent(parsedRoute.bookSlug)}/components/${encodeURIComponent(parsedRoute.componentSlug)}/activities/${encodeURIComponent(parsedRoute.activityId)}/assets/${encodeURIComponent(asset.id)}/preview`,
    metadata: { mimeType: asset.mime_type, byteSize: Number(asset.byte_size), width: asset.width === null ? null : Number(asset.width), height: asset.height === null ? null : Number(asset.height) },
  };
}

async function finalizeAsset(dependencies, sql, auth, parsedRoute, event) {
  const parsed = parseJson(event, ["uploadId", "clientMutationId"]); if (parsed.error) return parsed.error;
  if (!uuidV4.test(String(parsed.value.uploadId || "")) || !builderClientMutationIdPattern.test(String(parsed.value.clientMutationId || ""))) return json(400, { error: "invalid_finalize_identity" });
  if (!await requireActiveActivity(dependencies, sql, parsedRoute)) return json(404, { error: "native_activity_not_found" });
  const uploadScope = await dependencies.loadAssetUploadScope(sql, { uploadId: parsed.value.uploadId, builderUserId: auth.builderUser.id });
  if (!uploadScope) return json(404, { error: "session_not_found" });
  if (uploadScope.bookSlug !== parsedRoute.bookSlug || uploadScope.componentSlug !== parsedRoute.componentSlug
    || uploadScope.activityId !== parsedRoute.activityId) return json(409, { error: "upload_scope_conflict" });
  let claimed;
  try {
    claimed = await dependencies.claimAsset(sql, { uploadId: parsed.value.uploadId, clientMutationId: parsed.value.clientMutationId, builderUserId: auth.builderUser.id });
  } catch (error) {
    if (isInactiveActivityError(error)) return json(404, { error: "native_activity_not_found" });
    throw error;
  }
  if (!claimed) throw new Error("Native asset claim returned no result");
  if (claimed.outcome === "idempotent") {
    const result = await assetResponse(dependencies, sql, parsedRoute, claimed.resultingAssetId);
    return result ? json(200, { reference: result.reference, previewUrl: result.previewUrl, metadata: result.metadata, idempotent: true }) : json(404, { error: "asset_not_found" });
  }
  if (claimed.outcome !== "claimed" || claimed.activityId !== parsedRoute.activityId) return json(claimed.outcome === "session_not_found" ? 404 : claimed.outcome === "expired_session" ? 410 : 409, { error: claimed.outcome });
  const storage = dependencies.storage();
  try {
    const head = await storage.head({ profile: "private", objectKey: claimed.stagingObjectKey });
    if (head.byteSize !== claimed.fileDescriptor.size) throw new Error("actual_object_size_mismatch");
    const bytes = await storage.download({ profile: "private", objectKey: claimed.stagingObjectKey });
    if (bytes.length !== claimed.fileDescriptor.size) throw new Error("actual_object_size_mismatch");
    const inspected = claimed.fileDescriptor.purpose === "video-worksheet" ? dependencies.inspectPdf(bytes) : claimed.fileDescriptor.type === "audio/mpeg" ? dependencies.inspectAudio(bytes) : claimed.fileDescriptor.type === "video/mp4" ? dependencies.inspectVideo(bytes) : await dependencies.inspectRaster(bytes);
    if (inspected.mimeType !== claimed.fileDescriptor.type || extensionTypes.get(path.extname(claimed.fileDescriptor.name).toLowerCase()) !== inspected.mimeType) throw new Error("actual_mime_mismatch");
    const objectKey = buildNativeActivityAssetObjectKey({ ...parsedRoute, assetSlot: claimed.assetSlot, checksum: inspected.checksumSha256, extension: inspected.extension, purpose: claimed.fileDescriptor.purpose });
    await storage.upload({ profile: "private", objectKey, body: inspected.bytes, contentType: inspected.mimeType, checksumSha256: inspected.checksumSha256, byteSize: inspected.byteSize });
    const assetId = await dependencies.completeAsset(sql, { uploadId: parsed.value.uploadId, builderUserId: auth.builderUser.id, objectKey, storageBucket: storage.bucket("private"), ...inspected });
    await storage.delete({ profile: "private", objectKey: claimed.stagingObjectKey }).catch(() => {});
    const result = await assetResponse(dependencies, sql, parsedRoute, assetId);
    if (!result) throw new Error("asset_record_unavailable");
    return json(200, { reference: result.reference, previewUrl: result.previewUrl, metadata: { mimeType: inspected.mimeType, byteSize: inspected.byteSize, width: inspected.width, height: inspected.height, ...(inspected.durationMs ? { durationMs: inspected.durationMs } : {}) }, idempotent: false });
  } catch (error) {
    await Promise.allSettled([
      dependencies.failAsset(sql, { uploadId: parsed.value.uploadId, builderUserId: auth.builderUser.id, failureCode: failureCode(error) }),
      storage.delete({ profile: "private", objectKey: claimed.stagingObjectKey }),
    ]);
    return json(400, { error: failureCode(error) });
  }
}

function normalizeCatalogSource(candidate, resource) {
  if (!candidate) return null;
  if (Object.hasOwn(candidate, "payload_sha256")) return normalizeStoredBuilderDocument(candidate, resource);
  if (!Object.hasOwn(candidate, "payload")) throw new Error("Stored Builder document payload is unavailable");
  return normalizeStoredBuilderDocument({
    payload: candidate.payload,
    payload_sha256: candidate.sha256,
    schema_version: resource.schemaVersion,
    revision: candidate.revision,
  }, resource);
}

function catalogDocumentCode(error, audience) {
  return String(error?.message || "").includes("checksum") ? "document_integrity_invalid" : `${audience}_document_invalid`;
}

function nativeAssetRequirements(publicDocument) {
  return [
    ...nativeReadableTextAssetRequirements(publicDocument),
    ...nativeSupplementalAudioAssetRequirements(publicDocument),
    ...nativeVideoAssetRequirements(publicDocument),
    ...nativeAudioTextAssetRequirements(publicDocument),
    ...(publicDocument.kind === "multi-part" ? nativeMultiPartAssetRequirements(publicDocument) : []),
        ...(publicDocument.kind === "mark-the-words" ? nativeMarkWordsAssetRequirements(publicDocument) : []),
    ...(publicDocument.kind === "single-choice" ? nativeSingleChoicePresentationAssetRequirements(publicDocument) : []),
    ...(publicDocument.kind === "complete-sentences" ? nativeCompleteSentencesAssetRequirements(publicDocument) : []),
    ...(publicDocument.kind === "listening" ? nativeListeningAssetRequirements(publicDocument) : []),
    ...(publicDocument.kind === "oldschool-listening" ? nativeOldschoolListeningAssetRequirements(publicDocument) : []),
    ...(publicDocument.kind === "drag-drop" ? nativeDragDropAssetRequirements(publicDocument) : []),
    ...(publicDocument.kind === "open-response" ? nativeOpenResponseAssetRequirements(publicDocument) : []),
  ];
}

async function nativeCatalog(dependencies, sql, parsedRoute) {
  const sources = await withNativeCatalogProcessing("source_collection", parsedRoute, () => dependencies.collectCatalog(sql, {
    bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug,
  }));
  const adapter = dependencies.resolveAdapter(parsedRoute.bookSlug, parsedRoute.componentSlug);
  if (!adapter || !sources?.native || !sources.native.activities) throw nativeCatalogBoundary("catalog_scope_unavailable", "Native activity catalog scope is unavailable.", parsedRoute);
  const invalidActivities = [];
  const quarantine = (entry, code, stage) => {
    const diagnostic = { activityId: entry.activityId, kind: entry.kind, pageId: entry.placement.pageId, code, stage, loadable: false, ready: false };
    invalidActivities.push(diagnostic);
    dependencies.logger.warn?.("Builder native activity quarantined", {
      componentSlug: parsedRoute.componentSlug, activityId: entry.activityId, kind: entry.kind, code, stage,
    });
  };
  const candidates = [];
  const entries = sources.native.index?.payload?.activities || [];
  for (const entry of entries) {
    const identityContext = nativeCatalogIdentityContext(parsedRoute, entry);
    if (!adapter.ownsActivityId?.(entry.activityId)) throw nativeCatalogBoundary("activity_identity_outside_component", "Native activity catalog identity is outside its component.", identityContext);
    if (!adapter.kinds.includes(entry.kind)) throw nativeCatalogBoundary("activity_kind_unsupported", "Native activity catalog kind is unsupported.", identityContext);
  }
  const placements = await withNativeCatalogProcessing("placement_batch_load", parsedRoute, async () => {
    if (typeof adapter.resolveExistingPlacements !== "function") throw new Error("Native activity adapter lacks batch placement support.");
    try {
      const resolved = await adapter.resolveExistingPlacements(entries.map((entry) => entry.placement), {
        sql, bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug,
      });
      if (!(resolved instanceof Map)) throw new Error("Native activity batch placement result is invalid.");
      return resolved;
    } catch (error) {
      if (!isNativeActivityPlacementError(error)) throw error;
      const failedEntry = Number.isInteger(error.placementIndex)
        ? entries[error.placementIndex]
        : entries.find((entry) => entry.placement?.pageId === error.pageId);
      throw nativeCatalogBoundary("placement_resolution_failed", "Native activity catalog placement is outside its component.", nativeCatalogIdentityContext(parsedRoute, failedEntry));
    }
  });
  for (const entry of entries) {
    const identityContext = nativeCatalogIdentityContext(parsedRoute, entry);
    const placement = placements.get(entry.placement.pageId);
    if (!placement) throw nativeCatalogBoundary("placement_mismatch", "Native activity catalog placement does not match its stored source.", identityContext);
    if (placement.pageId !== entry.placement.pageId) throw nativeCatalogBoundary("placement_mismatch", "Native activity catalog placement does not match its stored source.", identityContext);
    const pair = sources.native.activities[entry.activityId];
    const kind = dependencies.resolveKind(entry.kind);
    if (!kind) throw nativeCatalogBoundary("activity_kind_unsupported", "Native activity catalog kind is unsupported.", identityContext);
    if (!pair?.public || !pair?.teacher) { quarantine(entry, "pair_missing", "pair-load"); continue; }
    if (pair.index?.activityId !== entry.activityId || pair.index?.kind !== entry.kind || pair.index?.placement?.pageId !== entry.placement.pageId) {
      quarantine(entry, "pair_topology_invalid", "pair-index"); continue;
    }
    const [publicResource, teacherResource] = await Promise.all([
      dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-public", entry.activityId),
      dependencies.resolveResource(parsedRoute.bookSlug, parsedRoute.componentSlug, "native-activity-teacher", entry.activityId),
    ]);
    if (!publicResource || !teacherResource) throw nativeCatalogBoundary("activity_resources_unavailable", "Native activity catalog resources are unavailable.", identityContext);
    let publicSource;
    try { publicSource = normalizeCatalogSource(pair.public, publicResource); }
    catch (error) { quarantine(entry, catalogDocumentCode(error, "public"), "public-document"); continue; }
    let teacherSource;
    try { teacherSource = normalizeCatalogSource(pair.teacher, teacherResource); }
    catch (error) { quarantine(entry, catalogDocumentCode(error, "teacher"), "teacher-document"); continue; }
    let publicDocument;
    try { publicDocument = kind.normalizePublic(publicSource.payload, entry.activityId); }
    catch { quarantine(entry, "public_document_invalid", "public-normalization"); continue; }
    let teacherDocument;
    try { teacherDocument = kind.normalizeTeacher(teacherSource.payload, entry.activityId); }
    catch { quarantine(entry, "teacher_document_invalid", "teacher-normalization"); continue; }
    try {
      validateNativeActivityPair(publicDocument, teacherDocument);
      if (publicDocument.placement.pageId !== entry.placement.pageId) throw new Error("placement mismatch");
    } catch { quarantine(entry, "pair_topology_invalid", "pair-validation"); continue; }
    candidates.push({ entry, placement, kind, publicDocument, teacherDocument });
  }

  return withNativeCatalogProcessing("catalog_projection", parsedRoute, async () => {
    const references = candidates.flatMap((candidate) => candidate.publicDocument.assets);
    const loadedAssets = Array.isArray(sources.native.assetRows)
      ? sources.native.assetRows
      : await withNativeCatalogProcessing("catalog_asset_load", parsedRoute, () => dependencies.loadCatalogAssets(sql, {
        bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug, references,
      }));
    const assetRows = new Map(loadedAssets.map((row) => [String(row.id), row]));
    const activities = [];
    for (const candidate of candidates) {
      const { entry, placement, kind, publicDocument, teacherDocument } = candidate;
      const identityContext = nativeCatalogIdentityContext(parsedRoute, entry);
      let invalidAsset = false;
      const issues = await withNativeCatalogProcessing("readiness_assessment", identityContext, async () => [
        ...kind.assessReadiness(publicDocument, teacherDocument).issues,
      ]);
      for (const reference of publicDocument.assets) {
        const asset = assetRows.get(reference.assetId);
        if (!asset) { issues.push("A required managed asset is missing."); continue; }
        if ((asset.book_slug && asset.book_slug !== parsedRoute.bookSlug) || (asset.component_slug && asset.component_slug !== parsedRoute.componentSlug)) {
          throw nativeCatalogBoundary("asset_component_mismatch", "Managed artwork is outside its component.", { activityId: entry.activityId });
        }
        const canonicalFontSlot = `font-${String(reference.assetId || "").replaceAll("-", "").toLowerCase()}`;
        if (reference.role !== "activity_font" && asset.source_metadata?.native_activity_id && asset.source_metadata.native_activity_id !== entry.activityId) {
          throw nativeCatalogBoundary("asset_activity_mismatch", "Managed artwork is owned by another activity.", { activityId: entry.activityId });
        }
        const owned = reference.role === "activity_font"
          ? asset.mime_type === MANAGED_TTF_MEDIA_TYPE && asset.source_metadata?.font_library_scope === "component" && reference.slot === canonicalFontSlot
          : asset.source_metadata?.native_activity_id === entry.activityId && asset.source_metadata?.asset_slot === reference.slot;
        if (asset.checksum_sha256 !== reference.checksumSha256 || asset.asset_role !== reference.role
          || asset.publication_status !== "draft" || asset.access_level !== "internal" || asset.storage_profile !== "private" || !owned) {
          invalidAsset = true; break;
        }
      }
      if (invalidAsset) { quarantine(entry, "required_asset_missing", "managed-asset-validation"); continue; }
      const requirements = await withNativeCatalogProcessing("asset_requirement_derivation", identityContext, async () => (
        dependencies.deriveAssetRequirements(publicDocument)
      ));
      for (const requirement of requirements) {
        const reference = publicDocument.assets.find((asset) => asset.slot === requirement.slot);
        const asset = reference ? assetRows.get(reference.assetId) : null;
        if (!asset || (requirement.mediaType && asset.mime_type !== requirement.mediaType)) {
          issues.push(`${requirement.label || "Native managed asset"} media type does not match the managed asset.`);
        } else if (requirement.width !== undefined
          && (Number(asset.width) !== requirement.width || Number(asset.height) !== requirement.height)) {
          issues.push(`${requirement.label || "Managed image"} dimensions do not match the managed asset.`);
        }
      }
      activities.push({
        activityId: entry.activityId,
        kind: entry.kind,
        title: publicDocument.metadata.title,
        placement: entry.placement,
        sourcePageId: placement.sourcePageId || entry.placement.pageId,
        assignment: {
          state: placement.assignmentState || "assigned",
          ...(placement.unassignedReason ? { reason: placement.unassignedReason } : {}),
        },
        ready: issues.length === 0,
        issues: [...new Set(issues)],
      });
    }
    return json(200, {
      schemaVersion: "1.0", bookSlug: parsedRoute.bookSlug, componentSlug: parsedRoute.componentSlug, activities,
      ...(invalidActivities.length ? { invalidActivities } : {}),
    });
  });
}

export function createBuilderNativeActivitiesHandler(overrides = {}) {
  const dependencies = {
    getDatabase: overrides.getDatabase || getBuilderSql,
    teacherAssetsReady: overrides.teacherAssetsReady || builderTeacherAnswerAssetsReady,
    authorize: overrides.authorize || requireBuilderUser,
    resolveAdapter: overrides.resolveAdapter || resolveNativeActivityAdapter,
    resolveKind: overrides.resolveKind || resolveNativeActivityKind,
    resolveResource: overrides.resolveResource || resolveBuilderContentResource,
    loadDocument: overrides.loadDocument || loadBuilderComponentDocument,
    create: overrides.create || createBuilderNativeActivity,
    delete: overrides.delete || deleteBuilderNativeActivity,
    mutateLifecycle: overrides.mutateLifecycle || mutateBuilderActivityLifecycle,
    loadKnownActivityIds: overrides.loadKnownActivityIds || loadBuilderNativeActivityIds,
    savePair: overrides.savePair || saveBuilderNativeActivityPair,
    validateAssets: overrides.validateAssets || validateBuilderNativeAssetReferences,
    prepareAsset: overrides.prepareAsset || prepareBuilderNativeAssetUpload,
    claimAsset: overrides.claimAsset || claimBuilderNativeAssetUpload,
    loadAssetUploadScope: overrides.loadAssetUploadScope || loadBuilderNativeAssetUploadScope,
    completeAsset: overrides.completeAsset || completeBuilderNativeAssetUpload,
    failAsset: overrides.failAsset || failBuilderNativeAssetUpload,
    loadAsset: overrides.loadAsset || loadBuilderNativeAsset,
    prepareFont: overrides.prepareFont || prepareBuilderFontUpload,
    claimFont: overrides.claimFont || claimBuilderFontUpload,
    loadFontUploadScope: overrides.loadFontUploadScope || loadBuilderFontUploadScope,
    completeFont: overrides.completeFont || completeBuilderFontUpload,
    failFont: overrides.failFont || failBuilderFontUpload,
    listFonts: overrides.listFonts || listBuilderFonts,
    loadFont: overrides.loadFont || loadBuilderFontAsset,
    collectCatalog: overrides.collectCatalog || collectBuilderNativeActivityCatalogSources,
    loadCatalogAssets: overrides.loadCatalogAssets || loadBuilderNativeActivityCatalogAssets,
    deriveAssetRequirements: overrides.deriveAssetRequirements || nativeAssetRequirements,
    storage: overrides.storage || (() => createBookAssetStorage()),
    inspectRaster: overrides.inspectRaster || inspectManagedRaster,
    inspectAudio: overrides.inspectAudio || inspectManagedMp3,
    inspectVideo: overrides.inspectVideo || inspectManagedMp4,
    inspectPdf: overrides.inspectPdf || inspectManagedPdf,
    inspectFont: overrides.inspectFont || inspectManagedTtf,
    randomUuid: overrides.randomUuid || randomUUID,
    now: overrides.now || (() => Date.now()),
    logger: overrides.logger || console,
    saveOrder: overrides.saveOrder || saveBuilderActivityOrder,
  };
  return async function handler(event) {
    try {
      const parsedRoute = route(event);
      if (!parsedRoute) return json(404, { error: "native_activity_component_not_found" });
      const sql = dependencies.getDatabase();
      const auth = await dependencies.authorize(event, sql);
      if (auth.error) return auth.error;
      if (!dependencies.resolveAdapter(parsedRoute.bookSlug, parsedRoute.componentSlug)) return json(404, { error: "native_activity_component_not_found" });
      if (parsedRoute.action === "catalog") return event.httpMethod === "GET" ? await nativeCatalog(dependencies, sql, parsedRoute) : json(405, { error: "method_not_allowed" });
      if (parsedRoute.action === "lifecycle") return event.httpMethod === "GET" ? activityLifecycleCatalog(dependencies, sql, parsedRoute) : json(405, { error: "method_not_allowed" });
      if (parsedRoute.action === "order") {
        if (event.httpMethod !== "GET") return json(405, { error: "method_not_allowed" });
        const current = await loadBuilderActivityOrder(dependencies, sql, parsedRoute);
        return current ? json(200, { pages: current.pages, indexRevision: current.indexRevision, lifecycleRevision: current.lifecycleRevision }) : json(404, { error: "native_activity_component_not_found" });
      }
      if (parsedRoute.action === "font-list") return event.httpMethod === "GET" ? fontList(dependencies, sql, parsedRoute) : json(405, { error: "method_not_allowed" });
      if (parsedRoute.action === "font-preview") {
        if (!["GET", "HEAD"].includes(event.httpMethod)) return json(405, { error: "method_not_allowed" });
        if (!uuidV4.test(parsedRoute.assetId)) return json(404, { error: "font_not_found" });
        const asset = await dependencies.loadFont(sql, { ...parsedRoute, assetId: parsedRoute.assetId });
        if (!isBuilderFontRecord(asset)) return json(404, { error: "font_not_found" });
        return serveBuilderPrivateFont({ storage: dependencies.storage(), asset, method: event.httpMethod });
      }
      if (parsedRoute.action === "asset-preview") {
        if (!["GET", "HEAD"].includes(event.httpMethod) || !uuidV4.test(parsedRoute.assetId)) return json(405, { error: "method_not_allowed" });
        const result = await assetResponse(dependencies, sql, parsedRoute, parsedRoute.assetId);
        if (!result) return json(404, { error: "asset_not_found" });
        if (result.asset.asset_role === "native_teacher_answer") return serveProtectedNativeAnswer({ storage: dependencies.storage(), asset: result.asset, method: event.httpMethod });
        const location = await dependencies.storage().signedGetUrl({ profile: "private", objectKey: result.asset.object_key, ttlSeconds: previewTtlSeconds });
        return { statusCode: 302, headers: { Location: location, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }, body: "" };
      }
      if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
      const originError = requireBuilderOrigin(event); if (originError) return originError;
      if (parsedRoute.action === "reorder") {
        const parsed = parseJson(event, ["pageId", "activityId", "direction", "expectedIndexRevision", "expectedLifecycleRevision", "clientMutationId"]);
        if (parsed.error) return parsed.error;
        const input = parsed.value;
        if (![input.pageId, input.activityId].every((id) => typeof id === "string" && safeId.test(id)) || !["up", "down"].includes(input.direction) || ![input.expectedIndexRevision, input.expectedLifecycleRevision].every((value) => Number.isSafeInteger(value) && value >= 0) || !builderClientMutationIdPattern.test(String(input.clientMutationId || ""))) return json(400, { error: "invalid_request" });
        const current = await loadBuilderActivityOrder(dependencies, sql, parsedRoute);
        if (!current) return json(404, { error: "native_activity_component_not_found" });
        if (current.indexRevision !== input.expectedIndexRevision || current.lifecycleRevision !== input.expectedLifecycleRevision) return json(409, { error: "revision_conflict" });
        const ids = current.pages[input.pageId] || []; const position = ids.indexOf(input.activityId);
        if (position < 0 || (input.direction === "up" ? position === 0 : position === ids.length - 1)) return json(400, { error: "activity_order_boundary" });
        try { const adapter = dependencies.resolveAdapter(parsedRoute.bookSlug, parsedRoute.componentSlug); await (adapter.normalizeDestinationPlacement || adapter.normalizePlacement)({ pageId: input.pageId }, { sql, ...parsedRoute }); }
        catch { return json(400, { error: "invalid_native_activity_placement" }); }
        const result = await dependencies.saveOrder(sql, parsedRoute, current, input, auth.builderUser.id);
        return result?.outcome === "saved" ? json(200, result) : json(409, { error: result?.outcome || "revision_conflict" });
      }
      if (parsedRoute.action === "create") return createActivity(dependencies, sql, auth, parsedRoute, event);
      if (parsedRoute.action === "font-prepare") return prepareFont(dependencies, sql, auth, parsedRoute, event);
      if (parsedRoute.action === "font-finalize") return finalizeFont(dependencies, sql, auth, parsedRoute, event);
      if (parsedRoute.action === "save") return savePair(dependencies, sql, auth, parsedRoute, event);
      if (parsedRoute.action === "delete") return deleteActivity(dependencies, sql, auth, parsedRoute, event);
      if (["retire", "move"].includes(parsedRoute.action)) return mutateActivityLifecycle(dependencies, sql, auth, parsedRoute, event);
      if (parsedRoute.action === "asset-prepare") return prepareAsset(dependencies, sql, auth, parsedRoute, event);
      if (parsedRoute.action === "asset-finalize") return finalizeAsset(dependencies, sql, auth, parsedRoute, event);
      return json(404, { error: "native_activity_route_not_found" });
    } catch (error) {
      dependencies.logger.error("Builder native activity request failed", nativeActivityFailureLogFields(error));
      return json(500, { error: "native_activity_request_failed" });
    }
  };
}

export { route as parseBuilderNativeActivityRoute };
