import { randomUUID } from "node:crypto";
import { contentEdition, requireEditionUuid, ContentEditionError } from "../../../src/data/contentEditions.js";
import { WORDLIST_LIMITS, WordListError, exact, reject, portableDiff, stableJson, shaPattern } from "../../../src/data/wordlists/portable.js";
import { getBuilderSql, requireBuilderUser, requireBuilderOrigin, json } from "./_builder-auth.js";
import { loadEditionStatus } from "./_builder-edition-store.js";
import { prepareEditionAssets } from "./_builder-edition-assets.js";
import { editionReleaseRead } from "./_builder-editions.js";
import { inspectManagedMp3 } from "../../../lib/book-assets/audio-inspection.js";
import { wordListStorage, readWordListAudio } from "../../../lib/book-assets/wordlist-storage.js";
import { verifyWordListDataset, requiredWordListAudio, validateWordListMappings, freezeWordList, verifyWordList,
  wordListObjectKey, projectWordList, prepareWordListEdition, wordListEditionPublic } from "./_builder-wordlist-domain.js";
import { wordListDatabaseReady, mutateWordList, loadWordList, loadWordListBindings, loadWordListSession,
  wordListReleaseStatus, loadWordListEdition } from "./_builder-wordlist-store.js";

export function parseWordListRoute(event) {
  const match = String(event.path || "").match(/^(?:\/builder\/api\/publication|\/\.netlify\/functions\/builder-publication)\/wordlists\/books\/([a-z0-9-]+)\/editions\/([a-z0-9-]+)(?:\/components\/([a-z0-9-]+))?(?:\/(status|begin|session|upload|finalize|cancel|draft|prepare|publish|releases)(?:\/([a-f0-9-]+))?)?$/);
  return match ? { bookSlug: match[1], editionId: match[2], componentSlug: match[3] || null, action: match[4] || "status", id: match[5] || null } : null;
}
function bodyFor(event, keys) {
  if (String(event.body || "").length > WORDLIST_LIMITS.json || !Object.entries(event.headers || {}).some(([key, value]) => key.toLowerCase() === "content-type" && value.startsWith("application/json"))) reject("wordlist_request_invalid");
  let body; try { body = JSON.parse(event.body); } catch { reject("wordlist_request_invalid"); }
  exact(body, ["clientMutationId", ...keys]); requireEditionUuid(body.clientMutationId); return body;
}
const binary = (bytes) => ({ statusCode: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }, body: Buffer.from(bytes).toString("base64"), isBase64Encoded: true });
export async function wordListReleaseRead(release, query, storage, { teacher = false } = {}) {
  const edition = release.composition.edition;
  if (query.content === "1") return editionReleaseRead(release.content, query, storage, { teacher });
  if (!query.componentSlug) return json(200, wordListEditionPublic(release, edition));
  const record = release.wordlists.find((entry) => entry.targetSource.componentSlug === query.componentSlug);
  if (!record) return json(404, { error: "wordlist_component_unavailable" });
  if (query.audioSha256) return binary(await readWordListAudio(storage, record, query.audioSha256));
  return json(200, { releaseId: release.id, edition, wordlist: projectWordList(record, edition.editionId) });
}
export function createBuilderWordListHandler(overrides = {}) {
  const deps = { getDatabase: getBuilderSql, authorize: requireBuilderUser, ready: wordListDatabaseReady,
    status: loadEditionStatus, load: loadWordList, bindings: loadWordListBindings, session: loadWordListSession,
    mutate: mutateWordList, releaseStatus: wordListReleaseStatus, release: loadWordListEdition,
    storage: wordListStorage, prepareAssets: prepareEditionAssets, ...overrides };
  return async (event, context = {}) => {
    const route = parseWordListRoute(event); if (!route) return json(404, { error: "wordlist_route_unavailable" });
    if (["begin", "session", "upload", "finalize", "cancel", "draft"].includes(route.action) && !route.componentSlug
      || ["prepare", "publish", "releases"].includes(route.action) && route.componentSlug) return json(404, { error: "wordlist_route_unavailable" });
    try {
      const edition = contentEdition(route.bookSlug, route.editionId); const sql = deps.getDatabase();
      const auth = await deps.authorize(event, sql); if (auth.error) return auth.error;
      if (!await deps.ready(sql)) return json(409, { error: "wordlist_schema_unavailable" });
      const actor = auth.builderUser.id; const query = event.queryStringParameters || {};
      const identity = { bookSlug: route.bookSlug, editionId: route.editionId, componentSlug: route.componentSlug };
      if (event.httpMethod === "GET" && route.action === "releases") {
        const release = await deps.release(sql, { ...route, releaseId: route.id });
        return release ? wordListReleaseRead(release, query, query.audioSha256 || query.assetSha256 || query.teacherAssetActivityId ? deps.storage(context) : null, { teacher: true }) : json(404, { error: "wordlist_release_missing" });
      }
      const uploading = event.httpMethod === "POST" && route.action === "upload";
      if (uploading) { requireEditionUuid(query.clientMutationId); if (!shaPattern.test(query.sha256 || "")) reject("wordlist_audio_integrity"); }
      const status = uploading ? { sources: [], associations: {} } : await deps.status(sql, route.bookSlug, route.editionId);
      const target = status.sources.find((record) => record.reference.sourceId === status.associations[route.componentSlug] && record.reference.componentSlug === route.componentSlug);
      if (route.componentSlug && !target && !uploading) return json(409, { error: "wordlist_associated_source_required" });
      const current = target ? await deps.load(sql, target.reference.sourceId) : null;
      if (target) requiredWordListAudio({ bookSlug: route.bookSlug, entries: [], audio: [] }, route.componentSlug);
      if (event.httpMethod === "GET") {
        if (route.action === "status") {
          const releases = await deps.releaseStatus(sql, identity);
          return json(200, { edition, target: target ? { reference: target.reference, pages: target.content.publicProjection.pages.map(({ id, label }) => ({ id, label })) } : null,
            sourceId: current?.id || null, revision: Number(current?.revision || 0), record: current?.record || null,
            selectionRevision: status.selectionRevision, ...releases, releases: releases.releases.map((release) => wordListEditionPublic(release, edition)) });
        }
        if (route.action === "draft" && current?.record) {
          verifyWordList(current.record, target);
          return query.audioSha256 ? binary(await readWordListAudio(deps.storage(context), current.record, query.audioSha256))
            : json(200, { edition, wordlist: projectWordList(current.record, route.editionId) });
        }
        if (route.action === "session") {
          const session = await deps.session(sql, actor, route.id);
          if (!session || session.request.bookSlug !== route.bookSlug || session.request.editionId !== route.editionId || session.request.componentSlug !== route.componentSlug) reject("wordlist_session_context");
          return json(200, { sessionId: session.id, state: session.state, expiresAt: session.expires_at,
            uploaded: (await deps.bindings(sql, session.request.sourceId)).map((binding) => binding.sha256) });
        }
        return json(404, { error: "wordlist_unavailable" });
      }
      if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
      const originError = requireBuilderOrigin(event); if (originError) return originError;
      let body; let request;
      if (route.action === "begin") {
        body = bodyFor(event, ["sourceId", "expectedRevision", "targetSource", "dataset", "mappings"]);
        verifyWordListDataset(body.dataset); requireEditionUuid(body.sourceId);
        if (body.dataset.bookSlug !== route.bookSlug || body.dataset.datasetKey !== "publisher-wordlist" || !target
          || stableJson(body.targetSource) !== stableJson(target.reference) || current && current.id !== body.sourceId) reject("wordlist_context_invalid");
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) reject("wordlist_revision_invalid");
        if (portableDiff(current?.record?.dataset, body.dataset).omitted) reject("wordlist_omitted_entries_conflict");
        validateWordListMappings(body.dataset, target, body.mappings);
        request = { operation: "begin", ...identity, sourceId: body.sourceId, targetSourceId: target.reference.sourceId,
          targetSource: target.reference, expectedRevision: body.expectedRevision, dataset: body.dataset, mappings: body.mappings,
          requiredAudio: requiredWordListAudio(body.dataset, route.componentSlug) };
      } else if (["upload", "finalize", "cancel"].includes(route.action)) {
        const session = await deps.session(sql, actor, route.id, uploading ? query.sha256 : null);
        if (!session || session.request.bookSlug !== route.bookSlug || session.request.editionId !== route.editionId || session.request.componentSlug !== route.componentSlug
          || !uploading && session.request.targetSourceId !== target?.reference.sourceId) reject("wordlist_session_context");
        const scope = { ...identity, sourceId: session.request.sourceId, targetSourceId: session.request.targetSourceId, sessionId: session.id };
        const bindings = await deps.bindings(sql, scope.sourceId, uploading ? query.sha256 : null);
        if (route.action === "upload") {
          if (session.state !== "staging" || new Date(session.expires_at).getTime() <= Date.now()) reject("wordlist_session_unavailable");
          if (String(event.body || "").length > WORDLIST_LIMITS.file * 4 / 3 + 8) reject("wordlist_audio_limit");
          const bytes = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "binary");
          if (bytes.length > WORDLIST_LIMITS.file) reject("wordlist_audio_limit");
          let inspected; try { inspected = inspectManagedMp3(bytes); } catch { reject("wordlist_audio_invalid"); }
          const descriptor = session.request.requiredAudio.find((audio) => audio.sha256 === query.sha256 && audio.sha256 === inspected.checksumSha256 && audio.byteSize === inspected.byteSize);
          if (!descriptor) reject("wordlist_audio_integrity");
          const existing = bindings.find((binding) => binding.sha256 === descriptor.sha256);
          const storage = deps.storage(context);
          const binding = existing || { ...descriptor, ...identity, role: "wordlist_audio", sourceId: scope.sourceId, assetId: randomUUID(),
            objectKey: wordListObjectKey({ ...identity, sourceId: scope.sourceId, sha256: descriptor.sha256 }), storageBucket: storage.bucket("private") };
          delete binding.editionId;
          if (!existing) await storage.upload({ profile: "private", objectKey: binding.objectKey, body: bytes, contentType: "audio/mpeg", checksumSha256: descriptor.sha256, byteSize: descriptor.byteSize });
          await readWordListAudio(storage, { bindings: [binding] }, descriptor.sha256);
          body = { clientMutationId: query.clientMutationId }; requireEditionUuid(body.clientMutationId);
          request = { operation: "bind", ...scope, binding };
        } else {
          body = bodyFor(event, []);
          if (route.action === "cancel") request = { operation: "cancel", ...scope };
          else {
            const orderedBindings = session.request.requiredAudio.map((audio) => bindings.find((binding) => binding.sha256 === audio.sha256));
            if (orderedBindings.some((binding) => !binding)) reject("wordlist_audio_missing");
            const previous = current?.record;
            const mappingRevision = (previous?.mappingRevision || 0) + (previous && stableJson(previous.mappings) === stableJson(session.request.mappings) ? 0 : 1);
            const record = freezeWordList({ sourceId: scope.sourceId, revision: session.request.expectedRevision + 1, mappingRevision,
              dataset: session.request.dataset, target, mappings: session.request.mappings, bindings: orderedBindings });
            request = { operation: "finalize", ...scope, record };
          }
        }
      } else if (route.action === "prepare") {
        body = bodyFor(event, ["expectedRevision"]);
        const existing = await deps.release(sql, { ...identity, releaseId: body.clientMutationId });
        const releaseStatus = await deps.releaseStatus(sql, identity);
        const sources = Object.entries(status.associations).map(([component, id]) => status.sources.find((record) => record.reference.sourceId === id && record.reference.componentSlug === component));
        const wordlists = [];
        for (const component of ["students-book", "workbook"]) {
          const sourceId = status.associations[`${route.bookSlug}-${component}`];
          if (!sourceId) reject("wordlist_required_sources_missing");
          const wordlist = await deps.load(sql, sourceId); if (!wordlist?.record) reject("wordlist_required_sources_missing");
          wordlists.push(wordlist.record);
        }
        const release = existing || prepareWordListEdition({ id: body.clientMutationId, number: (releaseStatus.releases[0]?.number || 0) + 1, edition, sources, wordlists });
        if (!existing) {
          await deps.prepareAssets(deps.storage(context), release.content, context);
          // Every audio binding is a server-inspected, read-back-verified,
          // create-only object receipt. SQL captures exactly those immutable
          // rows. Do not repeat thousands of object operations in PREPARE.
          const bucket = deps.storage(context).bucket("private");
          if (release.wordlists.some((record) => record.bindings.some((binding) => binding.storageBucket !== bucket))) reject("wordlist_audio_owner");
        }
        request = { operation: "prepare", ...identity, expectedRevision: body.expectedRevision, release };
      } else if (route.action === "publish") {
        body = bodyFor(event, ["expectedRevision", "releaseId"]);
        const release = await deps.release(sql, { ...identity, releaseId: body.releaseId }); if (!release) reject("wordlist_release_missing");
        request = { operation: "publish", ...identity, expectedRevision: body.expectedRevision, releaseId: body.releaseId };
      } else return json(404, { error: "wordlist_route_unavailable" });
      const result = await deps.mutate(sql, actor, body.clientMutationId, request);
      return ["staging", "bound", "saved", "unchanged", "cancelled", "prepared", "published"].includes(result.outcome)
        ? json(200, result) : json(409, { ...result, error: result.outcome });
    } catch (error) {
      return json(error instanceof WordListError || error instanceof ContentEditionError ? 409 : 503,
        { error: error instanceof WordListError || error instanceof ContentEditionError ? error.code : "wordlist_unavailable" });
    }
  };
}
