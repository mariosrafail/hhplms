import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { createBookAssetStorage } from "../../../lib/book-assets/storage.js";
import {
  buildBookAssetHostedTeacherUiPublicKey,
  buildBookAssetTeacherUiStagingKey,
} from "../../../lib/book-assets/object-keys.js";
import { inspectTeacherAsset } from "../../../lib/teacher-project-builder/asset-inspection.js";
import {
  HOSTED_EDITABLE_UI_BINDINGS_BY_ID,
  HOSTED_TEACHER_UI_MEDIA_POLICIES,
  HOSTED_TEACHER_UI_TITLE_BINDING_IDS,
} from "../../../src/data/ultimate-b2/hostedTeacherUiBindingCatalog.js";
import { getBuilderSql, json, requireBuilderOrigin, requireBuilderUser } from "./_builder-auth.js";
import { resolveBuilderPackageUi } from "./_builder-component-registry.js";
import { overviewUiDatabaseReady, requiresOverviewUiSchema } from "./_builder-overview-ui-capability.js";
import { collectOverviewFont, overviewFontDatabaseReady, requiresOverviewFontSchema } from "./_builder-overview-font.js";
import { builderClientMutationIdPattern, builderDocumentSha256, stableBuilderJson } from "./_builder-content-security.js";
import { resolveBuilderContentResource } from "./_builder-content-registry.js";
import { loadBuilderComponentDocument, saveBuilderComponentDocument } from "./_builder-content-store.js";
import {
  claimTeacherUiAssetUploadSession,
  completeTeacherUiAssetUploadSession,
  failTeacherUiAssetUploadSession,
  loadTeacherUiAssetUploadScope,
  loadValidatedTeacherUiAssetCandidates,
  markTeacherUiAssetCandidatesSaved,
  prepareTeacherUiAssetUploadSession,
} from "./_builder-teacher-ui-assets-store.js";

const legacyIdentity = resolveBuilderPackageUi("ultimate-b2", "ultimate-b2-students-book");
const maximumRequestBytes = 512 * 1024;
const uploadTtlSeconds = 15 * 60;
const safeBasenamePattern = /^[A-Za-z0-9][A-Za-z0-9._() -]{0,179}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const header = (event, name) => Object.entries(event?.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || "";
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function resolveTeacherUiRoute(pathname, resolvePackageUi) {
  const publicRoutePrefix = /^\/(?:builder\/|\.netlify\/functions\/builder-teacher-ui-assets\/)?preview\//;
  const publicPathname = pathname.replace(publicRoutePrefix, "/preview/");
  const scopedPublic = publicPathname.match(/^\/preview\/ui-assets-v2\/books\/([a-z0-9][a-z0-9-]{0,127})\/components\/([a-z0-9][a-z0-9-]{0,127})\/([a-f0-9]{64})\.(png|jpg|webp|mp3|wav|gaf)\/?$/);
  if (scopedPublic) {
    const identity = resolvePackageUi(scopedPublic[1], scopedPublic[2]);
    return identity ? { kind: "public", identity, checksum: scopedPublic[3], extension: scopedPublic[4] } : null;
  }
  const legacyPublic = publicPathname.match(/^\/preview\/ui-assets(?:-v2)?\/([a-f0-9]{64})\.(png|jpg|webp|mp3|wav|gaf)\/?$/);
  if (legacyPublic) return { kind: "public", identity: legacyIdentity, checksum: legacyPublic[1], extension: legacyPublic[2] };
  const scopedApi = pathname.match(/^\/(?:builder\/api\/ui-assets|\.netlify\/functions\/builder-teacher-ui-assets)\/books\/([a-z0-9][a-z0-9-]{0,127})\/components\/([a-z0-9][a-z0-9-]{0,127})\/(prepare|finalize|save)\/?$/);
  if (scopedApi) {
    const identity = resolvePackageUi(scopedApi[1], scopedApi[2]);
    return identity ? { kind: "api", identity, action: scopedApi[3] } : null;
  }
  const legacyApi = pathname.match(/^\/(?:builder\/api\/ui-assets|\.netlify\/functions\/builder-teacher-ui-assets)\/(prepare|finalize|save)\/?$/);
  return legacyApi ? { kind: "api", identity: legacyIdentity, action: legacyApi[1] } : null;
}

function uiJson(statusCode, body) {
  return json(statusCode, body, { "X-Content-Type-Options": "nosniff" });
}

function parseJsonBody(event, keys) {
  const encoded = String(event?.body || "");
  const bytes = event?.isBase64Encoded ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
  if (bytes.length > maximumRequestBytes) return { error: uiJson(413, { error: "request_too_large" }) };
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return { error: uiJson(400, { error: "invalid_json" }) }; }
  if (!exactKeys(value, keys)) return { error: uiJson(400, { error: "invalid_request" }) };
  return { value };
}

