import assert from "node:assert/strict";
import test from "node:test";

import { assertPublicBuilderDocument } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { NATIVE_ACTIVITY_KINDS, normalizeNativeActivityPublicDocument, normalizeNativeActivityTeacherDocument, resolveNativeActivityKind, validateNativeActivityPair } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { createEmptyNativeActivityIndex, normalizeNativeActivityIndex, normalizeNativeManagedAssetReference } from "../src/data/native-activities/nativeActivityPublic.js";
import { ultimateB2NativeActivityAdapter, ultimateB2NativeActivityPlacements } from "../src/data/ultimate-b2/nativeActivityAdapter.js";
import { createNativeChildId } from "../src/data/native-activities/nativeChildIdentity.js";
import { NATIVE_SINGLE_CHOICE_LIMITS } from "../src/data/native-activities/nativeSingleChoice.js";

const placement = ultimateB2NativeActivityPlacements[0];
const activityId = "ultimate-b2-sb-u1-p1-o99";

test("registered native kinds create deterministic, separate one-Part public and Teacher drafts", () => {
  assert.deepEqual(NATIVE_ACTIVITY_KINDS, ["multi-part", "open-response", "image", "single-choice", "complete-sentences", "listening", "oldschool-listening", "drag-drop", "mark-the-words"]);
  for (const kindName of NATIVE_ACTIVITY_KINDS) {
    const kind = resolveNativeActivityKind(kindName);
    const firstPublic = kind.createBlankPublic({ activityId, title: `New ${kind.label}`, placement });
    const secondPublic = kind.createBlankPublic({ activityId, title: `New ${kind.label}`, placement });
    const teacher = kind.createBlankTeacher({ activityId, placement });
    assert.deepEqual(firstPublic, secondPublic);
    assert.equal(firstPublic.parts.length, 1);
    assert.equal(firstPublic.parts[0].id, "part-1");
    assert.equal(teacher.parts[0].id, "part-1");
    assert.equal(firstPublic.kind, kindName);
    assert.equal(teacher.kind, kindName);
    assert.equal(validateNativeActivityPair(firstPublic, teacher), true);
    assert.doesNotThrow(() => assertPublicBuilderDocument(firstPublic));
    assert.equal(JSON.stringify(firstPublic).includes("modelAnswers"), false);
    assert.equal(JSON.stringify(firstPublic).includes("correctAnswers"), false);
    assert.equal(JSON.stringify(firstPublic).includes('"answers"'), false);
    assert.equal(JSON.stringify(firstPublic).includes('"mappings"'), false);
  }
  assert.equal(resolveNativeActivityKind("multiple-choice"), null);
});

test("Single Choice keeps stable option identity and the answer key exclusively in the Teacher document", () => {
  const kind = resolveNativeActivityKind("single-choice");
  const publicDocument = kind.createBlankPublic({ activityId, title: "Multiple Choice", placement });
  const teacherDocument = kind.createBlankTeacher({ activityId });
  const questionId = createNativeChildId("q");
  const options = [createNativeChildId("opt"), createNativeChildId("opt")];
  publicDocument.parts[0].interaction.questions = [{ id: questionId, prompt: "Choose", options: options.map((id) => ({ id, text: id })) }];
  teacherDocument.parts[0].solution.correctAnswers = [{ questionId, correctOptionId: options[1] }];
  assert.equal(kind.validatePair(publicDocument, teacherDocument), true);
  assert.equal(kind.assessReadiness(publicDocument, teacherDocument).ready, true);
  assert.doesNotMatch(JSON.stringify(publicDocument), /correctOptionId|correctAnswers/);
  assert.throws(() => kind.validatePair(publicDocument, { ...teacherDocument, parts: [{ ...teacherDocument.parts[0], solution: { kind: "single-choice", correctAnswers: [{ questionId, correctOptionId: createNativeChildId("opt") }] } }] }), /exactly match/);
  assert.throws(() => kind.normalizePublic({ ...publicDocument, parts: [{ ...publicDocument.parts[0], interaction: { ...publicDocument.parts[0].interaction, answerKey: [] } }] }));
});

test("Single Choice enforces exact question, option, prompt, and option-text limits", () => {
  const kind = resolveNativeActivityKind("single-choice");
  const publicDocument = kind.createBlankPublic({ activityId, title: "Limits", placement });
  const teacherDocument = kind.createBlankTeacher({ activityId });
  for (let index = 0; index < 20; index += 1) {
    const questionId = createNativeChildId("q");
    const optionIds = Array.from({ length: NATIVE_SINGLE_CHOICE_LIMITS.optionsMaximum }, () => createNativeChildId("opt"));
    publicDocument.parts[0].interaction.questions.push({ id: questionId, prompt: "p".repeat(2_000), options: optionIds.map((id) => ({ id, text: "o".repeat(1_000) })) });
    teacherDocument.parts[0].solution.correctAnswers.push({ questionId, correctOptionId: optionIds[0] });
  }
  assert.equal(kind.validatePair(publicDocument, teacherDocument), true);
  const tooManyQuestions = structuredClone(publicDocument);
  tooManyQuestions.parts[0].interaction.questions.push(structuredClone(publicDocument.parts[0].interaction.questions[0]));
  assert.throws(() => kind.normalizePublic(tooManyQuestions), /invalid/);
  const tooManyOptions = structuredClone(publicDocument);
  tooManyOptions.parts[0].interaction.questions[0].options.push({ id: createNativeChildId("opt"), text: "extra" });
  assert.throws(() => kind.normalizePublic(tooManyOptions), /invalid/);
  const longPrompt = structuredClone(publicDocument);
  longPrompt.parts[0].interaction.questions[0].prompt += "x";
  assert.throws(() => kind.normalizePublic(longPrompt), /invalid/);
  const longOption = structuredClone(publicDocument);
  longOption.parts[0].interaction.questions[0].options[0].text += "x";
  assert.throws(() => kind.normalizePublic(longOption), /invalid/);
});

