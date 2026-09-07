import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { createBookAssetStorage } from "../../../lib/book-assets/storage.js";
import { buildUnitExtraAssetObjectKey, buildUnitExtraAssetStagingKey } from "../../../lib/book-assets/object-keys.js";
import { inspectManagedMp4, MANAGED_MP4_MAXIMUM_BYTES } from "../../../lib/book-assets/video-inspection.js";
import { inspectManagedMp3, MANAGED_MP3_MAXIMUM_BYTES } from "../../../lib/book-assets/audio-inspection.js";
import { validateCurrentUnitExtrasStructure } from "../../../src/data/ultimate-b2/unitExtras.js";
import { validateCurrentUnitExtrasContext } from "./_students-book-current-extras.js";
import { getBuilderSql, json, requireBuilderOrigin, requireBuilderUser } from "./_builder-auth.js";
import { authorizeBuilderPreviewRequestWithDiagnostic } from "./_builder-preview-authorization.js";
import { builderClientMutationIdPattern, builderDocumentSha256, stableBuilderJson } from "./_builder-content-security.js";
import { resolveBuilderContentResource } from "./_builder-content-registry.js";
import { saveBuilderComponentDocument } from "./_builder-content-store.js";
import {
  archiveUnreferencedBuilderUnitExtraAssets,
  claimBuilderUnitExtraAssetUpload,
  completeBuilderUnitExtraAssetUpload,
  failBuilderUnitExtraAssetUpload,
  loadBuilderUnitExtraAsset,
  loadBuilderUnitExtraAssetUploadScope,
  prepareBuilderUnitExtraAssetUpload,
  validateBuilderUnitExtraAssetReferences,
} from "./_builder-unit-extra-assets-store.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ROUTE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._() -]{0,179}$/;
const uploadTtlSeconds = 15 * 60;
const previewTtlSeconds = 5 * 60;

const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const decode = (value) => { try { return decodeURIComponent(value); } catch { return ""; } };

function route(event) {
  const pathname = String(event?.path || "").split("?")[0];
  const previewScoped = pathname.includes("/preview/unit-extras/");
  const root = /(?:\/builder\/api\/unit-extras|\/builder\/preview\/unit-extras|\/\.netlify\/functions\/builder-unit-extra-assets(?:\/preview\/unit-extras)?)\/books\/([^/]+)\/components\/([^/]+)/;
  const prefix = pathname.match(root);
  if (!prefix) return null;
  const scope = { bookSlug: decode(prefix[1]), componentSlug: decode(prefix[2]) };
  const suffix = pathname.slice(prefix.index + prefix[0].length).replace(/^\/+|\/+$/g, "");
  if (suffix === "save") return { ...scope, action: "save" };
  let match = suffix.match(/^units\/([a-z0-9-]+)\/(videos|audios)\/((?:video|audio)-[a-f0-9]{32})\/assets\/(prepare|finalize)$/);
  if (match && (match[2] === "videos") === match[3].startsWith("video-")) return { ...scope, unitSlug: match[1], mediaKind: match[2], itemId: match[3], action: match[4] };
  match = suffix.match(/^units\/([a-z0-9-]+)\/(videos|audios)\/((?:video|audio)-[a-f0-9]{32})\/assets\/([0-9a-f-]+)\/preview$/);
  if (match && (match[2] === "videos") === match[3].startsWith("video-")) return { ...scope, unitSlug: match[1], mediaKind: match[2], itemId: match[3], assetId: match[4], action: "preview", previewScoped };
  return null;
}