function safeFilename(value) {
  const name = String(value || "");
  if (!safeBasenamePattern.test(name) || name !== path.basename(name) || /^(?:[a-z]:|\\\\|\/)|%2f|%5c|[\u0000-\u001f\u007f]/i.test(name)) throw new Error("invalid_filename");
  return name;
}

function acceptedDeclaredTypes(binding) {
  const types = new Set(HOSTED_TEACHER_UI_MEDIA_POLICIES[binding.mediaFamily].mediaTypes);
  if (binding.mediaFamily === "gaf") types.add("application/octet-stream");
  return types;
}

function normalizePrepareFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > HOSTED_TEACHER_UI_TITLE_BINDING_IDS.length) throw new Error("invalid_file_count");
  const ids = new Set();
  const normalized = files.map((file) => {
    if (!exactKeys(file, ["bindingId", "name", "size", "type"])) throw new Error("invalid_file_descriptor");
    const binding = HOSTED_EDITABLE_UI_BINDINGS_BY_ID[String(file.bindingId || "")];
    if (!binding || ids.has(binding.id)) throw new Error("unsupported_binding");
    ids.add(binding.id);
    const name = safeFilename(file.name);
    const policy = HOSTED_TEACHER_UI_MEDIA_POLICIES[binding.mediaFamily];
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > policy.maximumBytes) throw new Error("declared_file_too_large");
    const type = String(file.type || "").toLowerCase();
    if (!acceptedDeclaredTypes(binding).has(type)) throw new Error("declared_mime_mismatch");
    return { bindingId: binding.id, name, size: file.size, type, mediaFamily: binding.mediaFamily };
  });
  const titleCount = normalized.filter(({ bindingId }) => HOSTED_TEACHER_UI_TITLE_BINDING_IDS.includes(bindingId)).length;
  if (titleCount && (normalized.length !== HOSTED_TEACHER_UI_TITLE_BINDING_IDS.length || titleCount !== normalized.length || HOSTED_TEACHER_UI_TITLE_BINDING_IDS.some((id) => !ids.has(id)))) throw new Error("incomplete_title_group");
  if (!titleCount && normalized.length !== 1) throw new Error("invalid_file_count");
  return normalized;
}

function inspectionDescriptor(bindingId) {
  if (bindingId === "title.gaf") return { section: "animation", slot: "title", variant: "gaf", index: null };
  const atlas = /^title\.(sd|hd)\.(\d+)$/.exec(bindingId);
  if (atlas) return { section: "animation", slot: "title", variant: atlas[1], index: Number(atlas[2]) - 1 };
  if (bindingId.startsWith("sound.")) return { section: "audio", slot: "library", variant: "sound", index: null };
  return { section: "pages", slot: "library", variant: "image", index: null };
}

function assetMetadata(inspected) {
  return {
    sha256: inspected.metadata.sha256,
    extension: inspected.inspection.extension.slice(1),
    mediaType: inspected.metadata.mediaType,
    sizeBytes: inspected.metadata.sizeBytes,
    width: inspected.metadata.width,
    height: inspected.metadata.height,
    originalFilename: inspected.metadata.originalFilename,
  };
}

function validateGafAtlasContract(inspectedById) {
  const gaf = inspectedById["title.gaf"]?.inspection?.gaf;
  if (!gaf) return;
  const expectedPerDensity = HOSTED_TEACHER_UI_TITLE_BINDING_IDS.filter((id) => id.startsWith("title.sd.")).length;
  for (const csf of [1, 2]) {
    const sources = gaf.sources.filter((source) => source.csf === csf);
    if (sources.length !== expectedPerDensity || new Set(sources.map(({ atlasId }) => atlasId)).size !== expectedPerDensity) throw new Error("invalid_title_atlas_contract");
  }
}

