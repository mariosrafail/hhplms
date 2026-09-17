import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { nativeMarkerCandidate, markerId } from "../fixtures/native-marker-candidate.js";
import { compilePair } from "./_ten-option-choice-persistence.mjs";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { prepareBuilderNativeAssetUpload, claimBuilderNativeAssetUpload, completeBuilderNativeAssetUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { createAssignment } from "../../netlify/functions/_book-content/assignment-actions.js";
import { getStudentAssignmentDetail } from "../../netlify/functions/_book-content/published-book-actions.js";
import { handler as bookContent } from "../../netlify/functions/book-content.js";
import { setSqlForTests, hashToken, sessionCookieName } from "../../netlify/functions/_auth-utils.js";
import { restoreNativeSubmissionResponses } from "../../src/components/lms/student/runtime/studentSubmissionContract.js";

export async function exerciseNativeMarkerPersistence({ pool, sql, scope, builderId, teacher, student, classId, insertRelease, publishRelease }) {
 const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
 const event = (suffix, body) => ({ httpMethod: "POST", path: `/builder/api/native-activities/books/${identity.bookSlug}/components/${identity.componentSlug}/${suffix}`, headers: { host: "localhost:8888", origin: "http://localhost:8888", "content-type": "application/json" }, body: JSON.stringify(body) });
 const builder = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: builderId } }), logger: { error() {}, warn() {} } });
 const created = await builder(event("create", { kind: "mark-the-words", title: "Image-only marker assignment", pageId: "ub2-sb-unit-1-part-1", clientMutationId: randomUUID() })); assert.equal(created.statusCode, 200, created.body);
 const activityId = JSON.parse(created.body).activityId; const pair = nativeMarkerCandidate(); pair.publicDocument.activityId = pair.teacherDocument.activityId = activityId;
 const assets = [];
 for (const reference of pair.publicDocument.assets) {
  const uploadId = randomUUID(), clientMutationId = randomUUID();
  await prepareBuilderNativeAssetUpload(sql, { ...identity, activityId, assetSlot: reference.slot, uploadId, clientMutationId, builderUserId: builderId, requestSha256: reference.checksumSha256, fileDescriptor: { name: "fixture.png", size: 68, type: "image/png", assetSlot: reference.slot, purpose: "native-asset" }, stagingObjectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/${uploadId}/staging/asset`, expiresAt: new Date(Date.now() + 600000).toISOString() });
  await claimBuilderNativeAssetUpload(sql, { uploadId, clientMutationId, builderUserId: builderId });
  reference.assetId = await completeBuilderNativeAssetUpload(sql, { uploadId, builderUserId: builderId, objectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/assets/${reference.checksumSha256}.png`, storageBucket: "local-fixtures", mimeType: "image/png", byteSize: 68, checksumSha256: reference.checksumSha256, width: reference.slot === "graphic" ? 120 : 1024, height: reference.slot === "graphic" ? 3 : 582 });
  assets.push((await pool.query("select * from book_assets where id=$1", [reference.assetId])).rows[0]);
 }
 const saved = await builder(event(`activities/${activityId}/save`, { ...pair, expectedPublicRevision: 1, expectedTeacherRevision: 1, clientMutationId: randomUUID() })); assert.equal(saved.statusCode, 200, saved.body);
 const rows = (await pool.query("select document_type,payload from builder_component_documents where document_key=$1", [activityId])).rows;
 assert.deepEqual(rows.find((row) => row.document_type === "native_activity_public").payload, pair.publicDocument);
 assert.deepEqual(rows.find((row) => row.document_type === "native_activity_teacher").payload, pair.teacherDocument);
 const compiled = compilePair(pair, assets);
 assert.deepEqual(compiled.publicProjection.nativeActivities[activityId].document, pair.publicDocument);
 const common = { packageId: scope.package_id, componentId: scope.component_id, builderId };
 const head = (await pool.query("select release_id,head_revision from book_component_publication_heads where book_component_id=$1", [scope.component_id])).rows[0];
 const releaseNumber = Number((await pool.query("select max(release_number) n from book_component_releases where book_component_id=$1", [scope.component_id])).rows[0].n) + 1;
 const release = await insertRelease(pool, { ...common, releaseNumber, fixture: { compiled } });
 await publishRelease(pool, { ...common, releaseId: release.releaseId, previousReleaseId: head.release_id, revision: Number(head.head_revision) + 1 });
 const panel = pair.publicDocument.parts[0].interaction.presentation.panels[0]; const ids = panel.hotspots.map((hotspot) => hotspot.targetId);
 const token = randomBytes(32).toString("hex"); await pool.query("insert into auth_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 day')", [student.id, hashToken(token)]);
 setSqlForTests(sql);
 const submit = (body) => bookContent({ httpMethod: "POST", queryStringParameters: { action: "submit" }, headers: { cookie: `${sessionCookieName}=${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
 try {
  let counter = 0;
  for (const [label, selected, expected] of [["all-correct", ids.slice(0, 2), 100], ["wrong-extra", ids, 0], ["missing-correct", ids.slice(0, 1), 0], ["empty", [], 0]]) for (const marker of [markerId(1), markerId(2)]) {
   const creation = await createAssignment(sql, { idempotencyKey: `native-markers-${++counter}`, classIds: [classId], target: { kind: "published_native", releaseId: release.releaseId, nativeActivityId: activityId } }, teacher); assert.equal(creation.statusCode, 200, creation.body);
   const assignment = JSON.parse(creation.body).assignment;
   const detail = await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id }); assert.equal(detail.statusCode, 200, detail.body); assert.doesNotMatch(detail.body, /correctTargetIds|correctWordIds|isCorrect/);
   const response = { schemaVersion: "native-response.v1", items: [{ id: panel.id, value: selected, markers: Object.fromEntries(selected.map((id) => [id, marker])) }] };
   const bad = structuredClone(response); bad.items[0].markers[ids[2]] = "foreign";
   assert.equal((await submit({ assignmentId: assignment.id, response: bad })).statusCode, 400);
   assert.equal(Number((await pool.query("select count(*) from activity_submissions where activity_assignment_id=$1", [assignment.id])).rows[0].count), 0);
   const submitted = await submit({ assignmentId: assignment.id, response }); assert.equal(submitted.statusCode, 200, submitted.body);
   const stored = (await pool.query("select response_payload,score_percent,status from activity_submissions where activity_assignment_id=$1", [assignment.id])).rows[0];
   assert.equal(Number(stored.score_percent), expected, label); assert.equal(stored.status, "submitted"); assert.deepEqual(stored.response_payload.items, response.items);
   assert.deepEqual(restoreNativeSubmissionResponses(stored.response_payload).markers[panel.id], response.items[0].markers);
   assert.equal((await submit({ assignmentId: assignment.id, response })).statusCode, 409);
  }
  if (process.env.PUBLISHED_BOOK_BROWSER === "1" || process.env.NATIVE_MARKER_BROWSER === "1") {
   const creation = await createAssignment(sql, { idempotencyKey: "native-markers-browser", classIds: [classId], target: { kind: "published_native", releaseId: release.releaseId, nativeActivityId: activityId } }, teacher); assert.equal(creation.statusCode, 200, creation.body);
   const { verifyNativeMarkerAssignmentBrowser } = await import("./_native-marker-browser.mjs");
   await verifyNativeMarkerAssignmentBrowser({ pool, sql, token, assignmentId: JSON.parse(creation.body).assignment.id, pair });
  }
  console.log("Native markers PostgreSQL: real Builder save/reload, immutable compiler, entitled assignment, authenticated submit handler, 8 persisted score/marker cases and failure/retry passed.");
 } finally { setSqlForTests(null); }
}
