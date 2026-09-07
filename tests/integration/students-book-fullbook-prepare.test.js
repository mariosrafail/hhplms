import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { currentExtrasFixture, extrasScope, extrasRoute, responseJson } from "./_students-book-current-extras-fixture.mjs";
import { fullbookStorage } from "./_students-book-fullbook-storage.mjs";
import { createBuilderProductPublicationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";
import { materializeCanonicalReleaseAssets } from "../../netlify-sites/ultimate-b2-builder/server/_builder-canonical-release-assets.js";
import { freezeComponentPublicationAssetPins } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js";
import { createProductRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-store.js";
import { collectStudentsBookPublicationV3Sources } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-sources-v3.js";
import { compileStudentsBookReleaseV3 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { createAssignment } from "../../netlify/functions/_book-content/assignment-actions.js";
import { getStudentAssignmentDetail } from "../../netlify/functions/_book-content/published-book-actions.js";
import { getPublishedReleaseAsset } from "../../netlify/functions/_book-content/publication-actions.js";
import manifest from "../../src/data/ultimate-b2/generated/students-book-page-assets.json" with { type: "json" };

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
test("full-book real Prepare: 110 tracked images, cold/reuse/races/failures/freshness and immutable R1 assignment", { skip: !enabled }, async (t) => {
  const f = await currentExtrasFixture(t);
  const u3 = (await f.catalog()).pages.find((page) => page.unitNumber === 3);
  const activityId = await f.addNative(u3.id, 3);
  await f.attach(3, "videos"); await f.attach(3, "audios");
  const teacherUi = await f.seedTeacherUi();
  const extras = await f.read(); extras.document.pages.push({ pageId: u3.id, unitId: "unit-3", extrasVisibility: { videos: true, audios: true } }); responseJson(await f.save(extras.document, extras.revision));
  const tracked = new Set(execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0"));
  for (const page of manifest.pages) assert(tracked.has(page.repositoryPath));
  assert.equal(manifest.pages.length, 110);
  const unique = new Set(manifest.pages.map((page) => page.checksumSha256)); assert.equal(unique.size, 110);
  const totalBytes = manifest.pages.reduce((sum, page) => sum + page.byteSize, 0);
  const originalFetch = globalThis.fetch; let outbound = 0; let localUploadFetches = 0;
  globalThis.fetch = async (...args) => { if (new URL(args[0]).origin === f.origin) { localUploadFetches++; return originalFetch(...args); } outbound++; throw new Error("No external fetch is permitted during isolated full-book Prepare"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const results = []; let phase = {}; let queries = 0; let prepareStarted = 0;
  const measuredSql = async (strings, ...values) => { queries++; return f.sql(strings, ...values); };
  const timed = (name, fn) => async (...args) => { const start = performance.now(); try { return await fn(...args); } finally { phase[name] = (phase[name] || 0) + performance.now() - start; } };
  const storage = await fullbookStorage(t, f.storage);
  const handlerFor = (destination) => createBuilderProductPublicationHandler({ getDatabase: () => measuredSql, storage: () => destination.storage, canonicalFetch: () => destination.fetchAsset,
    materializeCanonical: async (...args) => { phase.beforeMaterializationMs = performance.now() - prepareStarted; return timed("materializationMs", materializeCanonicalReleaseAssets)(...args); }, freezePins: timed("pinVerificationMs", freezeComponentPublicationAssetPins), create: timed("sqlCreateMs", createProductRelease),
  });
  const product = handlerFor(storage);
  const authored = () => f.pool.query("select to_jsonb(document) value from builder_component_documents document order by id").then((value) => value.rows);
  const protectedRows = await authored();
  const prepare = async (name, clientMutationId = randomUUID(), options = {}) => {
    storage.reset(options); queries = 0; phase = {};
    const start = performance.now(); prepareStarted = start; const cpu = process.cpuUsage();
    const response = await product(f.event("/builder/api/publication/books/ultimate-b2/prepare", "POST", { releaseNote: "Full-book synthetic acceptance", clientMutationId }));
    results.push({ name, status: response.statusCode, ...storage.counts, sqlStatements: queries, sqlTransactionBoundary: "one implicit transaction per SQL statement, including create_product release function; storage runs before its SQL statement", phase: { ...phase }, wallMs: performance.now() - start, cpuMicroseconds: process.cpuUsage(cpu), maxRssKiB: process.resourceUsage().maxRSS });
    return response;
  };
  assert.equal(storage.metadata.size, 0);
  const mutation = randomUUID(); const cold = responseJson(await prepare("cold", mutation));
  assert.equal(storage.metadata.size, 110);
  assert.deepEqual({ ...storage.counts }, { put: 110, head: 220, get: 110, assetsFetch: 110, readbackBytes: totalBytes, writes: 110, externalFetches: 0 });
  const compiled = compileStudentsBookReleaseV3(await collectStudentsBookPublicationV3Sources(f.sql));
  assert.equal(compiled.publicProjection.pages.length, 110); assert.equal(Object.keys(compiled.publicProjection.nativeActivities).length, 1);
  assert.equal(compiled.reconciliation.filter((entry) => entry.included).length, 1);
  assert.equal(compiled.nativeAssetSources.length, 2);
  assert.equal(compiled.assetManifest.filter((asset) => asset.role === "teacher_ui").length, 1);
  assert.equal(Object.values(compiled.teacherProjection.ui.assets)[0].sha256, teacherUi.sha256);
  assert.equal(compiled.publicProjection.assets.some((asset) => asset.role === "teacher_ui"), false);
  assert.equal(responseJson(await prepare("same-mutation", mutation)).productReleaseId, cold.productReleaseId);
  assert.equal(storage.counts.writes, 0);
  responseJson(await prepare("new-mutation-reuse")); assert.equal(storage.counts.writes, 0);
  const racingStorage = await fullbookStorage(t, f.storage);
  const racingProduct = handlerFor(racingStorage);
  const raceStart = performance.now(); const raceCpu = process.cpuUsage(); queries = 0;
  const race = await Promise.all([1, 2].map(() => racingProduct(f.event("/builder/api/publication/books/ultimate-b2/prepare", "POST", { releaseNote: "Concurrent cold namespace", clientMutationId: randomUUID() }))));
  race.forEach((response) => responseJson(response));
  assert.equal(racingStorage.metadata.size, 110); assert.equal(racingStorage.counts.writes, 110); assert.equal(racingStorage.counts.put, 220);
  assert.notEqual(JSON.parse(race[0].body).productReleaseId, JSON.parse(race[1].body).productReleaseId);
  results.push({ name: "two-concurrent-cold-prepare-aggregate", ...racingStorage.counts, sqlStatements: queries, wallMs: performance.now() - raceStart, cpuMicroseconds: process.cpuUsage(raceCpu), maxRssKiB: process.resourceUsage().maxRSS });
  const publish = (release, expectedHeadRevision) => product(f.event("/builder/api/publication/books/ultimate-b2/publish", "POST", { productReleaseId: release.productReleaseId, expectedHeadRevision, clientMutationId: randomUUID() }));
  assert.equal((await f.pool.query("select count(*)::int count from book_product_publication_events")).rows[0].count, 0);
  responseJson(await publish(cold, 0));
  const member = cold.release.members.find((entry) => entry.componentSlug === extrasScope.componentSlug);
  const assignment = responseJson(await createAssignment(f.sql, { target: { kind: "published_native", releaseId: member.componentReleaseId, nativeActivityId: activityId }, classIds: [f.actors.classId], idempotencyKey: randomUUID() }, f.actors.teacher)).assignment;
  const detail = responseJson(await getStudentAssignmentDetail(f.sql, f.actors.student, { assignmentId: assignment.id }));
  const head = () => f.pool.query("select to_jsonb(head) value from book_product_publication_heads head order by book_package_id").then((value) => value.rows);
  const oldHead = await head();
  const releaseCount = () => f.pool.query("select count(*)::int count from book_product_releases").then((value) => value.rows[0].count);
  for (const failure of [1, 55, 110]) {
    const failedStorage = await fullbookStorage(t, f.storage); failedStorage.reset({ failure });
    const failedProduct = handlerFor(failedStorage);
    const mutationId = randomUUID();
    const failureEvent = f.event("/builder/api/publication/books/ultimate-b2/prepare", "POST", { releaseNote: "Cold failure/retry", clientMutationId: mutationId });
    const count = await releaseCount(); responseJson(await failedProduct(failureEvent), 409);
    assert.equal(failedStorage.metadata.size, failure - 1);
    results.push({ name: `cold-failure-${failure}`, ...failedStorage.counts, retainedObjects: failedStorage.metadata.size });
    assert.equal(await releaseCount(), count); assert.deepEqual(await head(), oldHead);
    failedStorage.reset(); responseJson(await failedProduct(failureEvent));
    assert.equal(failedStorage.metadata.size, 110); assert.equal(failedStorage.counts.writes, 111 - failure);
    results.push({ name: `safe-retry-${failure}`, ...failedStorage.counts, retainedObjects: failedStorage.metadata.size });
  }
  const [corruptKey, correctMetadata] = [...racingStorage.metadata][0];
  const correctBytes = await readFile(racingStorage.file(corruptKey));
  const badBytes = Buffer.from(correctBytes); badBytes[30] ^= 1;
  for (const [name, bytes, metadata] of [
    ["wrong-bytes-correct-metadata", badBytes, correctMetadata],
    ["wrong-sha-metadata", correctBytes, { ...correctMetadata, customMetadata: { sha256: "f".repeat(64) } }],
    ["wrong-size-metadata", correctBytes, { ...correctMetadata, size: correctMetadata.size + 1 }],
  ]) {
    await writeFile(racingStorage.file(corruptKey), bytes); racingStorage.metadata.set(corruptKey, metadata);
    const count = await releaseCount(); racingStorage.reset();
    responseJson(await racingProduct(f.event("/builder/api/publication/books/ultimate-b2/prepare", "POST", { releaseNote: "Corrupt object", clientMutationId: randomUUID() })), 409);
    assert.equal(await releaseCount(), count); assert.deepEqual(await head(), oldHead);
    assert.deepEqual(await readFile(racingStorage.file(corruptKey)), bytes);
    results.push({ name, ...racingStorage.counts, outcome: "rejected-without-overwrite-or-candidate" });
  }
  assert.deepEqual(await authored(), protectedRows);
  for (const kind of ["extras", "page", "source"]) {
    let changed = false;
    const stale = responseJson(await prepare(`save-${kind}-during-prepare`, randomUUID(), { duringFetch: async () => {
      if (changed) return; changed = true;
      if (kind === "extras") { const state = await f.read(); state.document.pages[0].extrasVisibility.audios = !state.document.pages[0].extrasVisibility.audios; responseJson(await f.save(state.document, state.revision)); }
      else if (kind === "page") { const catalog = await f.catalog(); responseJson(await f.pages(f.event(`${extrasRoute("pages")}/pages/${u3.id}/metadata`, "POST", { expectedRevision: catalog.revision, clientMutationId: randomUUID(), metadata: { label: "Synthetic metadata R2", printedLabel: "3", sortOrder: u3.sortOrder } }))); }
      else { const state = responseJson(await f.content(f.event(`${extrasRoute("content")}/hotspots`))); state.document.pages[u3.id][0].label = "Synthetic changed label"; responseJson(await f.content(f.event(`${extrasRoute("content")}/hotspots`, "PUT", { expectedRevision: state.revision, clientMutationId: randomUUID(), document: state.document }))); }
    } }));
    const result = responseJson(await publish(stale, 1), 409); assert.equal(result.error, "stale_release_preview"); assert.deepEqual(await head(), oldHead);
  }
  await f.addManaged(); await f.addManaged({ replacePageId: u3.id });
  const mixed = compileStudentsBookReleaseV3(await collectStudentsBookPublicationV3Sources(f.sql));
  assert.equal(mixed.canonicalAssetSources.length, 109); assert.equal(mixed.publicProjection.pages.length, 111);
  const r2 = responseJson(await prepare("R2-mixed-managed-and-replacement")); responseJson(await publish(r2, 1));
  assert.deepEqual(responseJson(await getStudentAssignmentDetail(f.sql, f.actors.student, { assignmentId: assignment.id })), detail);
  const image = await getPublishedReleaseAsset(f.sql, { ...extrasScope, releaseId: member.componentReleaseId, extension: "png", sha256: u3.image.checksumSha256 }, { storage: storage.storage });
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), await readFile(manifest.pages.find((page) => page.pageId === u3.id).repositoryPath));
  assert.equal((await f.pool.query("select count(*)::int count from book_product_publication_events")).rows[0].count, 2);
  assert.equal(outbound, 0);
  const report = { externalFetchAttempts: outbound, localSyntheticUploadFetches: localUploadFetches, runtime: process.version, database: "isolated PostgreSQL, actual SQL/handlers/compiler/verification", canonicalPages: 110, uniqueCanonicalImages: unique.size, totalBytes, nativeActivities: 1, syntheticMedia: 2, syntheticTeacherUiAssets: 1, nativePins: 2, productMembers: cold.release.members.length, peakMemoryMethod: "process.resourceUsage().maxRSS; process lifetime peak, includes test setup; not isolate memory", cpuMethod: "process.cpuUsage delta; Node process only, excludes PostgreSQL", results };
  if (process.env.SB_FULLBOOK_NODE_METRICS_PATH) await writeFile(process.env.SB_FULLBOOK_NODE_METRICS_PATH, JSON.stringify(report, null, 2));
  t.diagnostic(JSON.stringify(report));
});
