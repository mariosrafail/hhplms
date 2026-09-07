import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import sharp from "sharp";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { taggedDatabase, seedUnificationActors, insertHistoricalStudentsRelease, syntheticPageStorage } from "./_students-book-unification-fixture.mjs";
import { createBuilderPagesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { createBuilderContentHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content.js";
import { createBuilderProductPublicationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";
import { createBuilderPublicationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication.js";
import { issueBuilderPreviewAuthorization } from "../../netlify-sites/ultimate-b2-builder/server/_builder-preview-authorization.js";
import { canonicalStudentsBookPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { createNativeOpenResponseQuestion } from "../../src/data/native-activities/nativeOpenResponse.js";
import { nativeChildIdFromUuid } from "../../src/data/native-activities/nativeChildIdentity.js";
import { studentsBookCurrentPageUnitsFromCatalog } from "../../src/apps/android-teacher-offline/studentsBookPageLifecycleProjection.js";
import { createAssignment, listAssignmentTargets, listAssignmentsForStudent } from "../../netlify/functions/_book-content/assignment-actions.js";
import { createHomework } from "../../netlify/functions/_book-content/homework-actions.js";
import { getStudentAssignmentDetail, listPublishedBooks } from "../../netlify/functions/_book-content/published-book-actions.js";
import { getAssignmentResults, submitActivity } from "../../netlify/functions/_book-content/submission-actions.js";
import { reviewSubmission } from "../../netlify/functions/_book-content/class-actions.js";
import { getPublishedPageImage } from "../../netlify/functions/_book-content/published-page-image.js";
import { getPublishedReleaseAsset } from "../../netlify/functions/_book-content/publication-actions.js";
import { publicationV2Fixture } from "../fixtures/publication-v2.js";
import pageAssets from "../../src/data/ultimate-b2/generated/students-book-page-assets.json" with { type: "json" };

const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
const scope = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
const route = (kind) => `/builder/api/${kind}/books/${scope.bookSlug}/components/${scope.componentSlug}`;
const success = (response, status = 200) => { assert.equal(response.statusCode, status, response.body); return JSON.parse(response.body); };

test("real Students Book upload/native/hotspot/publication/assignment flow preserves an R1 assignment across 060/061 and R2", { skip: !enabled, timeout: 180_000 }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname));
  const schema = `sb_flow_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 }); await admin.query(`create schema "${schema}"`);
  const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool, { through: "059_published_assignment_book_locators.sql" });
  const actors = await seedUnificationActors(pool); const { teacher, student, classId, builderCookie } = actors;
  const sql = taggedDatabase(pool);
  const historical = await insertHistoricalStudentsRelease(pool, actors);
  const r1Target = { kind: "published_native", releaseId: historical.id, nativeActivityId: publicationV2Fixture.openResponseId };
  const r1Assignment = success(await createAssignment(sql, { target: r1Target, classIds: [classId], idempotencyKey: randomUUID() }, teacher)).assignment;
  const r1Question = historical.compiled.publicProjection.nativeActivities[r1Target.nativeActivityId].document.parts[0].interaction.questions[0].id;
  success(await submitActivity(sql, { assignmentId: r1Assignment.id, target: r1Target, response: { schemaVersion: "native-response.v1", items: [{ id: r1Question, value: "R1 retained learner answer" }] } }, student));
  const r1Results = success(await getAssignmentResults(sql, r1Assignment.id));
  success(await reviewSubmission(sql, { submissionId: r1Results.rows[0].submissionId, scorePercent: 87, teacherFeedback: "R1 retained Teacher review" }, teacher));
  const r1Rows = (await pool.query("select to_jsonb(submission) value from activity_submissions submission where activity_assignment_id=$1", [r1Assignment.id])).rows;
  const originalPage = canonicalStudentsBookPages.find((page) => page.id === publicationV2Fixture.pageId);
  const originalBytes = await readFile(pageAssets.pages.find((page) => page.pageId === originalPage.id).repositoryPath);
  const oldImage = () => getPublishedPageImage(sql, { ...scope, releaseId: historical.id, pageId: originalPage.id, sha256: originalPage.image.checksumSha256 }, { assets: { fetch: async () => new Response(originalBytes, { headers: { "Content-Type": originalPage.image.mimeType } }) }, origin: "https://isolated.invalid" });
  assert.equal((await oldImage()).status, 200);
  await applyCanonicalProductionMigrations(pool);
  const { storage, objects, origin: storageOrigin } = await syntheticPageStorage(t);
  const pages = createBuilderPagesHandler({ getDatabase: () => sql, storage: () => storage });
  const native = createBuilderNativeActivitiesHandler({ getDatabase: () => sql });
  const content = createBuilderContentHandler({ getDatabase: () => sql });
  const product = createBuilderProductPublicationHandler({ getDatabase: () => sql, storage: () => storage });
  const event = (path, httpMethod = "GET", body) => ({ path, httpMethod, headers: { host: "builder.example", origin: "https://builder.example", cookie: builderCookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await pages({ ...event(route("pages")), headers: {} })).statusCode, 401);
  let catalog = success(await pages(event(route("pages"))));
  assert.equal(catalog.units.length, 10);
  const u3 = canonicalStudentsBookPages.find((page) => page.unitNumber === 3);
  // Disposable user-operation scenario, separate from the all-book preservation
  // set. Keep two canonical pages and add a managed Unit 10 page below.
  for (const page of catalog.pages.filter((entry) => ![originalPage.id, u3.id].includes(entry.id))) {
    catalog = success(await pages(event(`${route("pages")}/pages/${page.id}/delete`, "POST", { expectedRevision: catalog.revision, expectedHotspotRevision: catalog.hotspotRevision, clientMutationId: randomUUID(), metadata: {} })));
  }
  const upload = async ({ pageId = "", unitId, width, height, color, label, sortOrder }) => {
    const bytes = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
    const clientMutationId = randomUUID(); const expectedRevision = catalog.revision;
    const request = { mode: pageId ? "replace" : "create", pageId, expectedRevision, clientMutationId, metadata: { label, printedLabel: label, sortOrder, ...(unitId ? { unitId } : {}) }, file: { name: "synthetic.png", size: bytes.length, type: "image/png" } };
    const prepared = success(await pages(event(`${route("pages")}/assets/prepare`, "POST", request)));
    const put = await fetch(prepared.authorization.url, { method: "PUT", headers: prepared.authorization.headers, body: bytes }); assert.equal(put.status, 200);
    const finalize = { uploadId: prepared.uploadId, expectedRevision, clientMutationId };
    catalog = success(await pages(event(`${route("pages")}/assets/finalize`, "POST", finalize)));
    assert.equal(success(await pages(event(`${route("pages")}/assets/finalize`, "POST", finalize))).idempotent, true);
    assert.equal((await pages(event(`${route("pages")}/assets/prepare`, "POST", { ...request, clientMutationId: randomUUID() }))).statusCode, 409);
    catalog = success(await pages(event(`${route("pages")}/pages/${prepared.pageId}/metadata`, "POST", { expectedRevision: catalog.revision, clientMutationId: randomUUID(), metadata: { label, printedLabel: label, sortOrder, ...(unitId ? { unitId } : {}) } })));
    const reloadedPage = success(await pages(event(route("pages")))).pages.find((page) => page.id === prepared.pageId);
    assert.equal(reloadedPage.label, label); assert.equal(reloadedPage.sortOrder, sortOrder);
    return { pageId: prepared.pageId, bytes };
  };
  const replaced = await upload({ pageId: originalPage.id, width: originalPage.image.width, height: originalPage.image.height, color: "green", label: "R2 replacement", sortOrder: 1 });
  await upload({ pageId: u3.id, width: u3.image.width, height: u3.image.height, color: "blue", label: "R2 canonical Unit 3", sortOrder: 3 });
  const managed = await upload({ unitId: catalog.units.find((unit) => unit.unitNumber === 10).id, width: 480, height: 640, color: "orange", label: "R2 managed Unit 10", sortOrder: 10 });
  const hotspots = { schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug: "students-book", pages: {} };
  const newActivities = [];
  for (const [pageId, unitNumber] of [[u3.id, 3], [managed.pageId, 10]]) {
    const created = success(await native(event(`${route("native-activities")}/create`, "POST", { kind: "open-response", pageId, title: `R2 Unit ${unitNumber} exercise`, clientMutationId: randomUUID() })));
    const publicState = success(await content(event(`${route("content")}/native-activity-public/${created.activityId}`)));
    const teacherState = success(await content(event(`${route("content")}/native-activity-teacher/${created.activityId}`)));
    const publicDocument = publicState.document; const teacherDocument = teacherState.document;
    const questionId = nativeChildIdFromUuid("q", randomUUID());
    publicDocument.metadata.visibleInstructionText = "Explain your answer.";
    publicDocument.parts[0].interaction.questions = [{ ...createNativeOpenResponseQuestion(questionId), prompt: `R2 Unit ${unitNumber} prompt` }];
    teacherDocument.parts[0].solution.modelAnswers = [{ questionId, text: `R2 Unit ${unitNumber} protected model` }];
    const save = { expectedPublicRevision: publicState.revision, expectedTeacherRevision: teacherState.revision, publicDocument, teacherDocument, clientMutationId: randomUUID() };
    success(await native(event(`${route("native-activities")}/activities/${created.activityId}/save`, "POST", save)));
    assert.equal((await native(event(`${route("native-activities")}/activities/${created.activityId}/save`, "POST", { ...save, clientMutationId: randomUUID() }))).statusCode, 409);
    hotspots.pages[pageId] = [{ id: `hotspot-unit-${unitNumber}`, pageId, unitNumber, left: 4.123456789, top: 8.987654321, width: 30, height: 20, label: `Exercise ${unitNumber}`, actionType: "normalized_activity", activityKey: created.activityId }];
    newActivities.push({ id: created.activityId, questionId, pageId, unitNumber });
  }
  success(await content(event(`${route("content")}/hotspots`, "PUT", { document: hotspots, expectedRevision: catalog.hotspotRevision, clientMutationId: randomUUID() })));
  assert.deepEqual(success(await content(event(`${route("content")}/hotspots`))).document, hotspots);
  const authorization = issueBuilderPreviewAuthorization({ ...scope, view: "library", pageId: null, activityId: null, releaseId: null }, { environment: { BUILDER_PREVIEW_AUTH_SECRET: "local-synthetic-preview-secret-1234567890" } }).token;
  const draft = studentsBookCurrentPageUnitsFromCatalog(success(await pages({ ...event(route("pages").replace("/api/", "/preview/")), queryStringParameters: { previewAuthorization: authorization } })), authorization);
  assert(draft.find((unit) => unit.number === 10).pages.some((page) => page.id === managed.pageId));
  assert.equal(draft.flatMap((unit) => unit.pages).length, 3);
  const prepared = success(await product(event("/builder/api/publication/books/ultimate-b2/prepare", "POST", { clientMutationId: randomUUID(), releaseNote: "R2 isolated unification acceptance" })));
  success(await product(event("/builder/api/publication/books/ultimate-b2/publish", "POST", { productReleaseId: prepared.productReleaseId, expectedHeadRevision: 0, clientMutationId: randomUUID() })));
  const books = success(await listPublishedBooks(sql, teacher)).books;
  const book = books.find((entry) => entry.componentSlug === scope.componentSlug);
  assert.equal(book.pages.length, 3); assert.equal(book.activities.length, 2);
  assert.equal(book.productReleaseId, prepared.productReleaseId);
  const targets = await listAssignmentTargets(sql, teacher);
  assert(newActivities.every((activity) => targets.some((target) => target.target.nativeActivityId === activity.id && target.assignable)));
  const target = book.activities.find((entry) => entry.target.nativeActivityId === newActivities[1].id).target;
  const assignment = success(await createAssignment(sql, { target, classIds: [classId], idempotencyKey: randomUUID() }, teacher)).assignment;
  success(await createHomework(sql, { title: "R2 unified Homework", classIds: [classId], items: book.activities.map((entry) => entry.target), idempotencyKey: randomUUID() }, teacher), 201);
  const detail = success(await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id }));
  assert.doesNotMatch(JSON.stringify(detail), /protected model|modelAnswers/);
  success(await submitActivity(sql, { assignmentId: assignment.id, target, response: { schemaVersion: "native-response.v1", items: [{ id: newActivities[1].questionId, value: "R2 managed page answer" }] } }, student));
  const results = success(await getAssignmentResults(sql, assignment.id));
  assert.equal(results.rows[0].answerDetails[0].modelAnswer, "R2 Unit 10 protected model");
  success(await reviewSubmission(sql, { submissionId: results.rows[0].submissionId, scorePercent: 91, teacherFeedback: "R2 reviewed" }, teacher));
  const reloaded = await listAssignmentsForStudent(sql, student.id, student);
  assert.equal(reloaded.find((entry) => entry.id === assignment.id).scorePercent, 91);
  assert.equal(reloaded.find((entry) => entry.id === r1Assignment.id).scorePercent, 87);
  assert.deepEqual((await pool.query("select to_jsonb(submission) value from activity_submissions submission where activity_assignment_id=$1", [r1Assignment.id])).rows, r1Rows);
  const oldResponse = await oldImage(); assert.equal(oldResponse.status, 200); assert.deepEqual(Buffer.from(await oldResponse.arrayBuffer()), originalBytes);
  for (const uploaded of [replaced, managed]) {
    const image = book.pages.find((page) => page.id === uploaded.pageId).image;
    const response = await getPublishedReleaseAsset(sql, { ...scope, releaseId: book.releaseId, sha256: image.sha256, extension: image.extension }, { storage });
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), uploaded.bytes);
  }
  const review = createBuilderPublicationHandler({ getDatabase: () => sql, storage: () => storage });
  const managedImage = book.pages.find((page) => page.id === managed.pageId).image;
  const reviewPath = `/builder/preview/releases/books/${scope.bookSlug}/components/${scope.componentSlug}/${book.releaseId}/assets/${managedImage.sha256}.${managedImage.extension}`;
  const binding = {
    async get(key) { const object = await storage.head({ objectKey: key }); return { size: object.byteSize, body: new Response(object.bytes).body, customMetadata: { sha256: object.checksumSha256 }, httpMetadata: { contentType: object.contentType } }; },
    async head(key) { const object = await storage.head({ objectKey: key }); return { size: object.byteSize, customMetadata: { sha256: object.checksumSha256 }, httpMetadata: { contentType: object.contentType } }; },
  };
  const reviewContext = { cloudflare: { releaseSourceAssets: binding, releaseSourceAssetsBucket: "synthetic-private", request: new Request("https://builder.example/preview") } };
  const preview = await review(event(reviewPath), reviewContext);
  assert.equal(preview.status, 200); assert.deepEqual(Buffer.from(await preview.arrayBuffer()), managed.bytes);
  assert.equal((await review({ ...event(reviewPath), headers: {} }, reviewContext)).statusCode, 401);
  const assetQuery = { ...scope, releaseId: book.releaseId, sha256: managedImage.sha256, extension: managedImage.extension };
  const ranged = await getPublishedReleaseAsset(sql, assetQuery, { storage, range: "bytes=0-7" });
  assert.equal(ranged.status, 206); assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), managed.bytes.subarray(0, 8));
  const object = [...objects.values()].find((entry) => entry.checksumSha256 === managedImage.sha256);
  const unchangedBytes = Buffer.from(object.bytes);
  object.bytes[25] ^= 1;
  assert.equal((await getPublishedReleaseAsset(sql, assetQuery, { storage })).statusCode, 409, "Matching metadata cannot conceal corrupted image bytes");
  assert.equal((await review(event(reviewPath), reviewContext)).status, 409);
  object.bytes = unchangedBytes;
  assert(objects.size >= 3);
  if (process.env.PUBLISHED_BOOK_BROWSER === "1") {
    const { verifyUnifiedStudentsBookBrowser } = await import("./_students-book-unification-browser.mjs");
    await verifyUnifiedStudentsBookBrowser({ pool, sql, actors, book, storageOrigin, r1Assignment, historical, originalBytes });
  }
});