test("native public and Teacher schemas reject missing, extra, duplicate, and mismatched Part structures", () => {
  const kind = resolveNativeActivityKind("open-response");
  const publicDocument = kind.createBlankPublic({ activityId, title: "Draft", placement });
  const teacherDocument = kind.createBlankTeacher({ activityId, placement });
  for (const invalid of [
    { ...publicDocument, parts: [] },
    { ...publicDocument, parts: [...publicDocument.parts, structuredClone(publicDocument.parts[0])] },
    { ...publicDocument, parts: [{ ...publicDocument.parts[0], id: "part-2" }] },
    { ...publicDocument, unexpected: true },
  ]) assert.throws(() => normalizeNativeActivityPublicDocument(invalid, activityId));
  assert.throws(() => normalizeNativeActivityTeacherDocument({ ...teacherDocument, parts: [] }, activityId));
  assert.throws(() => normalizeNativeActivityTeacherDocument({ ...teacherDocument, unexpected: true }, activityId));
  assert.throws(() => validateNativeActivityPair(publicDocument, { ...teacherDocument, activityId: `${activityId}-other` }));
  assert.throws(() => normalizeNativeActivityPublicDocument({ ...publicDocument, kind: "image" }, activityId));
});

test("native public safety and managed asset references fail closed", () => {
  const kind = resolveNativeActivityKind("image");
  const document = kind.createBlankPublic({ activityId, title: "Image draft", placement });
  document.metadata.modelAnswer = "must not escape";
  assert.throws(() => assertPublicBuilderDocument(document));
  const reference = { assetId: "10000000-0000-4000-8000-000000000001", checksumSha256: "a".repeat(64), role: "activity_image", slot: "main-image" };
  assert.deepEqual(normalizeNativeManagedAssetReference(reference), reference);
  assert.throws(() => normalizeNativeManagedAssetReference({ ...reference, assetId: "../file" }));
  assert.throws(() => normalizeNativeManagedAssetReference({ ...reference, checksumSha256: "bad" }));
  assert.throws(() => normalizeNativeManagedAssetReference({ ...reference, repositoryPath: "private/file.png" }));
});

test("native index is exact, deterministic, and Ultimate B2 identity remains adapter-owned", () => {
  const empty = createEmptyNativeActivityIndex();
  assert.deepEqual(empty, { schemaVersion: "1.0", activities: [] });
  const normalized = normalizeNativeActivityIndex({ schemaVersion: "1.0", activities: [
    { activityId: "ultimate-b2-sb-u1-p1-o10", kind: "image", placement: { pageId: placement.pageId }, sortOrder: 12 },
    { activityId: "ultimate-b2-sb-u1-p1-o9", kind: "open-response", placement: { pageId: placement.pageId }, sortOrder: 11 },
  ] }, { allowedKinds: NATIVE_ACTIVITY_KINDS });
  assert.deepEqual(normalized.activities.map((entry) => entry.activityId), ["ultimate-b2-sb-u1-p1-o9", "ultimate-b2-sb-u1-p1-o10"]);
  assert.throws(() => normalizeNativeActivityIndex({ schemaVersion: "1.0", activities: [normalized.activities[0], normalized.activities[0]] }, { allowedKinds: NATIVE_ACTIVITY_KINDS }));
  assert.throws(() => normalizeNativeActivityIndex({ schemaVersion: "1.0", activities: [{ ...normalized.activities[0], kind: "matching" }] }, { allowedKinds: NATIVE_ACTIVITY_KINDS }));
  assert.match(ultimateB2NativeActivityAdapter.nextActivityId({ placement, nativeIndex: normalized }), /^ultimate-b2-sb-u1-p1-o\d+$/);
});

test("Students Book existing placements batch one tombstone-overlay read without making absent canonical pages unavailable", async () => {
  const [deleted, active, absent] = ultimateB2NativeActivityPlacements.slice(0, 3);
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return [
      { stable_key: `ultimate-b2-students-book/pages/${deleted.pageId}`, source_metadata: { is_deleted: true } },
      { stable_key: `ultimate-b2-students-book/pages/${active.pageId}`, source_metadata: { is_active: true } },
    ];
  };
  const context = { sql, bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book" };
  const placements = await ultimateB2NativeActivityAdapter.resolveExistingPlacements([
    { pageId: deleted.pageId }, { pageId: active.pageId }, { pageId: absent.pageId }, { pageId: active.pageId },
  ], context);

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /page\.stable_key=any\(\?::text\[\]\)/i);
  assert.equal(calls[0].values.at(-1).length, 3);
  assert.equal(placements.size, 3);
  assert.equal(placements.get(deleted.pageId).unassignedReason, "page-deleted");
  assert.equal(placements.get(active.pageId).assignmentState, "assigned");
  assert.equal(placements.get(absent.pageId).assignmentState, "assigned");
  await assert.rejects(ultimateB2NativeActivityAdapter.resolveExistingPlacements([{ pageId: "unknown-page" }], context), /unknown/);
  await assert.rejects(ultimateB2NativeActivityAdapter.resolveExistingPlacements([{ pageId: active.pageId }], { ...context, componentSlug: "ultimate-b2-workbook" }), /invalid/);
  const databaseFailure = Object.assign(new Error("database unavailable"), { code: "CONNECTION_LOST" });
  await assert.rejects(ultimateB2NativeActivityAdapter.resolveExistingPlacements([{ pageId: active.pageId }], { ...context, sql: async () => { throw databaseFailure; } }), (error) => error === databaseFailure);
});
