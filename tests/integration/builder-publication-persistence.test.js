import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compileUltimateB2ComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { collectUltimateB2PublicationSources, collectUltimateB2PublicationV2Sources, createComponentRelease, publishComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-store.js";
import { resolveBuilderContentResource } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { saveBuilderComponentDocument } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-store.js";
import { ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION } from "../../src/data/ultimate-b2/componentPublication.js";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { createPublicationV2FixtureSources, publicationV2Fixture } from "../fixtures/publication-v2.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
const actor = "10000000-0000-4000-8000-000000000001";

function scoped(base, schema) { const url = new URL(base); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); }
function tag(pool) { return async (strings, ...values) => { let text = strings[0]; for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1]}`; return (await pool.query(text, values)).rows; }; }
function releaseInput(compiled, mutationId = randomUUID(), requestSha256 = compiled.releaseSha256) { return { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseSchemaVersion: compiled.releaseSchemaVersion || ULTIMATE_B2_COMPONENT_RELEASE_SCHEMA_VERSION, ...compiled, requestSha256, releaseNote: "", clientMutationId: mutationId, builderUserId: actor }; }

test("isolated PostgreSQL preserves immutable release history and stale-safe atomic heads", { skip: !enabled }, async (t) => {
  const schema = `builder_publication_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const pool = new Pool({ connectionString: scoped(databaseUrl, schema), max: 4 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); });
  const migrations = await applyCanonicalProductionMigrations(pool);
  assert.ok(migrations.some(({ filename }) => filename === "035_builder_component_publication.sql"));
  await pool.query(`insert into builder_users(id,full_name,email,password_hash) values($1,'Publication Integration','publication@example.test','not-a-real-login-hash')`, [actor]);
  const sql = tag(pool);

  const baseline = compileUltimateB2ComponentRelease(await collectUltimateB2PublicationSources(sql));
  const mutation = randomUUID();
  const created1 = await createComponentRelease(sql, releaseInput(baseline, mutation));
  assert.equal(created1.outcome, "created");
  assert.equal(created1.releaseNumber, 1);
  assert.equal((await createComponentRelease(sql, releaseInput(baseline, mutation))).outcome, "idempotent");
  assert.equal((await createComponentRelease(sql, releaseInput(baseline, mutation, "f".repeat(64)))).outcome, "mutation_id_conflict");
  await assert.rejects(pool.query(`update book_component_releases set public_projection='{}'::jsonb where id=$1`, [created1.releaseId]), /immutable/);
  await assert.rejects(pool.query(`delete from book_component_releases where id=$1`, [created1.releaseId]), /immutable/);

  const published1 = await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: created1.releaseId, expectedHeadRevision: 0, requestSha256: "a".repeat(64), builderUserId: actor, clientMutationId: randomUUID() });
  assert.equal(published1.outcome, "published");
  assert.equal(published1.headRevision, 1);
  const staleCandidate = await createComponentRelease(sql, releaseInput(baseline));

  const hotspotResource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "hotspots");
  // Frozen v1 compiler input, never the mutable current-authoring baseline.
  const changed = structuredClone(baseline.publicProjection.hotspots);
  const pageId = Object.keys(changed.pages)[0];
  changed.pages[pageId][0].label = "Unpublished hotspot change";
  assert.equal((await saveBuilderComponentDocument(sql, { resource: hotspotResource, expectedRevision: 0, clientMutationId: randomUUID(), document: changed, payloadSha256: builderDocumentSha256(changed), builderUserId: actor })).outcome, "saved");
  const stale = await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: staleCandidate.releaseId, expectedHeadRevision: 1, requestSha256: "b".repeat(64), builderUserId: actor, clientMutationId: randomUUID() });
  assert.equal(stale.outcome, "stale_release_preview");

  const current = compileUltimateB2ComponentRelease(await collectUltimateB2PublicationSources(sql));
  const created2 = await createComponentRelease(sql, releaseInput(current));
  assert.equal(created2.releaseNumber, 3);
  const published2 = await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: created2.releaseId, expectedHeadRevision: 1, requestSha256: "c".repeat(64), builderUserId: actor, clientMutationId: randomUUID() });
  assert.equal(published2.outcome, "published");
  assert.equal(published2.previousReleaseId, created1.releaseId);
  const created3 = await createComponentRelease(sql, releaseInput(current));
  const created4 = await createComponentRelease(sql, releaseInput(current));
  const mutation3 = randomUUID(); const mutation4 = randomUUID();
  const attempts = await Promise.all([
    publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: created3.releaseId, expectedHeadRevision: 2, requestSha256: "d".repeat(64), builderUserId: actor, clientMutationId: mutation3 }),
    publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: created4.releaseId, expectedHeadRevision: 2, requestSha256: "e".repeat(64), builderUserId: actor, clientMutationId: mutation4 }),
  ]);
  assert.deepEqual(attempts.map((item) => item.outcome).sort(), ["head_conflict", "published"]);
  const winner = attempts.find((item) => item.outcome === "published");
  const winnerMutation = winner.releaseId === created3.releaseId ? mutation3 : mutation4;
  const winnerRequest = winner.releaseId === created3.releaseId ? "d".repeat(64) : "e".repeat(64);
  assert.equal((await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: winner.releaseId, expectedHeadRevision: 2, requestSha256: winnerRequest, builderUserId: actor, clientMutationId: winnerMutation })).outcome, "idempotent");
  const otherReleaseId = winner.releaseId === created3.releaseId ? created4.releaseId : created3.releaseId;
  assert.equal((await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: otherReleaseId, expectedHeadRevision: 2, requestSha256: winnerRequest, builderUserId: actor, clientMutationId: winnerMutation })).outcome, "mutation_id_conflict");
  const alreadyActive = await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: winner.releaseId, expectedHeadRevision: 3, requestSha256: "9".repeat(64), builderUserId: actor, clientMutationId: randomUUID() });
  assert.equal(alreadyActive.outcome, "already_active");
  assert.equal(alreadyActive.headRevision, 3);
  const state = await pool.query(`select (select count(*)::int from book_component_releases) releases,(select count(*)::int from book_component_publication_heads) heads,(select count(*)::int from book_component_publication_events) events,(select count(*)::int from book_component_publication_mutations) mutations,(select release_id from book_component_publication_heads limit 1) active`);
  assert.deepEqual(state.rows[0], { releases: 5, heads: 1, events: 3, mutations: 4, active: winner.releaseId });

  const raceCompiled = compileUltimateB2ComponentRelease(await collectUltimateB2PublicationSources(sql));
  const raceCandidate = await createComponentRelease(sql, releaseInput(raceCompiled));
  const changedAgain = structuredClone(changed);
  changedAgain.pages[pageId][0].label = "Concurrent unpublished hotspot change";
  const [raceSave, racePublish] = await Promise.all([
    saveBuilderComponentDocument(sql, { resource: hotspotResource, expectedRevision: 1, clientMutationId: randomUUID(), document: changedAgain, payloadSha256: builderDocumentSha256(changedAgain), builderUserId: actor }),
    publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: raceCandidate.releaseId, expectedHeadRevision: 3, requestSha256: "8".repeat(64), builderUserId: actor, clientMutationId: randomUUID() }),
  ]);
  assert.equal(raceSave.outcome, "saved");
  assert.ok(["published", "stale_release_preview"].includes(racePublish.outcome));
  const raceState = await pool.query(`select release_id,head_revision from book_component_publication_heads limit 1`);
  assert.equal(raceState.rows[0].release_id, racePublish.outcome === "published" ? raceCandidate.releaseId : winner.releaseId);
  assert.equal(Number(raceState.rows[0].head_revision), racePublish.outcome === "published" ? 4 : 3);
  assert.notEqual((await collectUltimateB2PublicationSources(sql)).documents.hotspots.sha256, raceCompiled.sourceSnapshot.hotspots.sha256);
  const preserved = await pool.query(`select public_projection_sha256 from book_component_releases where id=$1`, [raceCandidate.releaseId]);
  assert.equal(preserved.rows[0].public_projection_sha256, raceCompiled.publicProjectionSha256);
  const audits = await pool.query(`select action from builder_audit_log where action in ('preview_release_created','release_published') order by id`);
  assert.deepEqual(audits.rows.map((row) => row.action), ["preview_release_created", "release_published", "preview_release_created", "preview_release_created", "release_published", "preview_release_created", "preview_release_created", "release_published", "preview_release_created", ...(racePublish.outcome === "published" ? ["release_published"] : [])]);
});

