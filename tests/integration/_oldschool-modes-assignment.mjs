import assert from "node:assert/strict";
import { createOldschoolModePair } from "../fixtures/oldschool-modes.js";
import { appendOldschoolTypographyPublication, oldschoolTypographyAssetRows } from "../fixtures/oldschool-typography-publication.js";
import { createPublicationV2FixtureSources } from "../fixtures/publication-v2.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { createAssignment } from "../../netlify/functions/_book-content/assignment-actions.js";
import { submitActivity } from "../../netlify/functions/_book-content/submission-actions.js";
import { getStudentAssignmentDetail } from "../../netlify/functions/_book-content/published-book-actions.js";

export async function exerciseOldschoolModesAssignment({ pool, sql, scope, builderId, teacher, student, classId, insertRelease, publishRelease }) {
  const pair = createOldschoolModePair("drag-drop", 4); const activityId = pair.publicDocument.activityId;
  const rows = oldschoolTypographyAssetRows(pair).map((row) => {
    const slot = pair.publicDocument.assets.find((asset) => asset.assetId === row.id).slot;
    if (slot === "question-image") return { ...row, width: 1024, height: 582 };
    if (slot === "readable-image") return { ...row, width: 1024, height: 1600 };
    if (slot === "readable-audio") return { ...row, width: null, height: null, mime_type: "audio/mpeg", object_key: row.object_key.replace(/\.png$/, ".mp3") };
    return row;
  });
  const compile = () => compileUltimateB2ComponentReleaseV2(appendOldschoolTypographyPublication(createPublicationV2FixtureSources(), pair, rows));
  const compiled = compile();
  const release = await insertRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, builderId, releaseNumber: 130, fixture: { compiled } });
  const previous = (await pool.query("select release_id,head_revision from book_component_publication_heads where book_component_id=$1", [scope.component_id])).rows[0];
  await publishRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, releaseId: release.releaseId, previousReleaseId: previous.release_id, revision: Number(previous.head_revision) + 1, builderId });
  const created = await createAssignment(sql, { idempotencyKey: "oldschool-drag-drop-assignment", classIds: [classId], target: { kind: "published_native", releaseId: release.releaseId, nativeActivityId: activityId } }, teacher);
  assert.equal(created.statusCode, 200, created.body); const assignment = JSON.parse(created.body).assignment;
  const detail = await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id }); assert.equal(detail.statusCode, 200, detail.body);
  const before = JSON.parse(detail.body); assert.doesNotMatch(JSON.stringify(before), /"mappings"|"correctAnswers"|"modelAnswers"/);
  pair.publicDocument.parts[0].interaction.questionInteraction.randomize = true;
  const newer = await insertRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, builderId, releaseNumber: 131, fixture: { compiled: compile() } });
  await publishRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, releaseId: newer.releaseId, previousReleaseId: release.releaseId, revision: Number(previous.head_revision) + 2, builderId });
  assert.deepEqual(JSON.parse((await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id })).body), before);
  const mapping = pair.teacherDocument.parts[0].solution.mappings[0];
  const submitted = await submitActivity(sql, { assignmentId: assignment.id, response: { schemaVersion: "native-response.v1", items: [{ id: mapping.targetId, value: mapping.wordIds }] } }, student);
  assert.equal(submitted.statusCode, 200, submitted.body); assert.equal(JSON.parse(submitted.body).submission.scorePercent, 100);
  const stored = (await pool.query("select response_payload,score_percent from activity_submissions where activity_assignment_id=$1", [assignment.id])).rows[0];
  assert.equal(stored.response_payload.kind, "oldschool-listening"); assert.equal(Number(stored.score_percent), 100);
  assert.deepEqual(stored.response_payload.items, [{ id: mapping.targetId, value: mapping.wordIds }]);
}