function parseJson(event, keys, maximumBytes = 1024 * 1024) {
  const type = Object.entries(event?.headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
  if (!String(type).toLowerCase().startsWith("application/json")) return { error: json(415, { error: "expected_application_json" }) };
  const encoded = String(event?.body || "");
  const bytes = event?.isBase64Encoded ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
  if (bytes.length > maximumBytes) return { error: json(413, { error: "request_too_large" }) };
  let value; try { value = JSON.parse(bytes.toString("utf8")); } catch { return { error: json(400, { error: "invalid_json" }) }; }
  if (!exact(value, keys)) return { error: json(400, { error: "invalid_request" }) };
  return { value };
}

function mediaPolicy(parsed) {
  return parsed.mediaKind === "audios"
    ? { mimeType: "audio/mpeg", extension: ".mp3", role: "unit_extra_audio", maximumBytes: MANAGED_MP3_MAXIMUM_BYTES }
    : { mimeType: "video/mp4", extension: ".mp4", role: "unit_extra_video", maximumBytes: MANAGED_MP4_MAXIMUM_BYTES };
}

function descriptor(value, parsed) {
  const policy = mediaPolicy(parsed);
  if (!exact(value, ["name", "size", "type", "assetSlot"]) || value.assetSlot !== parsed.itemId || value.type !== policy.mimeType
    || !SAFE_FILENAME.test(String(value.name || "")) || path.basename(value.name) !== value.name || path.extname(value.name).toLowerCase() !== policy.extension
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > policy.maximumBytes) throw new Error(parsed.mediaKind === "audios" ? "invalid_mp3_descriptor" : "invalid_mp4_descriptor");
  return { name: value.name, size: value.size, type: policy.mimeType, assetSlot: value.assetSlot };
}

function failureCode(error) {
  const value = String(error?.message || "unit_extra_asset_rejected");
  return /^[a-z0-9_]{3,64}$/.test(value) ? value : "unit_extra_asset_rejected";
}

async function responseForAsset(dependencies, sql, parsed, assetId) {
  const policy = mediaPolicy(parsed);
  const asset = await dependencies.loadAsset(sql, { ...parsed, assetId });
  if (!asset || asset.publication_status !== "draft" || asset.access_level !== "internal" || asset.storage_profile !== "private"
    || asset.mime_type !== policy.mimeType || asset.asset_role !== policy.role || asset.activity_id !== null || asset.page_id !== null) return null;
  return {
    asset,
    reference: { assetId: String(asset.id), checksumSha256: asset.checksum_sha256, role: policy.role, slot: asset.source_metadata.asset_slot },
    previewUrl: `/builder/api/unit-extras/books/${encodeURIComponent(parsed.bookSlug)}/components/${encodeURIComponent(parsed.componentSlug)}/units/${encodeURIComponent(parsed.unitSlug)}/${parsed.mediaKind}/${encodeURIComponent(parsed.itemId)}/assets/${encodeURIComponent(asset.id)}/preview`,
    metadata: { mimeType: asset.mime_type, byteSize: Number(asset.byte_size), ...(policy.role === "unit_extra_video" ? { durationMs: Math.round(Number(asset.duration_seconds) * 1_000) } : {}) },
  };
}

export function createBuilderUnitExtraAssetsHandler(overrides = {}) {
  const dependencies = {
    getDatabase: overrides.getDatabase || getBuilderSql,
    authorize: overrides.authorize || requireBuilderUser,
    authorizePreview: overrides.authorizePreview || authorizeBuilderPreviewRequestWithDiagnostic,
    resolveResource: overrides.resolveResource || resolveBuilderContentResource,
    saveDocument: overrides.saveDocument || saveBuilderComponentDocument,
    prepare: overrides.prepare || prepareBuilderUnitExtraAssetUpload,
    claim: overrides.claim || claimBuilderUnitExtraAssetUpload,
    complete: overrides.complete || completeBuilderUnitExtraAssetUpload,
    fail: overrides.fail || failBuilderUnitExtraAssetUpload,
    loadAsset: overrides.loadAsset || loadBuilderUnitExtraAsset,
    loadUploadScope: overrides.loadUploadScope || loadBuilderUnitExtraAssetUploadScope,
    validateAssets: overrides.validateAssets || validateBuilderUnitExtraAssetReferences,
    archiveUnreferenced: overrides.archiveUnreferenced || archiveUnreferencedBuilderUnitExtraAssets,
    storage: overrides.storage || (() => createBookAssetStorage()),
    inspectVideo: overrides.inspectVideo || inspectManagedMp4,
    inspectAudio: overrides.inspectAudio || inspectManagedMp3,
    randomUuid: overrides.randomUuid || randomUUID,
    now: overrides.now || (() => Date.now()),
    logger: overrides.logger || console,
  };
  return async function handler(event) {
    const parsed = route(event);
    if (!parsed || !SAFE_ROUTE.test(parsed.bookSlug) || !SAFE_ROUTE.test(parsed.componentSlug) || (parsed.unitSlug && !SAFE_ROUTE.test(parsed.unitSlug))) return json(404, { error: "unit_extra_route_not_found" });
    try {
      const sql = dependencies.getDatabase();
      let auth = null;
      if (parsed.previewScoped) {
        if (parsed.action !== "preview") return json(404, { error: "unit_extra_route_not_found" });
        const decision = await dependencies.authorizePreview(event, sql, { action: "unit-extra-draft-asset", bookSlug: parsed.bookSlug, componentSlug: parsed.componentSlug });
        if (!(typeof decision === "boolean" ? decision : decision?.authorized === true)) return json(401, { error: "Unauthorized" });
      } else {
        auth = await dependencies.authorize(event, sql);
        if (auth.error) return auth.error;
      }
      if (parsed.action === "preview") {
        if (!['GET', 'HEAD'].includes(event.httpMethod) || !UUID_V4.test(parsed.assetId)) return json(event.httpMethod === "GET" ? 404 : 405, { error: "method_not_allowed" });
        const result = await responseForAsset(dependencies, sql, parsed, parsed.assetId);
        if (!result) return json(404, { error: "asset_not_found" });
        const location = await dependencies.storage().signedGetUrl({ profile: "private", objectKey: result.asset.object_key, ttlSeconds: previewTtlSeconds });
        return { statusCode: 302, headers: { Location: location, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }, body: "" };
      }
      if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
      const originError = requireBuilderOrigin(event); if (originError) return originError;
      const resource = await dependencies.resolveResource(parsed.bookSlug, parsed.componentSlug, "unit-extras", "");
      if (!resource) return json(404, { error: "unit_extras_component_not_found" });

      if (parsed.action === "prepare") {
        const body = parseJson(event, ["expectedRevision", "clientMutationId", "file"]); if (body.error) return body.error;
        if (!Number.isSafeInteger(body.value.expectedRevision) || body.value.expectedRevision < 1 || !builderClientMutationIdPattern.test(String(body.value.clientMutationId || ""))) return json(400, { error: "invalid_upload_identity" });
        let file; try { file = descriptor(body.value.file, parsed); } catch (error) { return json(400, { error: failureCode(error) }); }
        const uploadId = dependencies.randomUuid();
        const stagingObjectKey = buildUnitExtraAssetStagingKey({ ...parsed, uploadId });
        const requestSha256 = sha256(stableBuilderJson({ ...parsed, expectedRevision: body.value.expectedRevision, file }));
        const prepared = await dependencies.prepare(sql, { ...parsed, assetSlot: parsed.itemId, expectedRevision: body.value.expectedRevision, clientMutationId: body.value.clientMutationId, uploadId, requestSha256, fileDescriptor: file, stagingObjectKey, builderUserId: auth.builderUser.id, expiresAt: new Date(dependencies.now() + uploadTtlSeconds * 1000).toISOString() });
        if (["revision_conflict", "mutation_id_conflict"].includes(prepared.outcome)) return json(409, { error: prepared.outcome, currentRevision: prepared.currentRevision });
        if (!["prepared", "idempotent"].includes(prepared.outcome) || prepared.state !== "prepared") return json(prepared.outcome === "resource_not_found" ? 404 : 409, { error: prepared.outcome });
        const authorization = await dependencies.storage().signedPutUrl({ profile: "private", objectKey: prepared.stagingObjectKey, contentType: mediaPolicy(parsed).mimeType, ttlSeconds: uploadTtlSeconds });
        return json(200, { uploadId: prepared.uploadId, expectedRevision: body.value.expectedRevision, expiresIn: uploadTtlSeconds, authorization, idempotent: prepared.outcome === "idempotent" });
      }

      if (parsed.action === "finalize") {
        const body = parseJson(event, ["uploadId", "expectedRevision", "clientMutationId"]); if (body.error) return body.error;
        if (!UUID_V4.test(String(body.value.uploadId || "")) || !Number.isSafeInteger(body.value.expectedRevision) || body.value.expectedRevision < 1 || !builderClientMutationIdPattern.test(String(body.value.clientMutationId || ""))) return json(400, { error: "invalid_finalize_identity" });
        const uploadScope = await dependencies.loadUploadScope(sql, { uploadId: body.value.uploadId, builderUserId: auth.builderUser.id });
        if (!uploadScope) return json(404, { error: "session_not_found" });
        if (uploadScope.bookSlug !== parsed.bookSlug || uploadScope.componentSlug !== parsed.componentSlug
          || uploadScope.unitSlug !== parsed.unitSlug || uploadScope.itemId !== parsed.itemId || uploadScope.assetSlot !== parsed.itemId) {
          return json(409, { error: "upload_scope_conflict" });
        }
        const claimed = await dependencies.claim(sql, { uploadId: body.value.uploadId, expectedRevision: body.value.expectedRevision, clientMutationId: body.value.clientMutationId, builderUserId: auth.builderUser.id });
        if (claimed.outcome === "idempotent") {
          if (claimed.unitSlug !== parsed.unitSlug || claimed.itemId !== parsed.itemId) return json(409, { error: "session_identity_conflict" });
          const replay = await responseForAsset(dependencies, sql, parsed, claimed.resultingAssetId);
          return replay ? json(200, { reference: replay.reference, previewUrl: replay.previewUrl, metadata: replay.metadata, idempotent: true }) : json(404, { error: "asset_not_found" });
        }
        if (claimed.outcome !== "claimed" || claimed.unitSlug !== parsed.unitSlug || claimed.itemId !== parsed.itemId || claimed.assetSlot !== parsed.itemId) return json(claimed.outcome === "session_not_found" ? 404 : claimed.outcome === "expired_session" ? 410 : 409, { error: claimed.outcome === "claimed" ? "session_identity_conflict" : claimed.outcome });
        const storage = dependencies.storage();
        let finalizedObjectKey = ""; let createdFinalObject = false; let assetRecorded = false;
        try {
          const head = await storage.head({ profile: "private", objectKey: claimed.stagingObjectKey });
          if (head.byteSize !== claimed.fileDescriptor.size) throw new Error("actual_object_size_mismatch");
          const bytes = await storage.download({ profile: "private", objectKey: claimed.stagingObjectKey });
          if (bytes.length !== claimed.fileDescriptor.size) throw new Error("actual_object_size_mismatch");
          const policy = mediaPolicy(parsed);
          const inspected = parsed.mediaKind === "audios" ? dependencies.inspectAudio(bytes) : dependencies.inspectVideo(bytes);
          if (inspected.mimeType !== policy.mimeType || inspected.extension !== policy.extension) throw new Error("actual_mime_mismatch");
          const objectKey = buildUnitExtraAssetObjectKey({ ...parsed, checksum: inspected.checksumSha256, extension: inspected.extension });
          const uploaded = await storage.upload({ profile: "private", objectKey, body: inspected.bytes, contentType: inspected.mimeType, checksumSha256: inspected.checksumSha256, byteSize: inspected.byteSize });
          finalizedObjectKey = objectKey; createdFinalObject = uploaded?.reused !== true;
          const assetId = await dependencies.complete(sql, { uploadId: body.value.uploadId, builderUserId: auth.builderUser.id, objectKey, storageBucket: storage.bucket("private"), mimeType: inspected.mimeType, byteSize: inspected.byteSize, checksumSha256: inspected.checksumSha256, durationMs: inspected.durationMs ?? null });
          assetRecorded = true;
          await storage.delete({ profile: "private", objectKey: claimed.stagingObjectKey }).catch(() => {});
          const result = await responseForAsset(dependencies, sql, parsed, assetId);
          if (!result) throw new Error("asset_record_unavailable");
          return json(200, { reference: result.reference, previewUrl: result.previewUrl, metadata: result.metadata, idempotent: false });
        } catch (error) {
          const cleanup = [dependencies.fail(sql, { uploadId: body.value.uploadId, builderUserId: auth.builderUser.id, failureCode: failureCode(error) }), storage.delete({ profile: "private", objectKey: claimed.stagingObjectKey })];
          if (createdFinalObject && !assetRecorded && finalizedObjectKey) cleanup.push(storage.delete({ profile: "private", objectKey: finalizedObjectKey }));
          await Promise.allSettled(cleanup);
          return json(400, { error: failureCode(error) });
        }
      }

      if (parsed.action === "save") {
        const body = parseJson(event, ["expectedRevision", "clientMutationId", "document"]); if (body.error) return body.error;
        if (!Number.isSafeInteger(body.value.expectedRevision) || body.value.expectedRevision < 0 || !builderClientMutationIdPattern.test(String(body.value.clientMutationId || ""))) return json(400, { error: "invalid_save_identity" });
        let document; try { document = validateCurrentUnitExtrasStructure(body.value.document); await validateCurrentUnitExtrasContext({ document, sql }); } catch (error) { return json(400, { error: "invalid_document", detail: String(error.message).slice(0, 240) }); }
        try { await dependencies.validateAssets(sql, { ...parsed, document }); } catch { return json(400, { error: "unit_extra_asset_invalid" }); }
        const result = await dependencies.saveDocument(sql, { resource, expectedRevision: body.value.expectedRevision, clientMutationId: body.value.clientMutationId, document, payloadSha256: builderDocumentSha256(document), builderUserId: auth.builderUser.id });
        if (["revision_conflict", "mutation_id_conflict"].includes(result.outcome)) return json(409, { error: result.outcome, currentRevision: result.currentRevision });
        if (!["saved", "idempotent"].includes(result.outcome)) return json(result.outcome === "resource_not_found" ? 404 : 400, { error: result.outcome });
        if (["saved", "idempotent"].includes(result.outcome)) {
          const archived = await dependencies.archiveUnreferenced(sql, { ...parsed, builderUserId: auth.builderUser.id });
          const storage = dependencies.storage();
          await Promise.allSettled(archived.map(({ objectKey }) => storage.delete({ profile: "private", objectKey })));
        }
        return json(200, { revision: result.revision, document: resource.validate(result.document), idempotent: result.outcome === "idempotent" });
      }
      return json(404, { error: "unit_extra_route_not_found" });
    } catch (error) {
      dependencies.logger.error("Builder Unit Extra asset request failed", { code: /^[A-Za-z0-9_.-]+$/.test(String(error?.code || "")) ? error.code : "unknown" });
      return json(500, { error: "unit_extra_asset_failed" });
    }
  };
}
