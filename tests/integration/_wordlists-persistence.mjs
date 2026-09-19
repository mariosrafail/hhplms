import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createBuilderWordListHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlists.js";
import { hashBuilderToken } from "../../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { loadEditionStatus } from "../../netlify-sites/ultimate-b2-builder/server/_builder-edition-store.js";
import { loadWordList, loadWordListEdition } from "../../netlify-sites/ultimate-b2-builder/server/_builder-wordlist-store.js";
import { readPublishedEdition } from "../../netlify/functions/_book-content/edition-read.js";
import { lexicalFixture, rehashLexicon, wordListMp3, wordListSha } from "../fixtures/wordlists.js";

export async function exerciseWordListPersistence({ pool, sql, actor, packageId }) {
  const objects = new Map(); const bucket = "isolated-wordlists";
  const storage = { bucket: () => bucket,
    async upload({ objectKey, body, contentType }) { const existing = objects.get(objectKey); if (existing) assert.deepEqual(existing.bytes, body); objects.set(objectKey, { bytes: Buffer.from(body), contentType }); },
    async download({ objectKey }) { return objects.get(objectKey)?.bytes; },
    async head({ objectKey }) { const value = objects.get(objectKey); if (!value) throw new Error("missing test object"); return { byteSize: value.bytes.length, checksumSha256: createHash("sha256").update(value.bytes).digest("hex"), contentType: value.contentType }; } };
  const token = randomBytes(32).toString("hex");
  await pool.query("insert into builder_sessions(builder_user_id,token_hash,expires_at) values($1,$2,now()+interval '2 hours')", [actor, hashBuilderToken(token)]);
  // Content asset materialization is independently covered by Task 1's actual
  // Worker/110-page browser gate; this transaction test isolates lexical media.
  const handler = createBuilderWordListHandler({ getDatabase: () => sql, storage: () => storage, prepareAssets: async () => {} });
  const base = "/builder/api/publication/wordlists/books/ultimate-b2/editions";
  const call = async (suffix, body = null, { bytes, cookie = token, origin = "http://localhost", query = {} } = {}) => {
    const result = await handler({ path: `${base}/${suffix}`, httpMethod: body || bytes ? "POST" : "GET",
      headers: { host: "localhost", origin, cookie: `hh_builder_session=${cookie}`, "content-type": bytes ? "audio/mpeg" : "application/json" },
      queryStringParameters: query, body: bytes ? Buffer.from(bytes).toString("base64") : body ? JSON.stringify(body) : null, isBase64Encoded: Boolean(bytes) });
    return { status: result.statusCode, value: result.isBase64Encoded ? Buffer.from(result.body, "base64") : JSON.parse(result.body), raw: result };
  };
  const snapshot = async () => {
    const tables = ["activities", "book_pages", "book_page_hotspots", "builder_component_documents", "builder_component_document_revisions",
      "book_content_source_revisions", "book_content_edition_releases", "book_content_edition_heads", "activity_assignments"];
    const value = {};
    for (const table of tables) value[table] = (await pool.query(`select coalesce(jsonb_agg(t order by to_jsonb(t)::text),'[]') value from ${table} t`)).rows[0].value;
    return value;
  };
  const before = await snapshot();
  assert(before.book_content_source_revisions.some((row) => JSON.stringify(row.record).includes("PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL")));
  const assertPreserved = async ({ allowAddedSourceRevisions = false } = {}) => {
    const after = await snapshot();
    if (allowAddedSourceRevisions) {
      after.book_content_source_revisions = after.book_content_source_revisions.filter((row) => before.book_content_source_revisions.some((original) => original.source_id === row.source_id && original.revision === row.revision));
      after.builder_component_documents = after.builder_component_documents.filter((row) => before.builder_component_documents.some((original) => original.id === row.id));
    }
    assert.deepEqual(after, before, "Existing SB/WB content, Teacher docs, pages, hotspots/order and pinned v1 releases/assignments must be byte-identical");
  };
  const sources = (await loadEditionStatus(sql, "ultimate-b2", "international")).sources;
  const sessions = [];
  const begin = async (component, { dataset = lexicalFixture(), mappings, expectedRevision, sourceId, edition = "international" } = {}) => {
    const target = sources.find((source) => source.reference.componentSlug === `ultimate-b2-${component}`);
    const current = await loadWordList(sql, target.reference.sourceId);
    const body = { clientMutationId: randomUUID(), sourceId: sourceId || current?.id || randomUUID(), expectedRevision: expectedRevision ?? Number(current?.revision || 0),
      targetSource: target.reference, dataset, mappings: mappings || [{ group: component === "workbook" ? "work1_1" : "unit1_1", pageIds: [target.content.publicProjection.pages[0].id] }] };
    const path = `${edition}/components/ultimate-b2-${component}`;
    const response = await call(`${path}/begin`, body); sessions.push({ path, body, target }); return { path, body, target, response };
  };
  const finalize = async (session, upload = true) => {
    const id = session.response.value.sessionId; assert(id, JSON.stringify(session.response));
    if (upload) {
      const uploaded = await call(`${session.path}/upload/${id}`, null, { bytes: wordListMp3, query: { sha256: wordListSha, clientMutationId: randomUUID() } });
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded));
    }
    return call(`${session.path}/finalize/${id}`, { clientMutationId: randomUUID() });
  };
  for (const component of ["students-book", "workbook"]) {
    const session = await begin(component); assert.equal(session.response.status, 200);
    assert.equal((await call(`${session.path}/begin`, session.body)).value.replayed, true);
    assert.equal((await finalize(session)).status, 200); await assertPreserved();
    const replay = await begin(component); const result = await finalize(replay, false);
    assert.equal(result.value.outcome, "unchanged", JSON.stringify(result)); await assertPreserved();
  }
  assert.equal(objects.size, 2, "Identical MP3 bytes have independent component registrations/objects");
  assert.equal((await pool.query("select count(*)::int count from book_wordlist_audio")).rows[0].count, 2);
  assert.equal((await call("international")).status, 200);
  assert.equal((await call("international", null, { cookie: "no-session" })).status, 401);
  const badOrigin = await call("international/prepare", { clientMutationId: randomUUID(), expectedRevision: 3 }, { origin: "https://foreign.test" }); assert.equal(badOrigin.status, 403);
  const revisions = {};
  for (const edition of ["international", "greek"]) {
    const id = randomUUID(); const response = await call(`${edition}/prepare`, { clientMutationId: id, expectedRevision: 3 });
    assert.equal(response.status, 200, JSON.stringify(response)); revisions[edition] = await loadWordListEdition(sql, { bookSlug: "ultimate-b2", editionId: edition, releaseId: id });
    const read = await call(`${edition}/releases/${id}`); assert.equal(read.status, 200);
    assert.equal(read.raw.body.includes("ΕΛΛΗΝΙΚΟ_SENTINEL"), edition === "greek");
    const publish = await call(`${edition}/publish`, { clientMutationId: randomUUID(), expectedRevision: 0, releaseId: id }); assert.equal(publish.status, 200);
  }
  const target = sources.find((source) => source.reference.componentSlug.endsWith("workbook"));
  const incomplete = await begin("workbook", { mappings: [{ group: "work1_1", pageIds: [] }] });
  assert.equal((await finalize(incomplete, false)).status, 200); await assertPreserved();
  assert.equal((await call("international/prepare", { clientMutationId: randomUUID(), expectedRevision: 3 })).value.error, "wordlist_mapping_unresolved");
  const invalid = await begin("workbook", { mappings: [{ group: "work1_1", pageIds: ["deleted-wrong-source"] }] }); assert.equal(invalid.response.status, 409); await assertPreserved();
  const omitted = lexicalFixture(); omitted.entries.pop(); rehashLexicon(omitted);
  assert.equal((await begin("workbook", { dataset: omitted })).response.value.error, "wordlist_omitted_entries_conflict");
  const changed = lexicalFixture(); changed.entries[0].english.word = "changed Word List only"; rehashLexicon(changed);
  const first = await begin("workbook", { dataset: changed }); const second = await begin("workbook", { dataset: changed });
  const races = await Promise.all([finalize(first, false), finalize(second, false)]);
  assert.deepEqual(races.map((result) => result.status).sort(), [200, 409]); await assertPreserved();
  const partial = await begin("workbook");
  const partialId = partial.response.value.sessionId;
  assert.equal((await call(`${partial.path}/upload/${partialId}`, null, { bytes: Buffer.alloc(wordListMp3.length), query: { sha256: wordListSha, clientMutationId: randomUUID() } })).status, 409);
  assert.equal((await call(`${partial.path.replace("international", "greek")}/finalize/${partialId}`, { clientMutationId: randomUUID() })).status, 409);
  assert.equal((await call(`${partial.path.replace("workbook", "students-book")}/finalize/${partialId}`, { clientMutationId: randomUUID() })).status, 409);
  assert.equal((await call(`${partial.path}/cancel/${partialId}`, { clientMutationId: randomUUID() })).status, 200);
  assert.equal((await finalize(partial, false)).status, 409);
  const savedBeforePartial = (await loadWordList(sql, target.reference.sourceId)).record;
  const alternateBytes = Buffer.from(wordListMp3); alternateBytes[416] = 1;
  const alternateSha = createHash("sha256").update(alternateBytes).digest("hex");
  const revisedAudio = structuredClone(changed); revisedAudio.entries[1].audioPath = `audio/${alternateSha}.mp3`;
  revisedAudio.audio.push({ path: revisedAudio.entries[1].audioPath, sha256: alternateSha, byteSize: alternateBytes.length, mediaType: "audio/mpeg" }); rehashLexicon(revisedAudio);
  const staged = await begin("workbook", { dataset: revisedAudio }); const stagedId = staged.response.value.sessionId;
  assert.equal((await finalize(staged, false)).value.error, "wordlist_audio_missing");
  assert.deepEqual((await loadWordList(sql, target.reference.sourceId)).record, savedBeforePartial);
  const otherActor = randomUUID(); const otherToken = randomBytes(32).toString("hex");
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Other actor','other-wordlists@example.test','unused')", [otherActor]);
  await pool.query("insert into builder_sessions(builder_user_id,token_hash,expires_at) values($1,$2,now()+interval '10 minutes')", [otherActor, hashBuilderToken(otherToken)]);
  assert.equal((await call(`${staged.path}/session/${stagedId}`, null, { cookie: otherToken })).status, 409);
  assert.equal((await call(`${staged.path}/begin`, staged.body, { cookie: otherToken })).value.error, "mutation_id_conflict");
  const uploadQuery = { sha256: alternateSha, clientMutationId: randomUUID() };
  assert.equal((await call(`${staged.path}/upload/${stagedId}`, null, { bytes: alternateBytes, query: uploadQuery })).status, 200);
  assert.equal((await call(`${staged.path}/upload/${stagedId}`, null, { bytes: alternateBytes, query: uploadQuery })).value.replayed, true);
  assert.equal((await finalize(staged, false)).status, 200);
  assert.equal((await finalize(await begin("workbook", { dataset: changed }), false)).status, 200);
  await assertPreserved();
  for (const edition of ["international", "greek"]) assert.deepEqual(await loadWordListEdition(sql, { bookSlug: "ultimate-b2", editionId: edition, releaseId: revisions[edition].id }), revisions[edition]);
  const user = (await pool.query("select * from app_users where email='student@editions.example.test'")).rows[0];
  const query = { contract: "edition-release.v2", bookSlug: "ultimate-b2", editionId: "greek", releaseId: revisions.greek.id, componentSlug: "ultimate-b2-workbook" };
  assert.equal((await readPublishedEdition(sql, user, query)).statusCode, 200);
  assert.equal((await readPublishedEdition(sql, user, { ...query, editionId: "international" })).statusCode, 403);
  const audio = await readPublishedEdition(sql, user, { ...query, audioSha256: wordListSha }, { storage: () => storage });
  assert.equal(audio.statusCode, 200); assert.deepEqual(Buffer.from(audio.body, "base64"), wordListMp3);
  assert.equal((await readPublishedEdition(sql, user, { ...query, audioSha256: "f".repeat(64) }, { storage: () => storage })).statusCode, 503);
  assert.equal((await readPublishedEdition(sql, user, { ...query, content: "1", teacherActivityId: "any" })).statusCode, 403);
  await assert.rejects(pool.query("update book_wordlist_audio set binding='{}'"), /immutable/);
  await assert.rejects(pool.query("delete from book_wordlist_edition_releases"), /immutable/);
  if (process.env.WORDLIST_BROWSER === "1") {
    const { exerciseWordListBrowser } = await import("./_wordlists-browser.mjs");
    await exerciseWordListBrowser({ sql, pool, actor, token, handler, storage });
  }
  await assertPreserved();
  if (process.env.WORDLIST_ACCEPTANCE_DIR) {
    const { exerciseFullWordListSource } = await import("./_wordlists-full-source.mjs");
    await exerciseFullWordListSource({ directory: process.env.WORDLIST_ACCEPTANCE_DIR, sql, call, sources, assertPreserved });
  }
  if (process.env.WORDLIST_CLASSROOM_BROWSER === "1") {
    const { exerciseWordListClassroomBrowser } = await import("./_wordlist-classroom-browser.mjs");
    await exerciseWordListClassroomBrowser({ sql, pool, actor, token, storage });
    await assertPreserved({ allowAddedSourceRevisions: true });
  }
  console.log("Word List PostgreSQL: imports/reimport/CAS/replay/ownership/readiness/projections/entitled audio and unchanged authored content passed.");
}
