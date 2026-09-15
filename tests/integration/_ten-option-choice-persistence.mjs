import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tenOptionChoicePair, choiceInteraction, choiceSolution } from "../fixtures/ten-option-choice.js";
import { createPublicationV2FixtureSources } from "../fixtures/publication-v2.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { prepareBuilderNativeAssetUpload, claimBuilderNativeAssetUpload, completeBuilderNativeAssetUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activity-store.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";
import { createAssignment } from "../../netlify/functions/_book-content/assignment-actions.js";
import { submitActivity } from "../../netlify/functions/_book-content/submission-actions.js";
import { getPublishedBookActivity, getStudentAssignmentDetail } from "../../netlify/functions/_book-content/published-book-actions.js";

const identity = { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
const privateFields = /"correctAnswers"|"correctOptionIds?"|"modelAnswers"|"mappings"/;

function compilePair(pair, assetRows) {
  const sources = createPublicationV2FixtureSources();
  const { activityId, kind, placement } = pair.publicDocument;
  const source = payload => ({ payload, revision: 1, sha256: builderDocumentSha256(payload) });
  const entry = { activityId, kind, placement, sortOrder: sources.native.index.payload.activities.length + 1 };
  sources.native.index.payload.activities = sources.native.index.payload.activities.filter(item => item.activityId !== activityId).concat(entry);
  sources.native.index.sha256 = builderDocumentSha256(sources.native.index.payload);
  sources.native.activities[activityId] = { index: entry, public: source(pair.publicDocument), teacher: source(pair.teacherDocument) };
  sources.documents.hotspots.payload.pages[placement.pageId].push({ id: "hotspot-ten-option-persistence", unitNumber: 1, pageId: placement.pageId, pageNumber: 5, left: 70, top: 30, width: 12, height: 12, label: "Ten options", actionType: "normalized_activity", activityKey: activityId });
  sources.documents.hotspots.sha256 = builderDocumentSha256(sources.documents.hotspots.payload);
  sources.native.assetRows.push(...assetRows);
  return compileUltimateB2ComponentReleaseV2(sources);
}

// Uses the canonical integration owner's real, isolated PostgreSQL schema.
// Upload finalization creates local fixture metadata only; no provider is called.
export async function exerciseTenOptionChoicePersistence({ pool, sql, scope, builderId, teacher, student, classId, insertRelease, publishRelease }) {
  const results = [];
  let checkpoint = "start";
  const receipt = async error => {
    if (!process.env.NATIVE_REGRESSION_OUTPUT) return;
    await mkdir(process.env.NATIVE_REGRESSION_OUTPUT, { recursive: true });
    await writeFile(path.join(process.env.NATIVE_REGRESSION_OUTPUT, "ten-option-postgres.json"), JSON.stringify({ checkpoint, results, ...(error ? { error: error.stack } : {}) }, null, 2));
  };
  const event = (suffix, body) => ({ httpMethod: "POST", path: `/builder/api/native-activities/books/${identity.bookSlug}/components/${identity.componentSlug}/${suffix}`, headers: { host: "localhost:8888", origin: "http://localhost:8888", "content-type": "application/json" }, body: JSON.stringify(body) });
  const handler = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: builderId } }), logger: { error() {}, warn() {} } });
  const load = async activityId => {
    const rows = (await pool.query("select document_type,payload,revision from builder_component_documents where document_key=$1", [activityId])).rows;
    const publicRow = rows.find(row => row.document_type === "native_activity_public");
    const teacherRow = rows.find(row => row.document_type === "native_activity_teacher");
    return { pair: { publicDocument: publicRow.payload, teacherDocument: teacherRow.payload }, expectedPublicRevision: Number(publicRow.revision), expectedTeacherRevision: Number(teacherRow.revision) };
  };
  const save = async (pair, revisions) => {
    const saved = await handler(event(`activities/${pair.publicDocument.activityId}/save`, { ...pair, expectedPublicRevision: revisions.expectedPublicRevision, expectedTeacherRevision: revisions.expectedTeacherRevision, clientMutationId: randomUUID() }));
    assert.equal(saved.statusCode, 200, saved.body);
    const reloaded = await load(pair.publicDocument.activityId);
    assert.deepEqual(reloaded.pair, pair);
    return reloaded;
  };
  const publish = async compiled => {
    const head = (await pool.query("select release_id,head_revision from book_component_publication_heads where book_component_id=$1", [scope.component_id])).rows[0];
    const number = Number((await pool.query("select max(release_number) n from book_component_releases where book_component_id=$1", [scope.component_id])).rows[0].n) + 1;
    const common = { packageId: scope.package_id, componentId: scope.component_id, builderId };
    const release = await insertRelease(pool, { ...common, releaseNumber: Math.max(300, number), fixture: { compiled } });
    await publishRelease(pool, { ...common, releaseId: release.releaseId, previousReleaseId: head.release_id, revision: Number(head.head_revision) + 1 });
    return release;
  };
  try {
    for (const kind of ["single-choice", "multi-part", "oldschool-listening"]) for (const visual of [false, true]) for (const multiple of [false, true]) {
      const label = `${kind}-${visual ? "visual" : "text"}-${multiple ? "multiple" : "single"}`;
      checkpoint = `${label}:create`; await receipt();
      const created = await handler(event("create", { kind, title: label, pageId: "ub2-sb-unit-1-part-1", clientMutationId: randomUUID() }));
      assert.equal(created.statusCode, 200, created.body);
      const activityId = JSON.parse(created.body).activityId;
      let pair = tenOptionChoicePair(kind, { visual, multiple });
      pair.publicDocument.activityId = pair.teacherDocument.activityId = activityId;
      for (const asset of pair.publicDocument.assets) {
        const audio = asset.slot === "transcript-audio";
        const type = audio ? "audio/mpeg" : "image/png", extension = audio ? "mp3" : "png";
        const [width, height] = asset.slot === "choice-background" ? [1024, 1100] : [1018, 1509];
        const uploadId = randomUUID(), clientMutationId = randomUUID();
        assert.equal((await prepareBuilderNativeAssetUpload(sql, { ...identity, activityId, assetSlot: asset.slot, uploadId, clientMutationId, builderUserId: builderId, requestSha256: asset.checksumSha256, fileDescriptor: { name: `fixture.${extension}`, size: 68, type, assetSlot: asset.slot, purpose: "native-asset" }, stagingObjectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/${uploadId}/staging/asset`, expiresAt: new Date(Date.now() + 600000).toISOString() })).outcome, "prepared");
        assert.equal((await claimBuilderNativeAssetUpload(sql, { uploadId, clientMutationId, builderUserId: builderId })).outcome, "claimed");
        asset.assetId = await completeBuilderNativeAssetUpload(sql, { uploadId, builderUserId: builderId, objectKey: `builder-native-assets/${identity.bookSlug}/${identity.componentSlug}/${activityId}/assets/${asset.checksumSha256}.${extension}`, storageBucket: "local-fixtures", mimeType: type, byteSize: 68, checksumSha256: asset.checksumSha256, width: audio ? null : width, height: audio ? null : height });
        assert.ok(asset.assetId);
      }
      const publicDocument = normalizeNativeRuntimePublicDocument(pair.publicDocument, { activityId, kind });
      pair = { publicDocument, teacherDocument: normalizeNativeRuntimeTeacherDocument(pair.teacherDocument, { activityId, kind, publicDocument }) };
      checkpoint = `${label}:save-reload`; await receipt();
      const saved = await save(pair, await load(activityId));
      const question = choiceInteraction(saved.pair).questions[0];
      const correctIds = multiple ? question.options.slice(6).map(option => option.id) : [question.options[9].id];
      assert.equal(question.options.length, 10);
      const answer = choiceSolution(saved.pair).correctAnswers[0];
      assert.deepEqual(answer.correctOptionIds || [answer.correctOptionId], correctIds);
      const rows = (await pool.query("select * from book_assets where id=any($1::uuid[])", [pair.publicDocument.assets.map(asset => asset.assetId)])).rows;
      checkpoint = `${label}:publication`; await receipt();
      const compiled = compilePair(saved.pair, rows);
      assert.deepEqual(compiled.publicProjection.nativeActivities[activityId].document, pair.publicDocument);
      assert.deepEqual(compiled.teacherProjection.nativeActivities[activityId].document, pair.teacherDocument);
      assert.doesNotMatch(JSON.stringify(compiled.publicProjection), privateFields);
      const release = await publish(compiled);
      const publicRead = await getPublishedBookActivity(sql, student, { ...identity, releaseId: release.releaseId, activityId });
      assert.equal(publicRead.statusCode, 200, publicRead.body);
      assert.deepEqual(JSON.parse(publicRead.body).target.entry.document, pair.publicDocument);
      assert.doesNotMatch(publicRead.body, privateFields);
      const assignmentResponse = await createAssignment(sql, { idempotencyKey: `ten-option-${label}`, classIds: [classId], target: { kind: "published_native", releaseId: release.releaseId, nativeActivityId: activityId } }, teacher);
      assert.equal(assignmentResponse.statusCode, 200, assignmentResponse.body);
      const assignment = JSON.parse(assignmentResponse.body).assignment;
      const detail = await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id });
      assert.equal(detail.statusCode, 200, detail.body);
      assert.doesNotMatch(detail.body, privateFields);
      checkpoint = `${label}:newer-draft-and-release`; await receipt();
      const newerPair = structuredClone(pair);
      choiceInteraction(newerPair).questions[0].prompt = "Newer mutable draft and release";
      const newerAnswer = choiceSolution(newerPair).correctAnswers[0];
      if (multiple) newerAnswer.correctOptionIds = question.options.slice(0, 4).map(option => option.id);
      else newerAnswer.correctOptionId = question.options[0].id;
      const newerSaved = await save(newerPair, saved);
      const newer = await publish(compilePair(newerSaved.pair, rows));
      assert.notEqual(newer.releaseId, release.releaseId);
      const pinned = await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id });
      assert.equal(pinned.statusCode, 200, pinned.body);
      assert.deepEqual(JSON.parse(pinned.body), JSON.parse(detail.body));
      const pin = (await pool.query("select native_release_id from activity_assignments where id=$1", [assignment.id])).rows[0];
      assert.equal(pin.native_release_id, release.releaseId);
      checkpoint = `${label}:tenth-option-submit`; await receipt();
      const items = [{ id: question.id, value: multiple ? correctIds : correctIds[0] }];
      const childResponse = { schemaVersion: "native-response.v1", items };
      const sectionId = kind === "multi-part" ? pair.publicDocument.parts[0].interaction.sections[0].id : null;
      const response = sectionId ? { schemaVersion: "native-multi-response.v1", sections: [{ id: sectionId, kind: "single-choice", response: childResponse }] } : childResponse;
      const submitted = await submitActivity(sql, { assignmentId: assignment.id, response }, student);
      assert.equal(submitted.statusCode, 200, submitted.body);
      assert.equal(JSON.parse(submitted.body).submission.scorePercent, 100);
      const stored = (await pool.query("select response_payload,score_percent from activity_submissions where activity_assignment_id=$1", [assignment.id])).rows[0];
      assert.equal(stored.response_payload.kind, kind);
      assert.equal(Number(stored.score_percent), 100);
      const storedItems = sectionId ? stored.response_payload.sections.find(section => section.id === sectionId).response.items : stored.response_payload.items;
      assert.deepEqual(storedItems, items);
      results.push({ label, activityId, correctIds, releaseId: release.releaseId, newerReleaseId: newer.releaseId, assignmentId: assignment.id, saveReload: true, publicTeacherPair: true, publicIsolation: true, releasePinned: true, tenthOptionGrading: 100 });
      checkpoint = `${label}:passed`; await receipt();
    }
    assert.equal(results.length, 12);
    console.log("Ten-option PostgreSQL: 12 save/reload, publication, pinned assignment and grading cases passed.");
  } catch (error) { await receipt(error); throw error; }
}
