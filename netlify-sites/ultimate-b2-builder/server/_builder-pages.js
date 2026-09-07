import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { createBookAssetStorage } from "../../../lib/book-assets/storage.js";
import { buildBuilderPageAssetObjectKey, buildBuilderPageAssetStagingKey } from "../../../lib/book-assets/object-keys.js";
import { inspectManagedRaster, MANAGED_RASTER_MAXIMUM_BYTES } from "../../../lib/book-assets/raster-inspection.js";
import { getBuilderSql, json, requireBuilderOrigin, requireBuilderUser } from "./_builder-auth.js";
import { authorizeBuilderPreviewRequestWithDiagnostic } from "./_builder-preview-authorization.js";
import { builderClientMutationIdPattern, stableBuilderJson } from "./_builder-content-security.js";
import { builderDocumentSha256 } from "./_builder-content-security.js";
import { canonicalStudentsBookPagesById, resolveBuilderPageComponent } from "./_builder-page-catalog.js";
import { resolveStudentsBookPageAuthority, managedStudentsBookPageId } from "./_students-book-page-authority.js";
import { normalizeStudentsBookCurrentHotspots, emptyStudentsBookCurrentHotspots } from "../../../src/data/ultimate-b2/studentsBookCurrentHotspots.js";
import repositoryHotspots from "../../../src/data/ultimate-b2/authoring/studentsBookHotspots.json" with { type: "json" };
import { ultimateB2StudentsBookAuthoringActivities } from "../../../src/data/ultimate-b2/studentsBookAuthoringCatalog.js";
import { createEmptyManagedComponentHotspotManifest, ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION, validateManagedComponentHotspotManifestStructure, validateUltimateB2HotspotManifestStructure } from "../../../scripts/ultimate-b2/hotspot-manifest.js";
import {
  claimBuilderPageUpload,
  completeBuilderPageUpload,
  failBuilderPageUpload,
  loadBuilderPageAsset,
  loadBuilderPageHotspots,
  loadBuilderPageUploadScope,
  loadBuilderPageActivityReferences,
  loadBuilderPages,
  mutateCanonicalBuilderPage,
  mutateBuilderPage,
  deleteBuilderPageLifecycle,
  purgeBuilderPage,
  restoreBuilderPage,
  prepareBuilderPageUpload,
} from "./_builder-pages-store.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ROUTE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._() -]{0,179}$/;
const uploadTtlSeconds = 15 * 60;
const previewTtlSeconds = 5 * 60;

const decode = (value) => { try { return decodeURIComponent(value); } catch { return ""; } };
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const safeInteger = (value, label) => {
  const normalized = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`invalid_${label}`);
  return normalized;
};

function route(event) {
  const pathname = String(event?.path || "").split("?")[0];
  const previewRoot = /(?:\/builder\/preview\/pages|\/\.netlify\/functions\/builder-pages\/preview\/pages)\/books\/([^/]+)\/components\/([^/]+)/;
  const apiRoot = /(?:\/builder\/api\/pages|\/\.netlify\/functions\/builder-pages)\/books\/([^/]+)\/components\/([^/]+)/;
  const root = previewRoot.test(pathname) ? previewRoot : apiRoot;
  const prefix = pathname.match(root);
  if (!prefix) return null;
  const scope = { bookSlug: decode(prefix[1]), componentSlug: decode(prefix[2]), preview: root === previewRoot };
  const suffix = pathname.slice(prefix.index + prefix[0].length).replace(/^\/+|\/+$/g, "");
  if (!suffix) return { ...scope, action: "list" };
  if (suffix === "assets/prepare") return { ...scope, action: "prepare" };
  if (suffix === "assets/finalize") return { ...scope, action: "finalize" };
  const match = suffix.match(/^pages\/([a-z0-9-]+)\/(metadata|reorder|delete|restore|restore-image|purge)$/);
  if (match) return { ...scope, pageId: match[1], action: match[2] };
  const preview = suffix.match(/^pages\/([a-z0-9-]+)\/assets\/([0-9a-f-]+)\/preview$/);
  if (preview) return { ...scope, pageId: preview[1], assetId: preview[2], action: "preview" };
  return null;
}