async function cleanupStaging(storage, descriptors) {
  await Promise.allSettled((descriptors || []).map((descriptor) => storage.delete({ profile: "private", objectKey: descriptor.objectKey })));
}

function safeFailureCode(error) {
  const message = String(error?.message || "teacher_ui_asset_failed");
  return /^[a-z0-9_]{3,64}$/.test(message) ? message : /raster|sharp|image/i.test(message) ? "invalid_raster" : /audio/i.test(message) ? "invalid_audio" : /gaf/i.test(message) ? "invalid_gaf" : "teacher_ui_asset_rejected";
}

function safeDiagnosticCode(error) {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(String(error?.code || "")) ? error.code : "unknown";
}

function unavailable(logger, category, error) {
  logger.error("Builder Teacher UI asset dependency unavailable", { category, code: safeDiagnosticCode(error) });
  return uiJson(503, { error: `teacher_ui_${category}_unavailable` });
}

function metadataEquals(left, right) {
  return stableBuilderJson(left) === stableBuilderJson(right);
}

function changedAssetIds(current, next) {
  const ids = new Set([...Object.keys(current.assets), ...Object.keys(next.assets)]);
  return [...ids].filter((id) => !metadataEquals(current.assets[id] || null, next.assets[id] || null));
}

export function createBuilderTeacherUiAssetsHandler(overrides = {}) {
  const dependencies = {
    getDatabase: overrides.getDatabase || getBuilderSql,
    authorize: overrides.authorize || requireBuilderUser,
    resolveResource: overrides.resolveResource || resolveBuilderContentResource,
    loadDocument: overrides.loadDocument || loadBuilderComponentDocument,
    saveDocument: overrides.saveDocument || saveBuilderComponentDocument,
    overviewUiReady: overrides.overviewUiReady || overviewUiDatabaseReady,
    overviewFontReady: overrides.overviewFontReady || overviewFontDatabaseReady,
    collectOverviewFont: overrides.collectOverviewFont || collectOverviewFont,
    storage: overrides.storage || (() => createBookAssetStorage()),
    prepare: overrides.prepare || prepareTeacherUiAssetUploadSession,
    claim: overrides.claim || claimTeacherUiAssetUploadSession,
    complete: overrides.complete || completeTeacherUiAssetUploadSession,
    fail: overrides.fail || failTeacherUiAssetUploadSession,
    loadUploadScope: overrides.loadUploadScope || loadTeacherUiAssetUploadScope,
    loadCandidates: overrides.loadCandidates || loadValidatedTeacherUiAssetCandidates,
    markSaved: overrides.markSaved || markTeacherUiAssetCandidatesSaved,
    inspect: overrides.inspect || inspectTeacherAsset,
    randomUuid: overrides.randomUuid || randomUUID,
    now: overrides.now || (() => Date.now()),
    resolvePackageUi: overrides.resolvePackageUi || resolveBuilderPackageUi,
    logger: overrides.logger || console,
  };

  return async function builderTeacherUiAssetsHandler(event) {
    const pathname = String(event?.path || "").split("?")[0];
    const route = resolveTeacherUiRoute(pathname, dependencies.resolvePackageUi);
    try {
      if (route?.kind === "public") {
        if (!["GET", "HEAD"].includes(event.httpMethod)) return uiJson(405, { error: "method_not_allowed" });
        let storage;
        try { storage = dependencies.storage(); } catch (error) { return unavailable(dependencies.logger, "storage", error); }
        const objectKey = buildBookAssetHostedTeacherUiPublicKey({ ...route.identity, checksum: route.checksum, extension: route.extension });
        try { await storage.head({ profile: "public", objectKey }); } catch { return uiJson(404, { error: "asset_not_found" }); }
        return { statusCode: 302, headers: { Location: storage.publicUrl(objectKey), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" }, body: "" };
      }
      if (route?.kind !== "api") return uiJson(404, { error: "teacher_ui_asset_route_not_found" });
      if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Content-Type": "application/json" }, body: "" };
      const { identity } = route;
      const sql = dependencies.getDatabase();
      const auth = await dependencies.authorize(event, sql);
      if (auth.error) return auth.error;
      if (event.httpMethod !== "POST") return uiJson(405, { error: "method_not_allowed" });
      const originError = requireBuilderOrigin(event);
      if (originError) return originError;
      if (!String(header(event, "content-type")).toLowerCase().startsWith("application/json")) return uiJson(415, { error: "expected_application_json" });
      const resource = await dependencies.resolveResource(identity.bookSlug, identity.componentSlug, identity.resource, "");
      if (!resource) return uiJson(404, { error: "builder_resource_not_found" });

      if (route.action === "prepare") {
        const parsed = parseJsonBody(event, ["expectedRevision", "clientMutationId", "files"]);
        if (parsed.error) return parsed.error;
        if (!Number.isSafeInteger(parsed.value.expectedRevision) || parsed.value.expectedRevision < 0) return uiJson(400, { error: "invalid_expected_revision" });
        if (!builderClientMutationIdPattern.test(String(parsed.value.clientMutationId || ""))) return uiJson(400, { error: "invalid_client_mutation_id" });
        let files;
        try { files = normalizePrepareFiles(parsed.value.files); } catch (error) { return uiJson(400, { error: safeFailureCode(error) }); }
        const uploadId = dependencies.randomUuid();
        const descriptors = files.map((file) => {
          const fileId = dependencies.randomUuid();
          return { ...file, fileId, objectKey: buildBookAssetTeacherUiStagingKey({ ...identity, uploadId, fileId }) };
        });
        const requestSha256 = sha256(stableBuilderJson({ expectedRevision: parsed.value.expectedRevision, files }));
        let prepared;
        try {
          prepared = await dependencies.prepare(sql, { ...identity, expectedRevision: parsed.value.expectedRevision, clientMutationId: parsed.value.clientMutationId, uploadId, requestSha256, fileDescriptors: descriptors, builderUserId: auth.builderUser.id, expiresAt: new Date(dependencies.now() + uploadTtlSeconds * 1000).toISOString() });
        } catch (error) {
          return unavailable(dependencies.logger, "schema", error);
        }
        if (["revision_conflict", "mutation_id_conflict"].includes(prepared.outcome)) return uiJson(409, { error: prepared.outcome, currentRevision: prepared.currentRevision });
        if (!["prepared", "idempotent"].includes(prepared.outcome)) return uiJson(prepared.outcome === "resource_not_found" ? 404 : 400, { error: prepared.outcome });
        if (prepared.state !== "prepared") return uiJson(409, { error: "invalid_session_state", state: prepared.state });
        let uploads;
        try {
          const storage = dependencies.storage();
          uploads = await Promise.all(prepared.fileDescriptors.map(async (descriptor) => ({ bindingId: descriptor.bindingId, fileId: descriptor.fileId, authorization: await storage.signedPutUrl({ profile: "private", objectKey: descriptor.objectKey, contentType: descriptor.type, ttlSeconds: uploadTtlSeconds }) })));
        } catch (error) {
          return unavailable(dependencies.logger, "storage", error);
        }
        return uiJson(200, { uploadId: prepared.uploadId, expectedRevision: parsed.value.expectedRevision, expiresIn: uploadTtlSeconds, idempotent: prepared.outcome === "idempotent", uploads });
      }

      if (route.action === "finalize") {
        const parsed = parseJsonBody(event, ["uploadId", "expectedRevision", "clientMutationId"]);
        if (parsed.error) return parsed.error;
        const { uploadId, expectedRevision, clientMutationId } = parsed.value;
        if (!uuidV4Pattern.test(String(uploadId || "")) || !builderClientMutationIdPattern.test(String(clientMutationId || "")) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return uiJson(400, { error: "invalid_finalize_identity" });
        let uploadScope;
        try { uploadScope = await dependencies.loadUploadScope(sql, { uploadId, builderUserId: auth.builderUser.id }); } catch (error) { return unavailable(dependencies.logger, "schema", error); }
        if (!uploadScope || uploadScope.bookSlug !== identity.bookSlug || uploadScope.componentSlug !== identity.componentSlug) return uiJson(404, { error: "session_not_found" });
        const claimed = await dependencies.claim(sql, { uploadId, expectedRevision, clientMutationId, builderUserId: auth.builderUser.id });
        if (claimed.outcome === "idempotent") return uiJson(200, { uploadId, candidates: claimed.validatedAssets, idempotent: true });
        if (claimed.outcome === "revision_conflict") return uiJson(409, { error: "revision_conflict", currentRevision: claimed.currentRevision });
        if (claimed.outcome !== "claimed") return uiJson(claimed.outcome === "session_not_found" ? 404 : claimed.outcome === "expired_session" ? 410 : 409, { error: claimed.outcome });
        const storage = dependencies.storage();
        try {
          const inspectedById = {};
          for (const descriptor of claimed.fileDescriptors) {
            const policy = HOSTED_TEACHER_UI_MEDIA_POLICIES[descriptor.mediaFamily];
            const head = await storage.head({ profile: "private", objectKey: descriptor.objectKey });
            if (head.byteSize !== descriptor.size || head.byteSize < 1 || head.byteSize > policy.maximumBytes) throw new Error("actual_object_size_mismatch");
            const bytes = await storage.download({ profile: "private", objectKey: descriptor.objectKey });
            if (bytes.length !== descriptor.size) throw new Error("actual_object_size_mismatch");
            const inspected = await dependencies.inspect({ bytes, originalFilename: descriptor.name, descriptor: inspectionDescriptor(descriptor.bindingId) });
            if (!policy.mediaTypes.includes(inspected.metadata.mediaType)) throw new Error("wrong_slot_type");
            if (descriptor.type !== "application/octet-stream" && descriptor.type !== inspected.metadata.mediaType) throw new Error("declared_mime_mismatch");
            inspectedById[descriptor.bindingId] = inspected;
          }
          validateGafAtlasContract(inspectedById);
          const candidates = Object.fromEntries(Object.entries(inspectedById).map(([id, inspected]) => [id, assetMetadata(inspected)]));
          resource.validate({ schemaVersion: resource.schemaVersion, packageId: identity.packageId, assets: candidates });
          for (const inspected of Object.values(inspectedById)) {
            const objectKey = buildBookAssetHostedTeacherUiPublicKey({ ...identity, checksum: inspected.metadata.sha256, extension: inspected.inspection.extension });
            await storage.upload({ profile: "public", objectKey, body: inspected.bytes, contentType: inspected.metadata.mediaType, checksumSha256: inspected.metadata.sha256, byteSize: inspected.metadata.sizeBytes });
          }
          await dependencies.complete(sql, { uploadId, builderUserId: auth.builderUser.id, validatedAssets: candidates });
          await cleanupStaging(storage, claimed.fileDescriptors);
          return uiJson(200, { uploadId, candidates, idempotent: false });
        } catch (error) {
          await Promise.allSettled([dependencies.fail(sql, { uploadId, builderUserId: auth.builderUser.id, failureCode: safeFailureCode(error) }), cleanupStaging(storage, claimed.fileDescriptors)]);
          return uiJson(400, { error: safeFailureCode(error) });
        }
      }

      if (route.action === "save") {
        const parsed = parseJsonBody(event, ["expectedRevision", "clientMutationId", "document", "candidateUploadIds"]);
        if (parsed.error) return parsed.error;
        const { expectedRevision, clientMutationId } = parsed.value;
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return uiJson(400, { error: "invalid_expected_revision" });
        if (!builderClientMutationIdPattern.test(String(clientMutationId || ""))) return uiJson(400, { error: "invalid_client_mutation_id" });
        if (!Array.isArray(parsed.value.candidateUploadIds) || new Set(parsed.value.candidateUploadIds).size !== parsed.value.candidateUploadIds.length || parsed.value.candidateUploadIds.some((id) => !uuidV4Pattern.test(String(id)))) return uiJson(400, { error: "invalid_candidate_upload_ids" });
        let document;
        try { document = resource.validate(parsed.value.document); } catch (error) { return uiJson(400, { error: "invalid_document", detail: String(error.message).slice(0, 240) }); }
        if (requiresOverviewFontSchema(document)) {
          if (!await dependencies.overviewFontReady(sql)) return uiJson(409, { error: "overview_font_schema_unavailable" });
          try { await dependencies.collectOverviewFont(sql, document, identity); }
          catch { return uiJson(400, { error: "invalid_overview_font_reference" }); }
        }
        if (requiresOverviewUiSchema(document) && !await dependencies.overviewUiReady(sql)) {
          return uiJson(409, { error: "publication_ui_schema_unavailable" });
        }
        const stored = await dependencies.loadDocument(sql, resource);
        const current = stored?.document || resource.baseline();
        const changedIds = changedAssetIds(current, document);
        const newOrChanged = changedIds.filter((id) => document.assets[id] && !(
          document.independentPartsBackgrounds && !current.independentPartsBackgrounds
          && ["background.workbook-parts", "background.grammar-book-parts"].includes(id)
          && !current.assets[id] && current.assets["background.students-book-parts"]
          && metadataEquals(document.assets[id], current.assets["background.students-book-parts"])
        ));
        const rows = await dependencies.loadCandidates(sql, { uploadIds: parsed.value.candidateUploadIds, builderUserId: auth.builderUser.id, bookSlug: identity.bookSlug, componentSlug: identity.componentSlug });
        const rowsById = new Map(rows.map((row) => [String(row.id), row]));
        if (rowsById.size !== parsed.value.candidateUploadIds.length) return uiJson(400, { error: "invalid_candidate_reference" });
        const used = new Set();
        for (const bindingId of newOrChanged) {
          const match = rows.find((row) => row.validatedAssets?.[bindingId] && metadataEquals(row.validatedAssets[bindingId], document.assets[bindingId]));
          if (!match) return uiJson(400, { error: "unverified_candidate", bindingId });
          used.add(String(match.id));
        }
        const idempotentReplayCandidateAttempt = rows.length > 0 && newOrChanged.length === 0 && stored && expectedRevision < stored.revision;
        if (used.size !== rows.length && !idempotentReplayCandidateAttempt) return uiJson(400, { error: "unused_candidate_reference" });
        const changedTitleIds = changedIds.filter((id) => HOSTED_TEACHER_UI_TITLE_BINDING_IDS.includes(id));
        if (changedTitleIds.length && HOSTED_TEACHER_UI_TITLE_BINDING_IDS.some((id) => document.assets[id])) {
          const titleRows = rows.filter((row) => HOSTED_TEACHER_UI_TITLE_BINDING_IDS.some((id) => row.validatedAssets?.[id]));
          if (titleRows.length !== 1 || HOSTED_TEACHER_UI_TITLE_BINDING_IDS.some((id) => !titleRows[0].validatedAssets?.[id] || !metadataEquals(titleRows[0].validatedAssets[id], document.assets[id]))) return uiJson(400, { error: "invalid_title_candidate_group" });
        }
        const result = await dependencies.saveDocument(sql, { resource, expectedRevision, clientMutationId, document, payloadSha256: builderDocumentSha256(document), builderUserId: auth.builderUser.id });
        if (["revision_conflict", "mutation_id_conflict"].includes(result.outcome)) return uiJson(409, { error: result.outcome, currentRevision: result.currentRevision });
        if (!['saved', 'idempotent'].includes(result.outcome)) return uiJson(result.outcome === "resource_not_found" ? 404 : 400, { error: result.outcome });
        await dependencies.markSaved(sql, { uploadIds: result.outcome === "idempotent" ? parsed.value.candidateUploadIds : [...used], builderUserId: auth.builderUser.id, resultingRevision: result.revision, bookSlug: identity.bookSlug, componentSlug: identity.componentSlug });
        return uiJson(200, { bookSlug: resource.bookSlug, componentSlug: resource.componentSlug, resource: resource.resource, schemaVersion: resource.schemaVersion, revision: result.revision, source: "database", document: resource.validate(result.document), idempotent: result.outcome === "idempotent" });
      }
      return uiJson(404, { error: "teacher_ui_asset_route_not_found" });
    } catch (error) {
      dependencies.logger.error("Builder Teacher UI asset request failed", { category: "unexpected", code: safeDiagnosticCode(error) });
      return uiJson(500, { error: "teacher_ui_asset_failed" });
    }
  };
}
