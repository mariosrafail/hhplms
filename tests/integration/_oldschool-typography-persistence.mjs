import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { enrichedOldschoolTypographyPair, appendOldschoolTypographyPublication } from "../fixtures/oldschool-typography-publication.js";
import { createPublicationV2FixtureSources } from "../fixtures/publication-v2.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { prepareBuilderNativeAssetUpload, claimBuilderNativeAssetUpload, completeBuilderNativeAssetUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { projectNativeActivityPublicForAuthoring } from "../../src/apps/book-builder/hosted/nativeActivityAuthoringProjection.js";
import { createAssignment } from "../../netlify/functions/_book-content/assignment-actions.js";
import { getStudentAssignmentDetail } from "../../netlify/functions/_book-content/published-book-actions.js";

export async function exerciseOldschoolTypographyPairSave({ pool, sql, actor, fontReference }) {
  const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
  const event = (suffix, body) => ({ httpMethod: "POST", path: `/builder/api/native-activities/books/${identity.bookSlug}/components/${identity.componentSlug}/${suffix}`, headers: { host: "localhost:8888", origin: "http://localhost:8888", "content-type": "application/json" }, body: JSON.stringify(body) });
  const handler = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }), logger: { error() {}, warn() {} } });
  const response = await handler(event("create", { kind: "oldschool-listening", title: "Typography persistence", pageId: "ub2-sb-unit-1-part-1", clientMutationId: randomUUID() }));
  assert.equal(response.statusCode, 200, response.body);
  const activityId = JSON.parse(response.body).activityId; const pair = enrichedOldschoolTypographyPair();
  pair.publicDocument.activityId = pair.teacherDocument.activityId = activityId;
  pair.publicDocument.assets[2] = fontReference;
  pair.publicDocument.parts[0].interaction.cues[0].highlightRegions[0].runs[1].typography.fontAssetSlot = fontReference.slot;
  for (const asset of pair.publicDocument.assets.slice(0, 2)) {
    const audio = asset.slot === "transcript-audio"; const type = audio ? "audio/mpeg" : "image/png"; const extension = audio ? "mp3" : "png";
    const uploadId = randomUUID(); const clientMutationId = randomUUID();
    await prepareBuilderNativeAssetUpload(sql, { ...identity, activityId, assetSlot: asset.slot, uploadId, clientMutationId, builderUserId: actor, requestSha256: asset.checksumSha256, fileDescriptor: { name: `fixture.${extension}`, size: 68, type, assetSlot: asset.slot, purpose: "native-asset" }, stagingObjectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/${uploadId}/staging/asset`, expiresAt: new Date(Date.now() + 600000).toISOString() });
    await claimBuilderNativeAssetUpload(sql, { uploadId, clientMutationId, builderUserId: actor });
    asset.assetId = await completeBuilderNativeAssetUpload(sql, { uploadId, builderUserId: actor, objectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/assets/${asset.checksumSha256}.${extension}`, storageBucket: "local-fixtures", mimeType: type, byteSize: 68, checksumSha256: asset.checksumSha256, width: audio ? null : 1018, height: audio ? null : 1509 });
  }
  const docs = (await pool.query("select document_type,revision from builder_component_documents where document_key=$1", [activityId])).rows;
  const input = { ...pair, expectedPublicRevision: Number(docs.find((row) => row.document_type === "native_activity_public").revision), expectedTeacherRevision: Number(docs.find((row) => row.document_type === "native_activity_teacher").revision), clientMutationId: randomUUID() };
  const saved = await handler(event(`activities/${activityId}/save`, input)); assert.equal(saved.statusCode, 200, saved.body);
  const reloaded = (await pool.query("select document_type,payload from builder_component_documents where document_key=$1", [activityId])).rows;
  const publicDocument = reloaded.find((row) => row.document_type === "native_activity_public").payload;
  const teacherDocument = reloaded.find((row) => row.document_type === "native_activity_teacher").payload;
  assert.deepEqual(publicDocument, pair.publicDocument); assert.deepEqual(teacherDocument, pair.teacherDocument);
  assert.deepEqual(projectNativeActivityPublicForAuthoring(publicDocument), pair.publicDocument);
  const assetRows = (await pool.query("select * from book_assets where id=any($1::uuid[])", [publicDocument.assets.map((asset) => asset.assetId)])).rows;
  const compiled = compileUltimateB2ComponentReleaseV2(appendOldschoolTypographyPublication(createPublicationV2FixtureSources(), { publicDocument, teacherDocument }, assetRows));
  assert.deepEqual(compiled.publicProjection.nativeActivities[activityId].document, publicDocument);
  assert.equal((await handler(event(`activities/${activityId}/save`, { ...input, clientMutationId: randomUUID() }))).statusCode, 409);
}

export async function exerciseOldschoolTypographyAssignment({ pool, sql, scope, builderId, teacher, student, classId, insertRelease, publishRelease }) {
  const pair = enrichedOldschoolTypographyPair(); const activityId = pair.publicDocument.activityId;
  const compiled = compileUltimateB2ComponentReleaseV2(appendOldschoolTypographyPublication(createPublicationV2FixtureSources(), pair));
  const release = await insertRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, builderId, releaseNumber: 120, fixture: { compiled } });
  const previous = (await pool.query("select release_id,head_revision from book_component_publication_heads where book_component_id=$1", [scope.component_id])).rows[0];
  await publishRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, releaseId: release.releaseId, previousReleaseId: previous.release_id, revision: Number(previous.head_revision) + 1, builderId });
  const created = await createAssignment(sql, { idempotencyKey: "oldschool-typography-assignment", classIds: [classId], target: { kind: "published_native", releaseId: release.releaseId, nativeActivityId: activityId } }, teacher);
  assert.equal(created.statusCode, 200, created.body);
  const assignment = JSON.parse(created.body).assignment;
  const detail = await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id }); assert.equal(detail.statusCode, 200, detail.body);
  const before = JSON.parse(detail.body); assert.match(JSON.stringify(before), /fontAssetSlot/); assert.doesNotMatch(JSON.stringify(before), /SYNTHETIC_PRIVATE_TRANSCRIPT_ANSWER/);
  pair.publicDocument.parts[0].interaction.cues[0].highlightRegions[0].typography.fontSize = 40;
  const newer = await insertRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, builderId, releaseNumber: 121, fixture: { compiled: compileUltimateB2ComponentReleaseV2(appendOldschoolTypographyPublication(createPublicationV2FixtureSources(), pair)) } });
  await publishRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, releaseId: newer.releaseId, previousReleaseId: release.releaseId, revision: Number(previous.head_revision) + 2, builderId });
  assert.deepEqual(JSON.parse((await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id })).body), before);
}