test("migration 039 enforces exact v2 native/legacy freshness and serializes native save versus publish", { skip: !enabled }, async (t) => {
  const schema = `builder_publication_v2_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const pool = new Pool({ connectionString: scoped(databaseUrl, schema), max: 4 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); });
  const migrations = await applyCanonicalProductionMigrations(pool);
  assert.ok(migrations.some(({ filename }) => filename === "039_builder_component_publication_v2.sql"));
  await pool.query(`insert into builder_users(id,full_name,email,password_hash) values($1,'Publication v2 Integration','publication-v2@example.test','not-a-real-login-hash')`, [actor]);
  const sql = tag(pool);
  const sources = createPublicationV2FixtureSources();
  const unpersistedFixtureNativeActivityIds = new Set(
    Object.keys(sources.native.activities).filter((activityId) => activityId !== publicationV2Fixture.openResponseId),
  );
  sources.documents.hotspots.payload.pages[publicationV2Fixture.pageId] = sources.documents.hotspots.payload.pages[publicationV2Fixture.pageId]
    .filter((hotspot) => !unpersistedFixtureNativeActivityIds.has(hotspot.activityKey));

  const resources = {
    hotspots: await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "hotspots"),
    index: await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "native-activity-index"),
    public: await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "native-activity-public", publicationV2Fixture.openResponseId),
    teacher: await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "native-activity-teacher", publicationV2Fixture.openResponseId),
    legacy: await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "open-response", "ultimate-b2-sb-u1-p1-o1"),
  };
  const revisions = { hotspots: 0, index: 0, public: 0, teacher: 0, legacy: 0 };
  const save = async (key, document) => {
    const result = await saveBuilderComponentDocument(sql, { resource: resources[key], expectedRevision: revisions[key], clientMutationId: randomUUID(), document, payloadSha256: builderDocumentSha256(document), builderUserId: actor });
    assert.equal(result.outcome, "saved");
    revisions[key] = result.revision;
    return result;
  };
  await save("index", sources.native.index.payload);
  await save("public", sources.native.activities[publicationV2Fixture.openResponseId].public.payload);
  await save("teacher", sources.native.activities[publicationV2Fixture.openResponseId].teacher.payload);
  await save("hotspots", sources.documents.hotspots.payload);
  await save("legacy", resources.legacy.baseline());

  const prepare = async () => createComponentRelease(sql, releaseInput(compileUltimateB2ComponentReleaseV2(await collectUltimateB2PublicationV2Sources(sql))));
  const current = async (releaseId) => (await pool.query("select builder_release_sources_are_current($1) current", [releaseId])).rows[0].current;
  const staleAfter = async (key, document) => {
    const candidate = await prepare();
    assert.equal(await current(candidate.releaseId), true);
    await save(key, document);
    assert.equal(await current(candidate.releaseId), false);
    const outcome = await publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: candidate.releaseId, expectedHeadRevision: 0, requestSha256: randomBytes(32).toString("hex"), builderUserId: actor, clientMutationId: randomUUID() });
    assert.equal(outcome.outcome, "stale_release_preview");
  };

  const publicDocument = structuredClone(sources.native.activities[publicationV2Fixture.openResponseId].public.payload);
  publicDocument.metadata.title = "Changed native public";
  await staleAfter("public", publicDocument);
  const teacherDocument = structuredClone(sources.native.activities[publicationV2Fixture.openResponseId].teacher.payload);
  teacherDocument.parts[0].solution.modelAnswers[0].text = "Changed private answer";
  await staleAfter("teacher", teacherDocument);
  await staleAfter("index", sources.native.index.payload);
  await staleAfter("hotspots", sources.documents.hotspots.payload);
  await staleAfter("legacy", resources.legacy.baseline());

  const raceCandidate = await prepare();
  assert.equal(await current(raceCandidate.releaseId), true);
  const racePublic = structuredClone(publicDocument);
  racePublic.metadata.title = "Concurrent native public save";
  const [raceSave, racePublish] = await Promise.all([
    save("public", racePublic),
    publishComponentRelease(sql, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", releaseId: raceCandidate.releaseId, expectedHeadRevision: 0, requestSha256: randomBytes(32).toString("hex"), builderUserId: actor, clientMutationId: randomUUID() }),
  ]);
  assert.equal(raceSave.outcome, "saved");
  assert.ok(["published", "stale_release_preview"].includes(racePublish.outcome));
  const immutable = (await pool.query("select source_snapshot from book_component_releases where id=$1", [raceCandidate.releaseId])).rows[0].source_snapshot;
  assert.notEqual(immutable.nativeActivities[publicationV2Fixture.openResponseId].public.revision, revisions.public);
  assert.equal(await current(raceCandidate.releaseId), false);
});