function parseJson(event, keys) {
  const type = Object.entries(event?.headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
  if (!String(type).toLowerCase().startsWith("application/json")) return { error: json(415, { error: "expected_application_json" }) };
  const encoded = String(event?.body || "");
  const bytes = event?.isBase64Encoded ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
  if (bytes.length > 64 * 1024) return { error: json(413, { error: "request_too_large" }) };
  let value; try { value = JSON.parse(bytes.toString("utf8")); } catch { return { error: json(400, { error: "invalid_json" }) }; }
  return exact(value, keys) ? { value } : { error: json(400, { error: "invalid_request" }) };
}

function pageMetadata(value, { managed = false, requireUnit = false } = {}) {
  if (!exact(value, managed ? ["label", "printedLabel", "sortOrder", "unitId"] : ["label", "printedLabel", "sortOrder"])) throw new Error("invalid_page_metadata");
  const label = String(value.label || "").trim();
  const printedLabel = String(value.printedLabel || "").trim();
  if (!label || label.length > 160 || printedLabel.length > 40 || !Number.isSafeInteger(value.sortOrder) || value.sortOrder < -100000 || value.sortOrder > 100000) throw new Error("invalid_page_metadata");
  const unitId = managed ? String(value.unitId || "") : "";
  if (managed && ((requireUnit && !unitId) || (unitId && !UUID.test(unitId)))) throw new Error("invalid_page_unit");
  return { label, printedLabel, sortOrder: value.sortOrder, ...(managed ? { unitId } : {}) };
}

function fileDescriptor(value) {
  if (!exact(value, ["name", "size", "type"]) || !SAFE_FILENAME.test(String(value.name || "")) || path.basename(value.name) !== value.name
    || !["image/png", "image/jpeg", "image/webp"].includes(value.type) || !Number.isSafeInteger(value.size)
    || value.size < 1 || value.size > MANAGED_RASTER_MAXIMUM_BYTES) throw new Error("invalid_page_image_descriptor");
  const suffix = path.extname(value.name).toLowerCase();
  if ((value.type === "image/png" && suffix !== ".png") || (value.type === "image/jpeg" && ![".jpg", ".jpeg"].includes(suffix)) || (value.type === "image/webp" && suffix !== ".webp")) throw new Error("invalid_page_image_descriptor");
  return { name: value.name, size: value.size, type: value.type };
}

function failureCode(error) {
  const value = String(error?.message || "page_asset_rejected");
  return /^[a-z0-9_]{3,64}$/.test(value) ? value : "page_asset_rejected";
}

function pageIdFromStableKey(componentSlug, stableKey) {
  const prefix = `${componentSlug}/pages/`;
  return String(stableKey || "").startsWith(prefix) ? String(stableKey).slice(prefix.length) : "";
}

function privateImage(parsed, pageId, row, previewAuthorization = "") {
  if (!row?.asset_id) return null;
  return {
    source: "managed",
    assetId: String(row.asset_id),
    url: previewAuthorization
      ? `/preview/pages/books/${encodeURIComponent(parsed.bookSlug)}/components/${encodeURIComponent(parsed.componentSlug)}/pages/${encodeURIComponent(pageId)}/assets/${encodeURIComponent(row.asset_id)}/preview?previewAuthorization=${encodeURIComponent(previewAuthorization)}`
      : `/builder/api/pages/books/${encodeURIComponent(parsed.bookSlug)}/components/${encodeURIComponent(parsed.componentSlug)}/pages/${encodeURIComponent(pageId)}/assets/${encodeURIComponent(row.asset_id)}/preview`,
    originalFilename: row.source_metadata?.original_filename || "page-image",
    mimeType: row.mime_type,
    byteSize: safeInteger(row.byte_size, "page_asset_byte_size"),
    checksumSha256: row.checksum_sha256,
    width: Number(row.width),
    height: Number(row.height),
  };
}

function listPayload(parsed, policy, stored, previewAuthorization = "") {
  const rows = new Map(stored.rows.map((row) => [pageIdFromStableKey(parsed.componentSlug, row.stable_key), row]));
  if (policy.kind === "students-book") {
    return resolveStudentsBookPageAuthority({ ...stored, units: stored.units || [] }).pages.map(({ imageRow, storedRow, ...page }) => {
      return {
        ...page,
        image: imageRow ? privateImage(parsed, page.id, imageRow, previewAuthorization) : page.image,
        ...(page.origin === "canonical" && imageRow ? { baselineImage: page.image } : {}),
        capabilities: { moveUp: true, moveDown: true, editMetadata: true, replaceImage: true, restoreCanonicalImage: page.origin === "canonical" && Boolean(imageRow), deletePage: true },
      };
    });
  }
  return stored.rows.filter((row) => row.source_metadata?.is_active === true && row.asset_id).map((row) => {
    const pageId = pageIdFromStableKey(parsed.componentSlug, row.stable_key);
    return {
      id: pageId,
      stableKey: row.stable_key,
      componentSlug: parsed.componentSlug,
      source: "managed",
      unitId: row.unit_id ? String(row.unit_id) : null,
      unitSlug: row.unit_slug || null,
      unitNumber: row.unit_number === null ? null : Number(row.unit_number),
      unitTitle: row.unit_title || "",
      unitSortOrder: row.unit_sort_order === null ? null : Number(row.unit_sort_order),
      sectionTitle: row.source_metadata?.section_title || "",
      partNumber: null,
      printedPages: [],
      printedLabel: row.source_metadata?.printed_label || "",
      sortOrder: Number(row.sort_order),
      label: row.label,
      image: privateImage(parsed, pageId, row, previewAuthorization),
      capabilities: { moveUp: true, moveDown: true, editMetadata: true, replaceImage: true, restoreCanonicalImage: false, deletePage: true },
    };
  });
}

function deletedPayload(parsed, policy, stored) {
  const rows = new Map(stored.rows.map((row) => [pageIdFromStableKey(parsed.componentSlug, row.stable_key), row]));
  if (policy.kind === "students-book") return resolveStudentsBookPageAuthority({ ...stored, units: stored.units || [] }).retained.filter((page) => page.storedRow.source_metadata?.is_permanently_deleted !== true).map(({ imageRow, storedRow, ...page }) => {
    const metadata = storedRow.source_metadata;
    return { ...page, source: "deleted", removedHotspotCount: Number(metadata.removed_hotspot_count || 0), preservedActivityCount: Number(metadata.preserved_activity_count || 0), deletedAt: metadata.deleted_at || null, canRestore: true, canDeleteCompletely: true };
  });
  return stored.rows.filter((row) => row.source_metadata?.is_deleted === true && row.source_metadata?.is_permanently_deleted !== true).map((row) => ({
    id: pageIdFromStableKey(parsed.componentSlug, row.stable_key), stableKey: row.stable_key, componentSlug: parsed.componentSlug,
    source: "deleted", unitId: row.unit_id ? String(row.unit_id) : null, unitNumber: row.unit_number === null ? null : Number(row.unit_number),
    unitTitle: row.unit_title || "", label: row.label, printedLabel: row.source_metadata?.printed_label || "", sortOrder: Number(row.sort_order),
    removedHotspotCount: Number(row.source_metadata?.removed_hotspot_count || 0), preservedActivityCount: Number(row.source_metadata?.preserved_activity_count || 0),
    deletedAt: row.source_metadata?.deleted_at || null, canRestore: true, canDeleteCompletely: true,
  }));
}

async function listResponse(dependencies, sql, parsed, policy, previewAuthorization = "") {
  const stored = await dependencies.loadPages(sql, parsed);
  if (!stored) return null;
  return {
    revision: safeInteger(stored.revision, "builder_page_revision"),
    hotspotRevision: safeInteger(stored.hotspotRevision || 0, "builder_hotspot_revision"),
    component: { bookSlug: parsed.bookSlug, componentSlug: parsed.componentSlug, kind: policy.kind, title: policy.title || "Students Book", capabilities: { restoreDeletedPage: true, deleteCompletely: true } },
    units: (stored.units || []).map((unit) => ({ id: String(unit.id), slug: unit.slug, title: unit.title, unitNumber: Number(unit.unit_number), sortOrder: Number(unit.sort_order) })),
    pages: listPayload(parsed, policy, stored, previewAuthorization),
    deletedPages: deletedPayload(parsed, policy, stored),
  };
}

function prunedPageHotspots(policy, { bookSlug, componentSlug }, stored, pageId) {
  const identity = { bookSlug, componentSlug };
  const baseline = policy.kind === "students-book" ? emptyStudentsBookCurrentHotspots() : createEmptyManagedComponentHotspotManifest(identity);
  const document = stored?.payload || baseline;
  const normalized = policy.kind === "students-book"
    ? normalizeStudentsBookCurrentHotspots(document)
    : validateManagedComponentHotspotManifestStructure(document, identity);
  const removed = normalized.pages[pageId] || [];
  const pages = { ...normalized.pages };
  delete pages[pageId];
  return { document: { ...normalized, pages }, removedHotspotCount: removed.length, preservedActivityCount: new Set(removed.map((hotspot) => hotspot.activityKey)).size };
}

async function preservedPageActivityCount(dependencies, sql, parsed, pageId) {
  const references = await dependencies.loadActivityReferences(sql, { ...parsed, pageId });
  const ids = new Set(references.legacyActivityIds || []);
  for (const entry of references.nativeIndex?.activities || []) if (entry.placement?.pageId === pageId) ids.add(entry.activityId);
  if (parsed.componentSlug === "ultimate-b2-students-book") {
    const lifecycle = references.lifecycle?.activities || {};
    for (const activity of ultimateB2StudentsBookAuthoringActivities) {
      const current = lifecycle[activity.activityKey] || { status: "active", pageId: activity.pageId };
      if (current.status === "active" && current.pageId === pageId) ids.add(activity.activityKey);
    }
  }
  return ids.size;
}

export function createBuilderPagesHandler(overrides = {}) {
  const dependencies = {
    getDatabase: overrides.getDatabase || getBuilderSql,
    authorize: overrides.authorize || requireBuilderUser,
    authorizePreview: overrides.authorizePreview || authorizeBuilderPreviewRequestWithDiagnostic,
    loadPages: overrides.loadPages || loadBuilderPages,
    prepare: overrides.prepare || prepareBuilderPageUpload,
    claim: overrides.claim || claimBuilderPageUpload,
    loadUploadScope: overrides.loadUploadScope || loadBuilderPageUploadScope,
    complete: overrides.complete || completeBuilderPageUpload,
    fail: overrides.fail || failBuilderPageUpload,
    mutate: overrides.mutate || mutateBuilderPage,
    mutateCanonical: overrides.mutateCanonical || mutateCanonicalBuilderPage,
    deleteLifecycle: overrides.deleteLifecycle || deleteBuilderPageLifecycle,
    restorePage: overrides.restorePage || overrides.restoreStudentsPage || restoreBuilderPage,
    purgePage: overrides.purgePage || purgeBuilderPage,
    loadActivityReferences: overrides.loadActivityReferences || loadBuilderPageActivityReferences,
    loadHotspots: overrides.loadHotspots || loadBuilderPageHotspots,
    loadAsset: overrides.loadAsset || loadBuilderPageAsset,
    storage: overrides.storage || (() => createBookAssetStorage()),
    inspectRaster: overrides.inspectRaster || inspectManagedRaster,
    randomUuid: overrides.randomUuid || randomUUID,
    now: overrides.now || (() => Date.now()),
    logger: overrides.logger || console,
  };
  return async function handler(event) {
    const parsed = route(event);
    if (!parsed || !SAFE_ROUTE.test(parsed.bookSlug) || !SAFE_ROUTE.test(parsed.componentSlug) || (parsed.pageId && !SAFE_ROUTE.test(parsed.pageId))) return json(404, { error: "page_route_not_found" });
    const policy = resolveBuilderPageComponent(parsed.bookSlug, parsed.componentSlug);
    if (!policy) return json(404, { error: "page_component_not_found" });
    try {
      const sql = dependencies.getDatabase();
      let auth = null;
      if (parsed.preview) {
        if (!["list", "preview"].includes(parsed.action)) return json(404, { error: "page_preview_not_found" });
        const decision = await dependencies.authorizePreview(event, sql, {
          action: parsed.action === "list" ? "managed-page-catalog" : "managed-page-asset",
          bookSlug: parsed.bookSlug,
          componentSlug: parsed.componentSlug,
          ...(parsed.action === "preview" ? { pageId: parsed.pageId } : {}),
        });
        if (!(typeof decision === "boolean" ? decision : decision?.authorized === true)) return json(401, { error: "Unauthorized" });
      } else {
        auth = await dependencies.authorize(event, sql);
        if (auth.error) return auth.error;
      }
      if (parsed.action === "list") {
        if (event.httpMethod !== "GET") return json(405, { error: "method_not_allowed" });
        const result = await listResponse(dependencies, sql, parsed, policy, parsed.preview ? String(event?.queryStringParameters?.previewAuthorization || "") : "");
        return result ? json(200, result) : json(404, { error: "page_component_not_found" });
      }
      if (parsed.action === "preview") {
        if (!["GET", "HEAD"].includes(event.httpMethod) || !UUID_V4.test(parsed.assetId)) return json(405, { error: "method_not_allowed" });
        const asset = await dependencies.loadAsset(sql, { ...parsed, pageKey: `${parsed.componentSlug}/pages/${parsed.pageId}` });
        if (!asset) return json(404, { error: "page_asset_not_found" });
        const location = await dependencies.storage().signedGetUrl({ profile: "private", objectKey: asset.object_key, ttlSeconds: previewTtlSeconds });
        return { statusCode: 302, headers: { Location: location, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }, body: "" };
      }
      if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
      const originError = requireBuilderOrigin(event); if (originError) return originError;

      if (parsed.action === "prepare") {
        const body = parseJson(event, ["mode", "pageId", "expectedRevision", "clientMutationId", "metadata", "file"]); if (body.error) return body.error;
        if (!Number.isSafeInteger(body.value.expectedRevision) || body.value.expectedRevision < 0 || !builderClientMutationIdPattern.test(String(body.value.clientMutationId || ""))) return json(400, { error: "invalid_upload_identity" });
        const canonical = policy.kind === "students-book" && canonicalStudentsBookPagesById.has(String(body.value.pageId || ""));
        let metadata; let file; try { metadata = pageMetadata(body.value.metadata, { managed: !canonical, requireUnit: !canonical && body.value.mode === "create" }); file = fileDescriptor(body.value.file); } catch (error) { return json(400, { error: failureCode(error) }); }
        let pageId = String(body.value.pageId || "");
        if (canonical) {
          const baseline = canonicalStudentsBookPagesById.get(pageId);
          if (body.value.mode !== "replace" || !baseline) return json(400, { error: "invalid_students_book_page_operation" });
          const currentPages = await dependencies.loadPages(sql, parsed);
          const currentRow = currentPages?.rows?.find((row) => row.stable_key === `${parsed.componentSlug}/pages/${pageId}`);
          if (currentRow?.source_metadata?.is_deleted === true) return json(409, { error: "page_inactive", currentRevision: currentPages.revision });
          metadata = { ...metadata, baselineWidth: baseline.image.width, baselineHeight: baseline.image.height };
        } else if (body.value.mode === "create") {
          if (pageId) return json(400, { error: "new_page_id_must_be_empty" });
          pageId = `${policy.kind === "students-book" ? "sb" : policy.pagePrefix}-page-${body.value.clientMutationId.replaceAll("-", "")}`;
        } else if (body.value.mode !== "replace" || !SAFE_ROUTE.test(pageId)) return json(400, { error: "invalid_managed_page_operation" });
        if (policy.kind === "students-book" && !canonical && !managedStudentsBookPageId.test(pageId)) return json(400, { error: "invalid_students_book_page_operation" });
        const uploadId = dependencies.randomUuid();
        const pageKey = `${parsed.componentSlug}/pages/${pageId}`;
        const stagingObjectKey = buildBuilderPageAssetStagingKey({ ...parsed, pageId, uploadId });
        const requestSha256 = sha256(stableBuilderJson({ ...parsed, pageId, mode: body.value.mode, expectedRevision: body.value.expectedRevision, metadata, file }));
        const prepared = await dependencies.prepare(sql, { ...parsed, pageKey, mode: body.value.mode, expectedRevision: body.value.expectedRevision, clientMutationId: body.value.clientMutationId, uploadId, requestSha256, pageMetadata: metadata, fileDescriptor: file, stagingObjectKey, builderUserId: auth.builderUser.id, expiresAt: new Date(dependencies.now() + uploadTtlSeconds * 1000).toISOString() });
        if (!prepared || ["revision_conflict", "mutation_id_conflict"].includes(prepared.outcome)) return json(409, { error: prepared?.outcome || "upload_prepare_failed", currentRevision: prepared?.current_revision ?? null });
        if (!["prepared", "idempotent"].includes(prepared.outcome) || prepared.session_state !== "prepared") return json(prepared.outcome === "resource_not_found" ? 404 : 409, { error: prepared.outcome });
        const authorization = await dependencies.storage().signedPutUrl({ profile: "private", objectKey: prepared.staging_object_key, contentType: file.type, ttlSeconds: uploadTtlSeconds });
        return json(200, { pageId, uploadId: prepared.upload_id, expectedRevision: body.value.expectedRevision, expiresIn: uploadTtlSeconds, authorization, idempotent: prepared.outcome === "idempotent" });
      }

      if (parsed.action === "finalize") {
        const body = parseJson(event, ["uploadId", "expectedRevision", "clientMutationId"]); if (body.error) return body.error;
        if (!UUID_V4.test(String(body.value.uploadId || "")) || !Number.isSafeInteger(body.value.expectedRevision) || body.value.expectedRevision < 0 || !builderClientMutationIdPattern.test(String(body.value.clientMutationId || ""))) return json(400, { error: "invalid_finalize_identity" });
        const uploadScope = await dependencies.loadUploadScope(sql, { uploadId: body.value.uploadId, builderUserId: auth.builderUser.id });
        if (!uploadScope) return json(404, { error: "session_not_found" });
        if (uploadScope.bookSlug !== parsed.bookSlug || uploadScope.componentSlug !== parsed.componentSlug) return json(409, { error: "upload_scope_conflict" });
        const claimed = await dependencies.claim(sql, { uploadId: body.value.uploadId, expectedRevision: body.value.expectedRevision, clientMutationId: body.value.clientMutationId, builderUserId: auth.builderUser.id });
        if (!claimed) return json(409, { error: "upload_claim_failed" });
        if (claimed.outcome === "idempotent") {
          if (claimed.book_slug !== parsed.bookSlug || claimed.component_slug !== parsed.componentSlug) return json(409, { error: "session_identity_conflict" });
          const result = await listResponse(dependencies, sql, parsed, policy);
          return result ? json(200, { ...result, idempotent: true }) : json(404, { error: "page_component_not_found" });
        }
        if (claimed.outcome !== "claimed" || claimed.book_slug !== parsed.bookSlug || claimed.component_slug !== parsed.componentSlug) return json(claimed.outcome === "session_not_found" ? 404 : claimed.outcome === "expired_session" ? 410 : 409, { error: claimed.outcome === "claimed" ? "session_identity_conflict" : claimed.outcome });
        const storage = dependencies.storage();
        try {
          const head = await storage.head({ profile: "private", objectKey: claimed.staging_object_key });
          if (head.byteSize !== Number(claimed.file_descriptor.size)) throw new Error("actual_object_size_mismatch");
          if (head.contentType && head.contentType !== claimed.file_descriptor.type) throw new Error("actual_object_mime_mismatch");
          const bytes = await storage.download({ profile: "private", objectKey: claimed.staging_object_key });
          if (bytes.length !== Number(claimed.file_descriptor.size)) throw new Error("actual_object_size_mismatch");
          const inspected = await dependencies.inspectRaster(bytes);
          if (inspected.mimeType !== claimed.file_descriptor.type) throw new Error("actual_mime_mismatch");
          if (policy.kind === "students-book" && canonicalStudentsBookPagesById.has(pageIdFromStableKey(parsed.componentSlug, claimed.page_key)) && (inspected.width !== Number(claimed.page_metadata.baselineWidth) || inspected.height !== Number(claimed.page_metadata.baselineHeight))) throw new Error("students_book_page_dimensions_mismatch");
          const pageId = pageIdFromStableKey(parsed.componentSlug, claimed.page_key);
          const objectKey = buildBuilderPageAssetObjectKey({ ...parsed, pageId, checksum: inspected.checksumSha256, extension: inspected.extension });
          await storage.upload({ profile: "private", objectKey, body: inspected.bytes, contentType: inspected.mimeType, checksumSha256: inspected.checksumSha256, byteSize: inspected.byteSize });
          const completed = await dependencies.complete(sql, { uploadId: body.value.uploadId, builderUserId: auth.builderUser.id, objectKey, storageBucket: storage.bucket("private"), mimeType: inspected.mimeType, byteSize: inspected.byteSize, checksumSha256: inspected.checksumSha256, width: inspected.width, height: inspected.height });
          await storage.delete({ profile: "private", objectKey: claimed.staging_object_key }).catch(() => {});
          if (!completed) throw new Error("page_upload_completion_failed");
          const result = await listResponse(dependencies, sql, parsed, policy);
          return json(200, { ...result, idempotent: false });
        } catch (error) {
          await Promise.allSettled([dependencies.fail(sql, { uploadId: body.value.uploadId, builderUserId: auth.builderUser.id, failureCode: failureCode(error) }), storage.delete({ profile: "private", objectKey: claimed.staging_object_key })]);
          return json(400, { error: failureCode(error) });
        }
      }

      if (["metadata", "reorder", "delete", "restore", "restore-image", "purge"].includes(parsed.action)) {
        const body = parseJson(event, parsed.action === "delete" ? ["expectedRevision", "expectedHotspotRevision", "clientMutationId", "metadata"] : ["expectedRevision", "clientMutationId", "metadata"]); if (body.error) return body.error;
        if (!Number.isSafeInteger(body.value.expectedRevision) || body.value.expectedRevision < 0 || !builderClientMutationIdPattern.test(String(body.value.clientMutationId || ""))) return json(400, { error: "invalid_mutation_identity" });
        if (parsed.action === "delete" && (!Number.isSafeInteger(body.value.expectedHotspotRevision) || body.value.expectedHotspotRevision < 0)) return json(400, { error: "invalid_hotspot_revision" });
        const canonical = policy.kind === "students-book" && canonicalStudentsBookPagesById.has(parsed.pageId);
        if (policy.kind === "students-book" && !canonical && !managedStudentsBookPageId.test(parsed.pageId)) return json(404, { error: "page_not_found" });
        if (!canonical && parsed.action === "restore-image") return json(400, { error: "operation_not_allowed" });
        let metadata = {};
        if (["metadata", "reorder"].includes(parsed.action)) { try { metadata = pageMetadata(body.value.metadata, { managed: !canonical }); } catch (error) { return json(400, { error: failureCode(error) }); } }
        else if (!exact(body.value.metadata, [])) return json(400, { error: "invalid_page_metadata" });
        let result;
        if (parsed.action === "delete") {
          const baseline = policy.kind === "students-book" ? canonicalStudentsBookPagesById.get(parsed.pageId) : null;
          if (policy.kind === "students-book" && !baseline && !managedStudentsBookPageId.test(parsed.pageId)) return json(404, { error: "page_not_found" });
          const storedHotspots = await dependencies.loadHotspots(sql, parsed);
          const pruned = prunedPageHotspots(policy, parsed, storedHotspots, parsed.pageId);
          pruned.preservedActivityCount = await preservedPageActivityCount(dependencies, sql, parsed, parsed.pageId);
          if (safeInteger(storedHotspots?.revision || 0, "builder_hotspot_revision") !== body.value.expectedHotspotRevision) return json(409, { error: "hotspot_revision_conflict", currentHotspotRevision: safeInteger(storedHotspots?.revision || 0, "builder_hotspot_revision") });
          const pageMetadata = baseline ? { label: baseline.label, printedLabel: baseline.printedLabel, sortOrder: baseline.sortOrder, unitNumber: baseline.unitNumber } : {};
          try {
            result = await dependencies.deleteLifecycle(sql, { ...parsed, pageKey: `${parsed.componentSlug}/pages/${parsed.pageId}`, expectedRevision: body.value.expectedRevision, expectedHotspotRevision: body.value.expectedHotspotRevision, clientMutationId: body.value.clientMutationId, pageMetadata, hotspotSchemaVersion: ULTIMATE_B2_HOTSPOT_SCHEMA_VERSION, hotspotDocument: pruned.document, hotspotSha256: builderDocumentSha256(pruned.document), removedHotspotCount: pruned.removedHotspotCount, preservedActivityCount: pruned.preservedActivityCount, builderUserId: auth.builderUser.id });
          } catch (error) {
            if (error?.code === "42883") return json(503, { error: "page_lifecycle_schema_not_ready" });
            throw error;
          }
        } else if (parsed.action === "restore") {
          try { result = await dependencies.restorePage(sql, { ...parsed, pageKey: `${parsed.componentSlug}/pages/${parsed.pageId}`, expectedRevision: body.value.expectedRevision, clientMutationId: body.value.clientMutationId, builderUserId: auth.builderUser.id }); }
          catch (error) { if (error?.code === "42883") return json(503, { error: "page_lifecycle_schema_not_ready" }); throw error; }
        } else if (parsed.action === "purge") {
          try { result = await dependencies.purgePage(sql, { ...parsed, pageKey: `${parsed.componentSlug}/pages/${parsed.pageId}`, expectedRevision: body.value.expectedRevision, clientMutationId: body.value.clientMutationId, builderUserId: auth.builderUser.id }); }
          catch (error) { if (error?.code === "42883") return json(503, { error: "page_lifecycle_schema_not_ready" }); throw error; }
        } else {
          const mutationInput = { ...parsed, pageKey: `${parsed.componentSlug}/pages/${parsed.pageId}`, expectedRevision: body.value.expectedRevision, clientMutationId: body.value.clientMutationId, pageMetadata: metadata, builderUserId: auth.builderUser.id };
          if (canonical) {
            const baseline = canonicalStudentsBookPagesById.get(parsed.pageId);
            if (!baseline) return json(404, { error: "page_not_found" });
            result = await dependencies.mutateCanonical(sql, {
              ...mutationInput,
              canonicalPage: {
                stableKey: baseline.stableKey,
                unitNumber: baseline.unitNumber,
                label: baseline.label,
                printedLabel: baseline.printedLabel,
                sortOrder: baseline.sortOrder,
                checksumSha256: baseline.image.checksumSha256,
                mimeType: baseline.image.mimeType,
                width: baseline.image.width,
                height: baseline.image.height,
              },
            });
          } else result = await dependencies.mutate(sql, mutationInput);
        }
        if (!result || ["revision_conflict", "hotspot_revision_conflict", "mutation_id_conflict", "unsupported_page_reference", "page_state_conflict", "page_referenced", "restorable_asset_unavailable", "page_permanently_deleted"].includes(result.outcome)) return json(409, { error: result?.outcome || "page_mutation_failed", currentRevision: result?.current_revision ?? null, currentHotspotRevision: result?.hotspot_revision ?? null });
        if (!["saved", "idempotent"].includes(result.outcome)) return json(result.outcome === "page_not_found" ? 404 : 400, { error: result.outcome });
        const listed = await listResponse(dependencies, sql, parsed, policy);
        return json(200, { ...listed, lifecycle: parsed.action === "delete" ? { pageId: parsed.pageId, pageRevision: result.current_revision, hotspotRevision: result.hotspot_revision, removedHotspotCount: Number(result.removed_hotspot_count || 0), preservedActivityCount: Number(result.preserved_activity_count || 0) } : null, idempotent: result.outcome === "idempotent" });
      }
      return json(404, { error: "page_route_not_found" });
    } catch (error) {
      dependencies.logger.error("Builder page request failed", { code: /^[A-Za-z0-9_.-]+$/.test(String(error?.code || "")) ? error.code : "unknown" });
      return json(500, { error: "builder_page_request_failed" });
    }
  };
}
