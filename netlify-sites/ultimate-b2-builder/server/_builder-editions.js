import { CONTENT_SOURCE_SCHEMA, ContentEditionError, contentEdition, contentEditionBooks, editionExact,
  requireEditionComponent, requireEditionUuid, requireEditionRevision, editionSourceCompilerContract } from "../../../src/data/contentEditions.js";
import { getBuilderSql, requireBuilderUser, requireBuilderOrigin, json } from "./_builder-auth.js";
import { resolvePublicationCompiler } from "./_builder-publication-compilers.js";
import { freezeEditionSource, prepareEditionRelease, editionReleasePublicEnvelope } from "./_builder-edition-domain.js";
import { editionDatabaseReady, loadEditionStatus, loadEditionRelease, mutateEdition } from "./_builder-edition-store.js";
import { editionSourceAssetIds, validateEditionSourceAssets, prepareEditionAssets, readEditionAsset } from "./_builder-edition-assets.js";
import { createBookAssetStorage } from "../../../lib/book-assets/storage.js";
import { createCloudflareR2ReleaseStorage } from "../../../lib/book-assets/cloudflare-r2-release-storage.js";
import { nativeTeacherAnswerImages } from "../../../src/data/native-activities/nativeImageSampleAnswer.js";
import { normalizeHostedTeacherUiPreview } from "../../../src/data/ultimate-b2/hostedTeacherUiDocument.js";

export function parseBuilderEditionRoute(event) {
  const match = String(event.path || "").match(/^(?:\/builder\/api\/publication|\/\.netlify\/functions\/builder-publication)\/editions\/books\/([a-z0-9-]+)\/editions\/([a-z0-9-]+)(?:\/(capture|save-source|associate|prepare|publish|releases)(?:\/([a-f0-9-]+))?)?\/?$/);
  return match ? { bookSlug: match[1], editionId: match[2], action: match[3] || "status", releaseId: match[4] || null } : null;
}
const storageFor = (context) => context.cloudflare
  ? createCloudflareR2ReleaseStorage({ binding: context.cloudflare.releaseSourceAssets, privateBucket: context.cloudflare.releaseSourceAssetsBucket })
  : createBookAssetStorage();
