import assert from "node:assert/strict";
import { multiPartReadablePair } from "../fixtures/native-runtime-regressions/runtime-corrections-data.js";
import { appendMultiPartPublicationFixture } from "../fixtures/native-multi-part-publication.js";
import { oldschoolTypographyAssetRows } from "../fixtures/oldschool-typography-publication.js";
import { createPublicationV2FixtureSources } from "../fixtures/publication-v2.js";
import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { createAssignment } from "../../netlify/functions/_book-content/assignment-actions.js";
import { submitActivity } from "../../netlify/functions/_book-content/submission-actions.js";
import { getStudentAssignmentDetail } from "../../netlify/functions/_book-content/published-book-actions.js";

export async function exerciseMultiPartReadableAssignment({ pool, sql, scope, builderId, teacher, student, classId, insertRelease, publishRelease }) {
  const pair = multiPartReadablePair(true); const activityId = pair.publicDocument.activityId;
  const rows = oldschoolTypographyAssetRows(pair).map((row) => {
    const slot = pair.publicDocument.assets.find((asset) => asset.assetId === row.id).slot;
    if (slot === "audio") return { ...row, width:null,height:null,mime_type:"audio/mpeg",object_key:row.object_key.replace(/\.png$/, ".mp3") };
    const [width,height] = slot === "readable" ? [1000,1800] : slot === "overlay" ? [150,100] : slot === "item" ? [120,60] : [1024,582];
    return { ...row,width,height };
  });
  const compile = () => {
    const sources=appendMultiPartPublicationFixture(createPublicationV2FixtureSources(), pair);
    sources.native.assetRows=sources.native.assetRows.filter((row)=>row.source_metadata?.native_activity_id!==activityId).concat(rows);
    return compileUltimateB2ComponentReleaseV2(sources);
  };
  const compiled = compile();
  const release = await insertRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, builderId, releaseNumber: 140, fixture: { compiled } });
  const previous = (await pool.query("select release_id,head_revision from book_component_publication_heads where book_component_id=$1", [scope.component_id])).rows[0];
  await publishRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, releaseId: release.releaseId, previousReleaseId: previous.release_id, revision: Number(previous.head_revision) + 1, builderId });
  const created = await createAssignment(sql, { idempotencyKey: "multi-part-readable-assignment", classIds: [classId], target: { kind: "published_native", releaseId: release.releaseId, nativeActivityId: activityId } }, teacher);
  assert.equal(created.statusCode, 200, created.body); const assignment = JSON.parse(created.body).assignment;
  const detail = await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id }); assert.equal(detail.statusCode, 200, detail.body);
  const before = JSON.parse(detail.body); assert.doesNotMatch(JSON.stringify(before), /"mappings"|"correctAnswers"|"modelAnswers"/);
  pair.publicDocument.parts[0].interaction.panels.reverse(); pair.publicDocument.parts[0].interaction.sections.reverse();
  const newer = await insertRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, builderId, releaseNumber: 141, fixture: { compiled: compile() } });
  await publishRelease(pool, { packageId: scope.package_id, componentId: scope.component_id, releaseId: newer.releaseId, previousReleaseId: release.releaseId, revision: Number(previous.head_revision) + 2, builderId });
  assert.deepEqual(JSON.parse((await getStudentAssignmentDetail(sql, student, { assignmentId: assignment.id })).body), before);
  const sections = pair.publicDocument.parts[0].interaction.sections.filter((section) => section.kind !== "image").map((section) => {
    const solution = pair.teacherDocument.parts[0].solution.sections.find((entry) => entry.id === section.id).solution;
    const items = section.kind === "drag-drop" ? solution.mappings.map((entry) => ({ id:entry.targetId,value:entry.wordIds || [entry.wordId] }))
      : section.kind === "single-choice" ? solution.correctAnswers.map((entry)=>({id:entry.questionId,value:entry.correctOptionId}))
      : section.kind === "open-response" ? solution.modelAnswers.map((entry)=>({id:entry.questionId,value:"Persisted personal response"}))
      : solution.answers.map((entry)=>({id:entry.itemId,value:section.kind === "mark-the-words" ? entry.correctWordIds : entry.text}));
    return {id:section.id,kind:section.kind,response:{schemaVersion:"native-response.v1",items}};
  });
  const submitted=await submitActivity(sql,{assignmentId:assignment.id,response:{schemaVersion:"native-multi-response.v1",sections}},student);
  assert.equal(submitted.statusCode,200,submitted.body); assert.equal(JSON.parse(submitted.body).submission.status,"awaiting_review");
  const stored=(await pool.query("select response_payload,score_percent from activity_submissions where activity_assignment_id=$1",[assignment.id])).rows[0];
  assert.equal(stored.response_payload.kind,"multi-part"); assert.equal(stored.score_percent,null);
  assert.equal(stored.response_payload.sections.length,10);
  assert.deepEqual(new Set(stored.response_payload.sections.map((section)=>section.id)),new Set(sections.map((section)=>section.id)));
}