const recordKeys = ["clientMutationId", "expectedRevision", "sourceId", "componentSlug", "scope", "inputs"];
function parseBody(event, keys) {
  if (!Object.entries(event.headers || {}).some(([key, value]) => key.toLowerCase() === "content-type" && String(value).startsWith("application/json"))) throw new ContentEditionError("edition_request_invalid");
  if (String(event.body || "").length > 8 * 1024 * 1024) throw new ContentEditionError("edition_request_too_large");
  let body; try { body = JSON.parse(event.body || "{}"); } catch { throw new ContentEditionError("edition_request_invalid"); }
  editionExact(body, keys, "edition_request_invalid");
  requireEditionUuid(body.clientMutationId); requireEditionRevision(body.expectedRevision, 0);
  return body;
}
export function editionReadiness(status) {
  return contentEditionBooks[status.edition.bookSlug].components.map((componentSlug) => {
    const sourceId = status.associations[componentSlug];
    const source = status.sources.find((entry) => entry.reference.sourceId === sourceId && entry.reference.componentSlug === componentSlug);
    return source ? { componentSlug, ready: true, source: source.reference }
      : { componentSlug, ready: false, code: "edition_required_source_missing", editionId: status.edition.editionId };
  });
}
export async function editionReleaseRead(release, query, storage, { teacher = false, canonicalFetcher = null } = {}) {
  if (!query.componentSlug) return json(200, editionReleasePublicEnvelope(release));
  requireEditionComponent(release.composition.edition.bookSlug, query.componentSlug);
  const member = release.members.find((entry) => entry.reference.componentSlug === query.componentSlug);
  if (query.teacherAssetActivityId) {
    if (!teacher) return json(403, { error: "edition_teacher_required" });
    const document = member.content.teacherProjection.nativeActivities[query.teacherAssetActivityId]?.document;
    const image = nativeTeacherAnswerImages(document).find((entry) => (entry.sectionId || "") === (query.sectionId || ""));
    if (!image) return json(404, { error: "edition_asset_missing" });
    const descriptor = member.content.assetManifest.find((entry) => entry.sha256 === image.reference.checksumSha256 && entry.role === "native_teacher_answer");
    if (!descriptor) return json(404, { error: "edition_asset_missing" });
    query = { ...query, assetSha256: descriptor.sha256, assetRole: descriptor.role, extension: descriptor.extension };
  }
  if (query.assetSha256) {
    const asset = await readEditionAsset(storage, release, { componentSlug: query.componentSlug, role: query.assetRole,
      sha256: query.assetSha256, extension: query.extension, teacher, canonicalFetcher });
    return { statusCode: 200, headers: { "Content-Type": asset.mediaType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      body: Buffer.from(asset.bytes).toString("base64"), isBase64Encoded: true };
  }
  if (query.teacherActivityId) {
    if (!teacher) return json(403, { error: "edition_teacher_required" });
    const entry = member.content.teacherProjection.nativeActivities[query.teacherActivityId];
    return entry ? json(200, { edition: release.composition.edition, releaseId: release.id, document: entry.document }) : json(404, { error: "edition_activity_missing" });
  }
  return json(200, { edition: release.composition.edition, releaseId: release.id, source: member.reference, projection: member.content.publicProjection });
}
// Classroom UI is a narrowly projected snapshot of the book's existing SB UI
// owner. It never exposes answers or consults the current UI Controller draft.
export async function editionClassroomUiRead(release, query, storage) {
  const edition = release.composition.edition;
  if (query.componentSlug) requireEditionComponent(edition.bookSlug, query.componentSlug);
  const owner = release.members.find((entry) => entry.reference.componentSlug === `${edition.bookSlug}-students-book`);
  if (!owner) throw new ContentEditionError("edition_ui_owner_missing");
  if (query.uiOwnerSha256 && query.uiOwnerSha256 !== owner.reference.sha256) throw new ContentEditionError("edition_ui_owner_changed");
  const ui = normalizeHostedTeacherUiPreview(owner.content.teacherProjection.ui, { packageId: owner.reference.componentSlug });
  if (query.uiBindingId || query.uiFont === "1") {
    const binding = query.uiFont === "1" ? ui.overviewCaptionFontAsset : ui.assets[query.uiBindingId];
    if (!binding) return json(404, { error: "edition_ui_asset_missing" });
    const asset = await readEditionAsset(storage, release, { componentSlug: owner.reference.componentSlug,
      role: query.uiFont === "1" ? "activity_font" : "teacher_ui", sha256: binding.sha256 || binding.checksumSha256,
      extension: query.uiFont === "1" ? "ttf" : binding.extension, teacher: true });
    return { statusCode: 200, headers: { "Content-Type": asset.mediaType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      body: Buffer.from(asset.bytes).toString("base64"), isBase64Encoded: true };
  }
  return json(200, { edition, releaseId: release.id, ownerSource: owner.reference, ui });
}
export function createBuilderEditionHandler(overrides = {}) {
  const deps = { getDatabase: getBuilderSql, authorize: requireBuilderUser, ready: editionDatabaseReady,
    status: loadEditionStatus, loadRelease: loadEditionRelease, mutate: mutateEdition,
    validateAssets: validateEditionSourceAssets, prepareAssets: prepareEditionAssets, storage: storageFor, ...overrides };
  return async (event, context = {}) => {
    const route = parseBuilderEditionRoute(event);
    if (!route) return json(404, { error: "edition_route_unavailable" });
    try {
      const edition = contentEdition(route.bookSlug, route.editionId);
      const sql = deps.getDatabase(); const auth = await deps.authorize(event, sql);
      if (auth.error) return auth.error;
      if (!await deps.ready(sql, route.bookSlug)) return json(409, { error: "edition_schema_unavailable" });
      if (event.httpMethod === "GET") {
        if (route.action === "releases" && route.releaseId) {
          const release = await deps.loadRelease(sql, route);
          if (!release) return json(404, { error: "edition_release_missing" });
          const query = event.queryStringParameters || {};
          return await editionReleaseRead(release, query, query.assetSha256 || query.teacherAssetActivityId ? deps.storage(context) : null, { teacher: true });
        }
        if (route.action !== "status") return json(405, { error: "method_not_allowed" });
        const status = await deps.status(sql, route.bookSlug, route.editionId);
        return json(200, { ...status, readiness: editionReadiness(status), releases: status.releases.map((release) => editionReleasePublicEnvelope(release)) });
      }
      if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
      const originError = requireBuilderOrigin(event); if (originError) return originError;
      let body; let request;
      const identity = { bookSlug: route.bookSlug, editionId: route.editionId };
      if (["capture", "save-source"].includes(route.action)) {
        body = parseBody(event, route.action === "capture" ? recordKeys.filter((key) => key !== "inputs") : recordKeys);
        requireEditionUuid(body.sourceId); requireEditionComponent(route.bookSlug, body.componentSlug);
        const { compilerId } = editionSourceCompilerContract(route.bookSlug, body.componentSlug);
        const inputs = route.action === "capture" ? persistableCollectedEditionInputs(await resolvePublicationCompiler(compilerId).collect(sql)) : body.inputs;
        const record = freezeEditionSource({ schemaVersion: CONTENT_SOURCE_SCHEMA, sourceId: body.sourceId, bookSlug: route.bookSlug,
          componentSlug: body.componentSlug, scope: body.scope, revision: body.expectedRevision + 1, inputs });
        if (!record.reference.scope.editionIds.includes(route.editionId)) throw new ContentEditionError("edition_source_owner_mismatch");
        await deps.validateAssets(sql, record);
        request = { operation: "save-source", ...identity, expectedRevision: body.expectedRevision, componentSlug: body.componentSlug,
          sourceId: body.sourceId, record, assetIds: editionSourceAssetIds(record) };
      } else if (route.action === "associate") {
        body = parseBody(event, ["clientMutationId", "expectedRevision", "componentSlug", "sourceId"]);
        requireEditionUuid(body.sourceId); requireEditionComponent(route.bookSlug, body.componentSlug);
        request = { operation: "associate", ...identity, expectedRevision: body.expectedRevision, componentSlug: body.componentSlug, sourceId: body.sourceId };
      } else if (route.action === "prepare") {
        body = parseBody(event, ["clientMutationId", "expectedRevision"]);
        const existing = await deps.loadRelease(sql, { ...identity, releaseId: body.clientMutationId });
        const status = await deps.status(sql, route.bookSlug, route.editionId);
        const sources = Object.entries(status.associations).map(([componentSlug, sourceId]) => status.sources.find((entry) => entry.reference.sourceId === sourceId && entry.reference.componentSlug === componentSlug)).filter(Boolean);
        const release = existing || prepareEditionRelease({ id: body.clientMutationId, number: (status.releases[0]?.number || 0) + 1, edition, sources });
        if (!existing) await deps.prepareAssets(deps.storage(context), release, context);
        request = { operation: "prepare", ...identity, expectedRevision: body.expectedRevision, release };
      } else if (route.action === "publish") {
        body = parseBody(event, ["clientMutationId", "expectedRevision", "releaseId"]);
        const release = await deps.loadRelease(sql, { ...identity, releaseId: body.releaseId });
        if (!release) return json(404, { error: "edition_release_missing" });
        request = { operation: "publish", ...identity, expectedRevision: body.expectedRevision, releaseId: release.id };
      } else return json(404, { error: "edition_route_unavailable" });
      const result = await deps.mutate(sql, auth.builderUser.id, body.clientMutationId, request);
      return ["saved", "associated", "prepared", "published"].includes(result.outcome) ? json(200, result) : json(409, { ...result, error: result.outcome });
    } catch (error) {
      return error instanceof ContentEditionError ? json(409, { error: error.code, detail: error.message }) : json(503, { error: "edition_content_unavailable" });
    }
  };
}

// Collectors attach executable registry helpers to saved-document wrappers.
// Capture only removes that known non-content wrapper field. Payloads, hashes,
// revisions, asset rows and unknown fields remain subject to the strict source
// validator; client-supplied save-source inputs never use this projection.
export function persistableCollectedEditionInputs(collected) {
  const document = (saved) => {
    if (saved == null) return saved;
    const { resource: _registryHelpers, ...durable } = saved;
    return durable;
  };
  return {
    ...collected,
    ...(collected.documents ? { documents: Object.fromEntries(Object.entries(collected.documents).map(([key, value]) => [key, document(value)])) } : {}),
    ...(collected.native ? { native: { ...collected.native, index: document(collected.native.index),
      activities: Object.fromEntries(Object.entries(collected.native.activities).map(([id, activity]) => [id, { ...activity, public: document(activity.public), teacher: document(activity.teacher) }])) } } : {}),
    ...(collected.unitExtras ? { unitExtras: { ...collected.unitExtras, document: document(collected.unitExtras.document) } } : {}),
  };
}
