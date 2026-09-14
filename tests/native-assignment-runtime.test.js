import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NATIVE_ASSIGNMENT_TARGET_KIND,
  NATIVE_RESPONSE_SCHEMA_VERSION,
  listPublishedNativeAssignmentTargets,
  nativeTargetToStudent,
  nativeAssignmentCapability,
  resolveNativeAssignmentTarget,
} from "../netlify/functions/_book-content/native-assignment-runtime.js";
import { assignmentIdempotencyKey } from "../netlify/functions/_book-content/shared.js";
import { submitActivity } from "../netlify/functions/_book-content/submission-actions.js";
import { createAssignment } from "../netlify/functions/_book-content/assignment-actions.js";
import {
  ReleaseCompatibilityVariantError,
  ReleaseIntegrityError,
  verifyImmutableComponentRelease,
} from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { compilePublicationV2Fixture, publicationV2Fixture } from "./fixtures/publication-v2.js";

const publicDocument = {
  parts: [{ interaction: { questions: [
    { id: "q-first", prompt: "First prompt" },
    { id: "q-second", prompt: "Second prompt" },
  ] } }],
};

test("native capabilities derive reviewed, scored, and display-only policy for every registered kind", () => {
  const openResponse = nativeAssignmentCapability("open-response");
  assert.equal(openResponse.assignable, true);
  assert.equal(openResponse.submittable, true);
  assert.equal(openResponse.reviewMode, "teacher-reviewed");
  assert.equal(openResponse.responseSchemaVersion, NATIVE_RESPONSE_SCHEMA_VERSION);
  const choice = nativeAssignmentCapability("single-choice");
  assert.equal(choice.assignable, true);
  assert.equal(choice.submittable, true);
  assert.equal(choice.reviewMode, "auto-scored");
  const completeSentences = nativeAssignmentCapability("complete-sentences");
  assert.equal(completeSentences.assignable, true);
  assert.equal(completeSentences.submittable, true);
  assert.equal(completeSentences.reviewMode, "teacher-reviewed");
  const listening = nativeAssignmentCapability("listening");
  assert.equal(listening.assignable, true);
  assert.equal(listening.submittable, true);
  assert.equal(listening.reviewMode, "teacher-reviewed");
  const oldschoolListening = nativeAssignmentCapability("oldschool-listening");
  assert.equal(oldschoolListening.assignable, true);
  assert.equal(oldschoolListening.submittable, true);
  assert.equal(oldschoolListening.reviewMode, "teacher-reviewed");
  const dragDrop = nativeAssignmentCapability("drag-drop");
  assert.equal(dragDrop.assignable, true);
  assert.equal(dragDrop.submittable, true);
  assert.equal(dragDrop.reviewMode, "auto-scored");

  const image = nativeAssignmentCapability("image");
  assert.equal(image.assignable, false);
  assert.equal(image.submittable, false);
  assert.equal(image.reviewMode, "display-only");
  assert.equal(nativeAssignmentCapability("future-kind"), null);
});

test("Drag & Drop assignment responses validate stable target and word ownership and score privately", () => {
  const targetIds = ["target-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "target-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
  const wordIds = ["word-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "word-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
  const publicDragDrop = { parts: [{ interaction: { kind: "drag-drop", words: [{ id: wordIds[0], text: "First" }, { id: wordIds[1], text: "Second" }], panels: [{ dropTargets: [{ id: targetIds[0], accessibleLabel: "Blank one" }, { id: targetIds[1], accessibleLabel: "Blank two" }] }] } }] };
  const teacherDragDrop = { parts: [{ solution: { kind: "drag-drop", mappings: [{ targetId: targetIds[0], wordId: wordIds[1] }, { targetId: targetIds[1], wordId: wordIds[0] }] } }] };
  const capability = nativeAssignmentCapability("drag-drop");
  const normalized = capability.normalizeResponse(publicDragDrop, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: targetIds[1], value: wordIds[0] }, { id: targetIds[0], value: wordIds[1] }] });
  assert.deepEqual(normalized.payload.items.map((item) => item.id), targetIds);
  assert.doesNotMatch(JSON.stringify(normalized.payload), /mappings|Second.*First/);
  assert.deepEqual(capability.evaluateResponse(publicDragDrop, teacherDragDrop, normalized.payload), { status: "submitted", correctCount: 2, totalCount: 2, scorePercent: 100 });
  assert.equal(capability.teacherReviewProjection(publicDragDrop, teacherDragDrop, normalized.payload)[0].modelAnswer, "Second");
  assert.match(capability.normalizeResponse(publicDragDrop, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: targetIds[0], value: wordIds[0] }, { id: targetIds[1], value: wordIds[0] }] }).error, /invalid/);
  assert.match(capability.normalizeResponse(publicDragDrop, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: "forged", value: wordIds[0] }] }).error, /invalid/);
});

for (const layoutMode of ["standard", "text"]) test(`Drag & Drop ${layoutMode} accepts legacy scalars and canonical arrays with exact-set target scoring`, () => {
  const targetIds = ["target-11111111111111111111111111111111", "target-22222222222222222222222222222222"];
  const wordIds = ["word-11111111111111111111111111111111", "word-22222222222222222222222222222222", "word-33333333333333333333333333333333"];
  const publicDocument = { parts: [{ interaction: { kind: "drag-drop", layoutMode, words: [
    { id: wordIds[0], text: "Reusable phrase", reusable: true, shortLabel: "A" },
    { id: wordIds[1], text: "Second phrase", reusable: false, shortLabel: "B" },
    { id: wordIds[2], text: "Wrong phrase", reusable: false, shortLabel: "C" },
  ], panels: [{ dropTargets: [{ id: targetIds[0], accessibleLabel: "Two answers", capacity: 2 }, { id: targetIds[1], accessibleLabel: "One answer", capacity: 1 }] }] } }] };
  const teacherDocument = { parts: [{ solution: { kind: "drag-drop", mappings: [
    { targetId: targetIds[0], wordIds: [wordIds[0], wordIds[1]] }, { targetId: targetIds[1], wordIds: [wordIds[0]] },
  ] } }] };
  const capability = nativeAssignmentCapability("drag-drop");
  const normalize = (items) => capability.normalizeResponse(publicDocument, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items });
  const exact = normalize([{ id: targetIds[0], value: [wordIds[1], wordIds[0]] }, { id: targetIds[1], value: wordIds[0] }]);
  assert.deepEqual(exact.payload.items[0].value, [wordIds[1], wordIds[0]]);
  assert.deepEqual(capability.evaluateResponse(publicDocument, teacherDocument, exact.payload), { status: "submitted", correctCount: 2, totalCount: 2, scorePercent: 100 });
  for (const value of [[wordIds[0]], [wordIds[0], wordIds[2]], [wordIds[0], wordIds[0]]]) {
    const normalized = normalize([{ id: targetIds[0], value }]);
    if (value[0] === value[1]) assert.match(normalized.error, /invalid/);
    else assert.equal(capability.evaluateResponse(publicDocument, teacherDocument, normalized.payload).correctCount, 0);
  }
  assert.match(normalize([{ id: targetIds[0], value: [wordIds[1], wordIds[2]] }, { id: targetIds[1], value: wordIds[1] }]).error, /invalid/, "non-reusable items cannot appear in different targets");
  const review = capability.teacherReviewProjection(publicDocument, teacherDocument, exact.payload);
  assert.deepEqual(review[0].modelAnswers, ["Reusable phrase", "Second phrase"]);
});

test("Listening responses reuse ordered text semantics while keeping model answers Teacher-only", () => {
  const teacherDocument = { parts: [{ solution: { kind: "listening", modelAnswers: [
    { questionId: "q-first", text: "Private first" }, { questionId: "q-second", text: "Private second" },
  ] } }] };
  const capability = nativeAssignmentCapability("listening");
  const normalized = capability.normalizeResponse(publicDocument, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [
    { id: "q-second", value: "Student second" }, { id: "q-first", value: "Student first" },
  ] });
  assert.equal(normalized.payload.kind, "listening");
  assert.deepEqual(normalized.payload.items.map((item) => item.id), ["q-first", "q-second"]);
  assert.doesNotMatch(JSON.stringify(normalized.payload), /Private/);
  assert.deepEqual(capability.teacherReviewProjection(publicDocument, teacherDocument, normalized.payload).map(({ questionId, modelAnswer }) => ({ questionId, modelAnswer })), [
    { questionId: "q-first", modelAnswer: "Private first" }, { questionId: "q-second", modelAnswer: "Private second" },
  ]);
});

test("Oldschool Listening responses reuse Panel 1 text semantics without exposing model answers", () => {
  const teacherDocument = { parts: [{ solution: { kind: "oldschool-listening", modelAnswers: [{ questionId: "q-first", text: "Private first" }, { questionId: "q-second", text: "Private second" }] } }] };
  const capability = nativeAssignmentCapability("oldschool-listening");
  const normalized = capability.normalizeResponse(publicDocument, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: "q-second", value: "Student second" }, { id: "q-first", value: "Student first" }] });
  assert.equal(normalized.payload.kind, "oldschool-listening");
  assert.deepEqual(normalized.payload.items.map((item) => item.id), ["q-first", "q-second"]);
  assert.doesNotMatch(JSON.stringify(normalized.payload), /Private/);
  assert.deepEqual(capability.teacherReviewProjection(publicDocument, teacherDocument, normalized.payload).map(({ questionId, modelAnswer }) => ({ questionId, modelAnswer })), [{ questionId: "q-first", modelAnswer: "Private first" }, { questionId: "q-second", modelAnswer: "Private second" }]);
});

test("Oldschool Listening Single Choice mode uses canonical validation, exact-set scoring, and review", () => {
  const publicChoice = { parts: [{ interaction: { kind: "oldschool-listening", questionMode: "single-choice", questions: [
    { id: "q-single", prompt: "Choose one", options: [{ id: "o-a", text: "A" }, { id: "o-b", text: "B" }] },
    { id: "q-multi", selectionMode: "multiple", prompt: "Choose two", options: [{ id: "o-c", text: "C" }, { id: "o-d", text: "D" }, { id: "o-e", text: "E" }] },
  ] } }] };
  const teacherChoice = { parts: [{ solution: { kind: "oldschool-listening", questionMode: "single-choice", correctAnswers: [
    { questionId: "q-single", correctOptionIds: ["o-b"] }, { questionId: "q-multi", correctOptionIds: ["o-c", "o-e"] },
  ] } }] };
  const capability = nativeAssignmentCapability("oldschool-listening", publicChoice);
  assert.equal(capability.reviewMode, "auto-scored");
  const normalized = capability.normalizeResponse(publicChoice, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [
    { id: "q-multi", value: ["o-e", "o-c"] }, { id: "q-single", value: "o-b" },
  ] });
  assert.equal(normalized.payload.kind, "oldschool-listening");
  assert.deepEqual(normalized.payload.items[0], { id: "q-single", value: "o-b" });
  assert.deepEqual(normalized.payload.items[1], { id: "q-multi", value: ["o-c", "o-e"] });
  assert.deepEqual(capability.evaluateResponse(publicChoice, teacherChoice, normalized.payload), { status: "submitted", correctCount: 2, totalCount: 2, scorePercent: 100 });
  assert.deepEqual(capability.teacherReviewProjection(publicChoice, teacherChoice, normalized.payload)[1].modelAnswers, ["C", "E"]);
  assert.match(capability.normalizeResponse(publicChoice, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: "q-single", value: "o-c" }] }).error, /belonging/);
  assert.match(capability.normalizeResponse(publicChoice, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: "q-single", value: "o-b" }, { id: "q-single", value: "o-b" }] }).error, /Duplicate/);
  assert.equal(JSON.stringify(normalized.payload).includes("correctOption"), false);
});

test("Complete the Sentences response uses public item order and joins private answers only in Teacher review", () => {
  const first = "item-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const second = "item-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const publicComplete = { parts: [{ interaction: { kind: "complete-sentences", items: [
    { id: first, prompt: "I spent the weekend ____ the series." },
    { id: second, prompt: "The final ____ was surprising." },
  ] } }] };
  const teacherComplete = { parts: [{ solution: { kind: "complete-sentences", answers: [
    { itemId: first, text: "catching up on" }, { itemId: second, text: "episode" },
  ] } }] };
  const capability = nativeAssignmentCapability("complete-sentences");
  const normalized = capability.normalizeResponse(publicComplete, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [
    { id: second, value: "episode" }, { id: first, value: "catching up" },
  ] });
  assert.deepEqual(normalized.payload.items.map((item) => item.id), [first, second]);
  assert.equal(normalized.status, "awaiting_review");
  assert.doesNotMatch(JSON.stringify(normalized.payload), /catching up on/);
  assert.deepEqual(capability.teacherReviewProjection(publicComplete, teacherComplete, normalized.payload).map(({ questionId, modelAnswer }) => ({ questionId, modelAnswer })), [
    { questionId: first, modelAnswer: "catching up on" }, { questionId: second, modelAnswer: "episode" },
  ]);
  assert.match(capability.normalizeResponse(publicComplete, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: "forged", value: "x" }] }).error, /invalid/);
});

test("Complete the Sentences exact mode scores private alternatives case-sensitively and keeps legacy reviewed", () => {
  const itemId = "item-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const publicExact = { parts: [{ interaction: { kind: "complete-sentences", evaluationMode: "exact-answer", items: [{ id: itemId, prompt: "Use UK spelling: _____." }] } }] };
  const teacherExact = { parts: [{ solution: { kind: "complete-sentences", answers: [{ itemId, text: "colour/color", acceptedTexts: ["colour", "color"] }] } }] };
  const capability = nativeAssignmentCapability("complete-sentences", publicExact);
  assert.equal(capability.reviewMode, "auto-scored");
  const envelope = (value) => ({ schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: value === undefined ? [] : [{ id: itemId, value }] });
  const accepted = capability.normalizeResponse(publicExact, envelope("  color  "));
  assert.deepEqual(capability.evaluateResponse(publicExact, teacherExact, accepted.payload), { status: "submitted", correctCount: 1, totalCount: 1, scorePercent: 100 });
  const wrongCase = capability.normalizeResponse(publicExact, envelope("Color"));
  assert.equal(capability.evaluateResponse(publicExact, teacherExact, wrongCase.payload).correctCount, 0);
  assert.equal(capability.evaluateResponse(publicExact, teacherExact, capability.normalizeResponse(publicExact, envelope()).payload).correctCount, 0);
  assert.deepEqual(capability.teacherReviewProjection(publicExact, teacherExact, accepted.payload)[0].acceptedAnswers, ["colour", "color"]);
  assert.equal(nativeAssignmentCapability("complete-sentences").reviewMode, "teacher-reviewed");
  assert.equal(nativeAssignmentCapability("complete-sentences").evaluateResponse, undefined);
});

test("Single Choice validates option ownership and scores the immutable Teacher key with unanswered items incorrect", () => {
  const compiled = compilePublicationV2Fixture();
  const publicChoice = compiled.publicProjection.nativeActivities[publicationV2Fixture.singleChoiceId].document;
  const teacherChoice = compiled.teacherProjection.nativeActivities[publicationV2Fixture.singleChoiceId].document;
  const [first, second] = publicChoice.parts[0].interaction.questions;
  const capability = nativeAssignmentCapability("single-choice");
  const normalized = capability.normalizeResponse(publicChoice, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: first.id, value: first.options[1].id }] });
  assert.deepEqual(normalized.payload, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, kind: "single-choice", items: [{ id: first.id, value: first.options[1].id }] });
  assert.deepEqual(capability.evaluateResponse(publicChoice, teacherChoice, normalized.payload), { status: "submitted", correctCount: 1, totalCount: 2, scorePercent: 50 });
  assert.match(capability.normalizeResponse(publicChoice, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: first.id, value: second.options[0].id }] }).error, /belonging/);
  assert.match(capability.normalizeResponse(publicChoice, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: first.id, value: first.options[0].id }, { id: first.id, value: first.options[1].id }] }).error, /Duplicate/);
  const review = capability.teacherReviewProjection(publicChoice, teacherChoice, normalized.payload);
  assert.equal(review[0].answer, first.options[1].text);
  assert.equal(review[0].modelAnswer, first.options[1].text);
  assert.equal(review[0].isCorrect, true);
  assert.equal(review[1].answer, "");
  assert.equal(review[1].isCorrect, false);
});

test("Multiple-answer Single Choice canonicalizes selections and requires the exact set", () => {
  const publicChoice = { parts: [{ interaction: { questions: [{ id: "q-multi", selectionMode: "multiple", prompt: "Choose both", options: [
    { id: "o-a", text: "A" }, { id: "o-b", text: "B" }, { id: "o-c", text: "C" },
  ] }] } }] };
  const teacherChoice = { parts: [{ solution: { correctAnswers: [{ questionId: "q-multi", correctOptionIds: ["o-a", "o-c"] }] } }] };
  const capability = nativeAssignmentCapability("single-choice");
  const envelope = (value) => ({ schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: "q-multi", value }] });
  const exact = capability.normalizeResponse(publicChoice, envelope(["o-c", "o-a"]));
  assert.deepEqual(exact.payload.items[0].value, ["o-a", "o-c"], "response order follows public option order");
  assert.equal(capability.evaluateResponse(publicChoice, teacherChoice, exact.payload).scorePercent, 100);
  assert.equal(capability.evaluateResponse(publicChoice, teacherChoice, capability.normalizeResponse(publicChoice, envelope(["o-a"])).payload).scorePercent, 0);
  assert.equal(capability.evaluateResponse(publicChoice, teacherChoice, capability.normalizeResponse(publicChoice, envelope(["o-a", "o-b", "o-c"])).payload).scorePercent, 0);
  assert.match(capability.normalizeResponse(publicChoice, envelope(["o-a", "o-a"])).error, /unique options/);
  assert.match(capability.normalizeResponse(publicChoice, envelope("o-a")).error, /unique options/);
  assert.deepEqual(capability.teacherReviewProjection(publicChoice, teacherChoice, exact.payload)[0].modelAnswers, ["A", "C"]);
});

test("Open Response adapter canonicalizes stable IDs in document order without changing text", () => {
  const capability = nativeAssignmentCapability("open-response");
  const normalized = capability.normalizeResponse(publicDocument, {
    schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION,
    items: [
      { id: "q-second", value: "  keep my whitespace  " },
      { id: "q-first", value: "First answer" },
    ],
  });
  assert.deepEqual(normalized.payload.items, [
    { id: "q-first", value: "First answer" },
    { id: "q-second", value: "  keep my whitespace  " },
  ]);
  assert.equal(normalized.status, "awaiting_review");
  assert.equal(normalized.scorePercent, null);
});

test("Open Response adapter rejects unknown, duplicate, malformed, and oversized responses", () => {
  const capability = nativeAssignmentCapability("open-response");
  const envelope = (items) => ({ schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items });
  assert.match(capability.normalizeResponse(publicDocument, envelope([{ id: "forged", value: "x" }])).error, /Unexpected response id/);
  assert.match(capability.normalizeResponse(publicDocument, envelope([{ id: "q-first", value: "a" }, { id: "q-first", value: "b" }])).error, /Duplicate response id/);
  assert.match(capability.normalizeResponse(publicDocument, envelope([{ id: "q-first", value: 12 }])).error, /must be text/);
  assert.match(capability.normalizeResponse(publicDocument, envelope([{ id: "q-first", value: "x".repeat(10_001) }])).error, /too long/);
  assert.match(capability.normalizeResponse(publicDocument, { schemaVersion: "forged", items: [] }).error, /schemaVersion/);
  assert.match(capability.normalizeResponse(publicDocument, { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [], modelAnswers: [] }).error, /unsupported fields/);

  const largeDocument = {
    parts: [{ interaction: { questions: Array.from({ length: 11 }, (_, index) => ({ id: `q-${index}`, prompt: `Prompt ${index}` })) } }],
  };
  assert.match(capability.normalizeResponse(largeDocument, envelope(
    largeDocument.parts[0].interaction.questions.map(({ id }) => ({ id, value: "x".repeat(10_000) })),
  )).error, /payload is too large/);
});

test("Teacher review projection combines pinned public prompts and protected Teacher answers", () => {
  const capability = nativeAssignmentCapability("open-response");
  const details = capability.teacherReviewProjection(publicDocument, {
    parts: [{ solution: { modelAnswers: [
      { questionId: "q-first", text: "Private model one" },
      { questionId: "q-second", text: "Private model two" },
    ] } }],
  }, {
    items: [{ id: "q-second", value: "Student two" }, { id: "q-first", value: "Student one" }],
  });
  assert.deepEqual(details.map(({ questionId, prompt, answer, modelAnswer }) => ({ questionId, prompt, answer, modelAnswer })), [
    { questionId: "q-first", prompt: "First prompt", answer: "Student one", modelAnswer: "Private model one" },
    { questionId: "q-second", prompt: "Second prompt", answer: "Student two", modelAnswer: "Private model two" },
  ]);
});

test("Open Response review exposes one or two protected model variants without auto-scoring", () => {
  const capability = nativeAssignmentCapability("open-response");
  const teacherDocument = { parts: [{ solution: { modelAnswers: [
    { questionId: "q-first", modelAnswerTexts: ["First\nvariant", "Alternative variant"] },
    { questionId: "q-second", modelAnswerTexts: ["Only variant"] },
  ] } }] };
  const review = capability.teacherReviewProjection(publicDocument, teacherDocument, { items: [] });
  assert.equal(capability.reviewMode, "teacher-reviewed");
  assert.equal(capability.evaluateResponse, undefined);
  assert.deepEqual(review[0].modelAnswers, ["First\nvariant", "Alternative variant"]);
  assert.equal(review[0].modelAnswer, "First\nvariant");
  assert.equal(Object.hasOwn(review[1], "modelAnswers"), false);
  assert.equal(review[1].modelAnswer, "Only variant");
});

test("native idempotency identity includes the pinned release and activity", () => {
  const common = { idempotencyKey: "assignment-request-1234" };
  const first = assignmentIdempotencyKey({ ...common, target: { kind: "published_native", releaseId: "release-a", nativeActivityId: "activity-a" } }, "teacher", null, "class", "class-a");
  const second = assignmentIdempotencyKey({ ...common, target: { kind: "published_native", releaseId: "release-b", nativeActivityId: "activity-a" } }, "teacher", null, "class", "class-a");
  assert.notEqual(first.value, second.value);
  assert.match(first.value, /published_native:release-a:activity-a$/);
});

test("migration 040 preserves legacy rows and constrains exactly one target family", async () => {
  const migration = await readFile(new URL("../database/040_published_native_assignment_runtime.sql", import.meta.url), "utf8");
  assert.match(migration, /target_kind text not null default 'legacy_activity'/i);
  assert.match(migration, /alter column activity_id drop not null/i);
  assert.match(migration, /target_kind = 'legacy_activity'[\s\S]*activity_id is not null[\s\S]*native_release_id is null/i);
  assert.match(migration, /target_kind = 'published_native'[\s\S]*activity_id is null[\s\S]*native_release_id is not null/i);
  assert.match(migration, /references book_component_releases\(id\) on delete restrict/i);
  assert.match(migration, /response_schema_version text/i);
  assert.match(migration, /response_payload jsonb/i);
});

test("generic endpoint layers delegate per-kind response behavior to the capability boundary", async () => {
  const files = await Promise.all([
    "assignment-actions.js", "submission-actions.js", "class-actions.js",
  ].map((name) => readFile(new URL(`../netlify/functions/_book-content/${name}`, import.meta.url), "utf8")));
  for (const source of files) assert.doesNotMatch(source, /kind\s*===?\s*["']open-response["']/);
});

test("Student assignment workspace adapts Drag & Drop targets to the existing controlled response envelope", async () => {
  const [source, contract] = await Promise.all([
    readFile(new URL("../src/components/lms/student/portal/StudentAssignmentWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/lms/student/runtime/studentSubmissionContract.js", import.meta.url), "utf8"),
  ]);
  assert.match(contract, /responseKind === "drag-drop"/);
  assert.match(contract, /flatMap\(\(panel\) => panel\.dropTargets/);
  assert.match(contract, /\["single-choice", "drag-drop"\]\.includes/);
  assert.match(source, /responses=\{nativeResponses\}/);
  assert.match(source, /onResponsesChange=\{\(responses\) => \{ setNativeResponses\(responses\); setDirty\(true\); \}\}/);
  assert.match(source, /buildNativeFinalSubmission/);
});

function immutableReleaseRow({ id = "10000000-0000-4000-8000-000000000090", releaseNumber = 3, fixture = {} } = {}) {
  const compiled = compilePublicationV2Fixture(fixture);
  return {
    id,
    book_package_id: "10000000-0000-4000-8000-000000000091",
    book_component_id: "10000000-0000-4000-8000-000000000092",
    package_slug: "ultimate-b2",
    package_title: "Ultimate B2",
    component_slug: "ultimate-b2-students-book",
    component_title: "Students Book",
    release_number: releaseNumber,
    release_schema_version: compiled.releaseSchemaVersion,
    compiler_id: compiled.compilerId,
    runtime_compatibility_sha256: compiled.compatibility,
    source_snapshot: compiled.sourceSnapshot,
    source_snapshot_sha256: compiled.sourceSnapshotSha256,
    public_projection: compiled.publicProjection,
    public_projection_sha256: compiled.publicProjectionSha256,
    teacher_projection: compiled.teacherProjection,
    teacher_projection_sha256: compiled.teacherProjectionSha256,
    asset_manifest: compiled.assetManifest,
    release_sha256: compiled.releaseSha256,
  };
}

function nativeSql(release) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("from book_component_releases release") || text.includes("from book_component_publication_heads head")) return [release];
    if (text.includes("from book_packages bp")) return [{ id: release.book_package_id }];
    if (text.includes("left join book_product_publication_heads")) return [{ package_id: release.book_package_id, package_slug: release.package_slug, package_title: release.package_title, product_release_id: null }];
    return [];
  };
  sql.calls = calls;
  return sql;
}

test("pinned native resolution verifies an exact published release without requiring the mutable head", async () => {
  const releaseA = immutableReleaseRow();
  const sql = nativeSql(releaseA);
  const target = await resolveNativeAssignmentTarget(sql, {
    id: "student", school_id: "school", role: "student",
  }, {
    kind: NATIVE_ASSIGNMENT_TARGET_KIND,
    releaseId: releaseA.id,
    nativeActivityId: publicationV2Fixture.openResponseId,
  }, { requireActive: false });
  assert.equal(target.row.id, releaseA.id);
  assert.equal(target.publicEntry.kind, "open-response");
  assert.equal(sql.calls[0].values[0], releaseA.id);
  assert.equal(sql.calls[0].values[1], false);

  const studentPayload = nativeTargetToStudent(target, publicationV2Fixture.openResponseId);
  assert.equal(studentPayload.releaseId, releaseA.id);
  assert.equal(studentPayload.entry.document.metadata.title, "Native Open Response");
  assert.doesNotMatch(JSON.stringify(studentPayload), new RegExp(publicationV2Fixture.teacherSentinel));
});

test("authorized active catalog exposes capability metadata but never Teacher documents", async () => {
  const release = immutableReleaseRow();
  const sql = nativeSql(release);
  const targets = await listPublishedNativeAssignmentTargets(sql, {
    id: "teacher", school_id: "school", role: "teacher",
  });
  const open = targets.find((item) => item.target.nativeActivityId === publicationV2Fixture.openResponseId);
  const image = targets.find((item) => item.target.nativeActivityId === publicationV2Fixture.imageId);
  const choice = targets.find((item) => item.target.nativeActivityId === publicationV2Fixture.singleChoiceId);
  assert.equal(open.assignable, true);
  assert.equal(open.reviewMode, "teacher-reviewed");
  assert.equal(image.assignable, false);
  assert.equal(image.reviewMode, "display-only");
  assert.equal(choice.assignable, true);
  assert.equal(choice.submittable, true);
  assert.equal(choice.reviewMode, "auto-scored");
  assert.equal(open.packageId, release.book_package_id);
  assert.equal(open.packageSlug, release.package_slug);
  assert.equal(open.componentId, release.book_component_id);
  assert.equal(open.componentSlug, release.component_slug);
  assert.doesNotMatch(JSON.stringify(targets), new RegExp(publicationV2Fixture.teacherSentinel));
  assert.match(sql.calls[1].text, /book_component_publication_heads/);
  assert.match(sql.calls[1].text, /book_component_publication_events/);
});

test("published-native catalog returns no release targets when the teacher has no authorized packages", async () => {
  const release = immutableReleaseRow();
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("from book_packages bp")) return [];
    if (text.includes("from book_component_publication_heads head")) return [release];
    throw new Error("unexpected query");
  };
  const targets = await listPublishedNativeAssignmentTargets(sql, {
    id: "teacher", school_id: "other-school", role: "teacher",
  });
  assert.deepEqual(targets, []);
  assert.equal(calls.length, 1);
});

test("immutable release verification diagnoses every document and aggregate hash mismatch after variant resolution", async (t) => {
  const columnsByCheck = {
    sourceSnapshotMatches: "source_snapshot_sha256",
    publicProjectionMatches: "public_projection_sha256",
    teacherProjectionMatches: "teacher_projection_sha256",
    releaseHashMatches: "release_sha256",
  };
  const allChecksPassing = {
    compatibilityMatches: true,
    ...Object.fromEntries(Object.keys(columnsByCheck).map((name) => [name, true])),
  };
  const storedCompatibilityAggregateByFailedCheck = {
    sourceSnapshotMatches: true,
    publicProjectionMatches: true,
    teacherProjectionMatches: true,
    releaseHashMatches: false,
  };

  for (const [failedCheck, column] of Object.entries(columnsByCheck)) {
    await t.test(failedCheck, () => {
      const release = immutableReleaseRow();
      release[column] = "0".repeat(64);
      let failure;
      try {
        verifyImmutableComponentRelease(release);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure instanceof ReleaseIntegrityError);
      assert.equal(failure.message, "release_integrity_failed");
      assert.equal(failure.code, "release_integrity_failed");
      assert.deepEqual(failure.integrityChecks, { ...allChecksPassing, [failedCheck]: false });
      assert.deepEqual(failure.failedIntegrityChecks, [failedCheck]);
      assert.equal(failure.storedCompatibilityReleaseHashMatches, storedCompatibilityAggregateByFailedCheck[failedCheck]);
      const diagnostic = JSON.stringify({
        integrityChecks: failure.integrityChecks,
        failedIntegrityChecks: failure.failedIntegrityChecks,
        storedCompatibilityReleaseHashMatches: failure.storedCompatibilityReleaseHashMatches,
      });
      assert.doesNotMatch(diagnostic, new RegExp(publicationV2Fixture.teacherSentinel));
      assert.doesNotMatch(diagnostic, /"publicProjection":/);
      assert.doesNotMatch(diagnostic, /"teacherProjection":/);
      assert.doesNotMatch(diagnostic, /"sourceSnapshot":/);
    });
  }
});

test("an unknown stored compatibility identity remains rejected even when its aggregate hash matches", () => {
  const release = immutableReleaseRow();
  const publicationCompatibility = "0".repeat(64);
  release.runtime_compatibility_sha256 = publicationCompatibility;
  release.public_projection = structuredClone(release.public_projection);
  release.public_projection.compatibility = publicationCompatibility;
  release.public_projection_sha256 = builderDocumentSha256(release.public_projection);
  release.release_sha256 = builderDocumentSha256({
    compatibility: publicationCompatibility,
    sourceSnapshot: release.source_snapshot,
    publicProjection: release.public_projection,
    teacherProjection: release.teacher_projection,
  });

  assert.throws(
    () => verifyImmutableComponentRelease(release),
    (error) => {
      assert.ok(error instanceof ReleaseCompatibilityVariantError);
      assert.equal(error.code, "release_integrity_failed");
      assert.equal("storedCompatibilityReleaseHashMatches" in error, false);
      return true;
    },
  );
});

test("valid immutable releases still verify normally", () => {
  const release = immutableReleaseRow();
  const verified = verifyImmutableComponentRelease(release);
  assert.equal(verified.compiler.compilerId, release.compiler_id);
  assert.deepEqual(verified.publicProjection, release.public_projection);
  assert.deepEqual(verified.teacherProjection, release.teacher_projection);
});

test("catalog verification logs only allowlisted release identity and boolean integrity diagnostics", async (t) => {
  const release = immutableReleaseRow();
  release.teacher_projection_sha256 = "0".repeat(64);
  const sql = nativeSql(release);
  const logCalls = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logCalls.push(args);
  t.after(() => { console.error = originalConsoleError; });

  await assert.rejects(
    listPublishedNativeAssignmentTargets(sql, { id: "teacher", school_id: "school", role: "teacher" }),
    (error) => error instanceof ReleaseIntegrityError && error.failedIntegrityChecks[0] === "teacherProjectionMatches",
  );
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].length, 1);
  const diagnostic = logCalls[0][0];
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "bookPackageId",
    "bookPackageSlug",
    "compilerId",
    "componentId",
    "componentSlug",
    "failedIntegrityChecks",
    "integrityChecks",
    "releaseId",
    "releaseNumber",
    "releaseSchemaVersion",
    "storedCompatibilityReleaseHashMatches",
  ].sort());
  assert.deepEqual(diagnostic, {
    releaseId: release.id,
    bookPackageId: release.book_package_id,
    bookPackageSlug: release.package_slug,
    componentId: release.book_component_id,
    componentSlug: release.component_slug,
    releaseNumber: release.release_number,
    compilerId: release.compiler_id,
    releaseSchemaVersion: release.release_schema_version,
    integrityChecks: {
      compatibilityMatches: true,
      sourceSnapshotMatches: true,
      publicProjectionMatches: true,
      teacherProjectionMatches: false,
      releaseHashMatches: true,
    },
    failedIntegrityChecks: ["teacherProjectionMatches"],
    storedCompatibilityReleaseHashMatches: true,
  });
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, new RegExp(publicationV2Fixture.teacherSentinel));
  assert.doesNotMatch(serialized, /"publicProjection":/);
  assert.doesNotMatch(serialized, /"teacherProjection":/);
  assert.doesNotMatch(serialized, /"sourceSnapshot":/);
});

test("an assignment pinned to Release A keeps Release A after the publication head moves to Release B", async () => {
  const releaseA = immutableReleaseRow({
    id: "10000000-0000-4000-8000-000000000081",
    releaseNumber: 3,
    fixture: { prompt: "Release A prompt", teacherAnswer: "Release A protected answer" },
  });
  const releaseB = immutableReleaseRow({
    id: "10000000-0000-4000-8000-000000000082",
    releaseNumber: 4,
    fixture: { prompt: "Release B prompt", teacherAnswer: "Release B protected answer" },
  });
  const activeHead = releaseB.id;
  const assignment = { native_release_id: releaseA.id, native_activity_id: publicationV2Fixture.openResponseId };
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("from book_component_releases release")) return [values[0] === releaseA.id ? releaseA : releaseB];
    if (text.includes("from book_packages bp")) return [{ id: releaseA.book_package_id }];
    return [];
  };
  const resolved = await resolveNativeAssignmentTarget(sql, { id: "student", school_id: "school", role: "student" }, {
    kind: NATIVE_ASSIGNMENT_TARGET_KIND,
    releaseId: assignment.native_release_id,
    nativeActivityId: assignment.native_activity_id,
  }, { requireActive: false });
  assert.equal(activeHead, releaseB.id);
  assert.equal(resolved.row.id, releaseA.id);
  assert.equal(resolved.publicEntry.document.parts[0].interaction.questions[0].prompt, "Release A prompt");
  assert.equal(resolved.teacherEntry.document.parts[0].solution.modelAnswers[0].text, "Release A protected answer");
  assert.equal(calls[0].values[1], false);
});

function nativeSubmissionSql(release, { inserted = true, assignmentOverrides = {}, enrolled = true, insertedStatus = "awaiting_review" } = {}) {
  const assignment = {
    id: "10000000-0000-4000-8000-000000000093",
    target_kind: "published_native",
    activity_id: null,
    native_release_id: release.id,
    native_activity_id: publicationV2Fixture.openResponseId,
    status: "assigned",
    student_id: null,
    class_id: "10000000-0000-4000-8000-000000000094",
    school_id: "10000000-0000-4000-8000-000000000095",
    due_at: null,
    ...assignmentOverrides,
  };
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("with assignment_state as materialized")) return [{
      assignment_exists: true,
      assignment_status: "assigned",
      due_at: null,
      submission: inserted ? { id: "10000000-0000-4000-8000-000000000096", status: insertedStatus } : null,
    }];
    if (text.includes("from activity_assignments aa")) return [assignment];
    if (text.includes("from class_students")) return enrolled ? [{ id: "enrollment" }] : [];
    if (text.includes("from book_component_releases release")) return [release];
    if (text.includes("from book_packages bp")) return [{ id: release.book_package_id }];
    return [];
  };
  sql.calls = calls;
  sql.assignmentLifecycleTransaction = async (_assignmentId, callback) => callback(sql);
  return { sql, assignment };
}

test("native submission rejects client score ownership and stores one versioned payload", async () => {
  const release = immutableReleaseRow();
  const { sql, assignment } = nativeSubmissionSql(release);
  const questionId = release.public_projection.nativeActivities[publicationV2Fixture.openResponseId]
    .document.parts[0].interaction.questions[0].id;
  const response = await submitActivity(sql, {
    assignmentId: assignment.id,
    target: { kind: "published_native", releaseId: release.id, nativeActivityId: publicationV2Fixture.openResponseId },
    score: 100,
    response: { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: questionId, value: "Student text" }] },
  }, { id: "10000000-0000-4000-8000-000000000097", school_id: assignment.school_id, role: "student" });
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /score fields/);
  const accepted = await submitActivity(sql, {
    assignmentId: assignment.id,
    target: { kind: "published_native", releaseId: release.id, nativeActivityId: publicationV2Fixture.openResponseId },
    response: { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: questionId, value: "Student text" }] },
  }, { id: "10000000-0000-4000-8000-000000000097", school_id: assignment.school_id, role: "student" });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(JSON.parse(accepted.body).submission, {
    id: "10000000-0000-4000-8000-000000000096",
    status: "awaiting_review",
    scorePercent: null,
    correctCount: null,
    totalCount: null,
  });
  const insert = sql.calls.find((call) => call.text.includes("response_schema_version, response_payload"));
  assert.ok(insert);
  assert.match(insert.text, /activity_id, student_id, answers/);
  assert.equal(insert.values.includes(100), false);
  assert.equal(sql.calls.some((call) => call.text.includes("insert into student_answers")), false);
});

test("Single Choice submission persists only server-derived score and count values", async () => {
  const release = immutableReleaseRow();
  const { sql, assignment } = nativeSubmissionSql(release, { assignmentOverrides: { native_activity_id: publicationV2Fixture.singleChoiceId }, insertedStatus: "submitted" });
  const questions = release.public_projection.nativeActivities[publicationV2Fixture.singleChoiceId].document.parts[0].interaction.questions;
  const response = await submitActivity(sql, {
    assignmentId: assignment.id,
    response: { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: questions[0].id, value: questions[0].options[1].id }] },
  }, { id: "10000000-0000-4000-8000-000000000097", school_id: assignment.school_id, role: "student" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).submission, { id: "10000000-0000-4000-8000-000000000096", status: "submitted", scorePercent: 50, correctCount: 1, totalCount: 2 });
  const insert = sql.calls.find((call) => call.text.includes("response_schema_version, response_payload"));
  assert.ok(insert.values.includes(50));
  assert.ok(insert.values.includes(1));
  assert.ok(insert.values.includes(2));
  assert.ok(insert.values.includes("submitted"));
  assert.equal(JSON.parse(insert.values.find((value) => typeof value === "string" && value.includes('"kind":"single-choice"'))).kind, "single-choice");
});

test("native submission rejects forged target and unknown response before writing", async () => {
  const release = immutableReleaseRow();
  const { sql, assignment } = nativeSubmissionSql(release);
  const user = { id: "10000000-0000-4000-8000-000000000097", school_id: assignment.school_id, role: "student" };
  const forged = await submitActivity(sql, {
    assignmentId: assignment.id,
    target: { kind: "published_native", releaseId: "10000000-0000-4000-8000-000000000099", nativeActivityId: publicationV2Fixture.openResponseId },
    response: { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [] },
  }, user);
  assert.equal(forged.statusCode, 400);
  assert.match(JSON.parse(forged.body).error, /does not match/);

  const second = nativeSubmissionSql(release);
  const unknown = await submitActivity(second.sql, {
    assignmentId: second.assignment.id,
    response: { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [{ id: "forged-question", value: "x" }] },
  }, user);
  assert.equal(unknown.statusCode, 400);
  assert.match(JSON.parse(unknown.body).error, /Unexpected response id/);
  assert.equal(second.sql.calls.some((call) => call.text.includes("insert into activity_submissions")), false);
});

test("native submission preserves closed, deadline, enrollment, and tenant boundaries before writing", async () => {
  const release = immutableReleaseRow();
  const student = { id: "10000000-0000-4000-8000-000000000097", school_id: "10000000-0000-4000-8000-000000000095", role: "student" };
  const request = (assignmentId) => ({
    assignmentId,
    response: { schemaVersion: NATIVE_RESPONSE_SCHEMA_VERSION, items: [] },
  });

  const closed = nativeSubmissionSql(release, { assignmentOverrides: { status: "closed" } });
  const closedResponse = await submitActivity(closed.sql, request(closed.assignment.id), student);
  assert.equal(closedResponse.statusCode, 409);

  const expired = nativeSubmissionSql(release, { assignmentOverrides: { due_at: "2020-01-01T00:00:00.000Z" } });
  const expiredResponse = await submitActivity(expired.sql, request(expired.assignment.id), student);
  assert.equal(expiredResponse.statusCode, 403);

  const unenrolled = nativeSubmissionSql(release, { enrolled: false });
  const unenrolledResponse = await submitActivity(unenrolled.sql, request(unenrolled.assignment.id), student);
  assert.equal(unenrolledResponse.statusCode, 403);

  const crossTenant = nativeSubmissionSql(release);
  const crossTenantResponse = await submitActivity(crossTenant.sql, request(crossTenant.assignment.id), {
    ...student,
    school_id: "10000000-0000-4000-8000-000000000099",
  });
  assert.equal(crossTenantResponse.statusCode, 403);

  for (const candidate of [closed, expired, unenrolled, crossTenant]) {
    assert.equal(candidate.sql.calls.some((call) => call.text.includes("insert into activity_submissions")), false);
    assert.equal(candidate.sql.calls.some((call) => call.text.includes("from book_component_releases release")), false);
  }
});

test("Teacher creation persists the canonical active release target and rejects display-only Image", async () => {
  const release = immutableReleaseRow();
  const calls = [];
  const teacher = { id: "10000000-0000-4000-8000-000000000097", school_id: "10000000-0000-4000-8000-000000000095", role: "teacher" };
  const classId = "10000000-0000-4000-8000-000000000094";
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("from book_component_releases release")) return [release];
    if (text.includes("from book_packages bp")) return [{ id: release.book_package_id }];
    if (text.includes("from classes c")) return [{ id: classId, teacher_id: teacher.id, school_id: teacher.school_id }];
    if (/from classes\s+where/.test(text)) return [{ id: classId, status: "active", book_package_id: release.book_package_id, school_id: teacher.school_id }];
    if (text.includes("insert into activity_assignments")) return [{
      id: "10000000-0000-4000-8000-000000000098",
      target_kind: "published_native",
      activity_id: null,
      native_release_id: release.id,
      native_activity_id: publicationV2Fixture.openResponseId,
      teacher_id: teacher.id,
      class_id: classId,
      title: "Native Open Response",
    }];
    return [];
  };
  const body = {
    idempotencyKey: "native-create-request",
    classIds: [classId],
    target: { kind: "published_native", releaseId: release.id, nativeActivityId: publicationV2Fixture.openResponseId },
  };
  const created = await createAssignment(sql, body, teacher);
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(JSON.parse(created.body).assignment.nativeReleaseId, release.id);
  const insert = calls.find((call) => call.text.includes("insert into activity_assignments"));
  assert.match(insert.text, /target_kind/);
  assert.ok(insert.values.includes(release.id));
  assert.ok(insert.values.includes(publicationV2Fixture.openResponseId));
  const releaseLookup = calls.find((call) => call.text.includes("from book_component_releases release"));
  assert.equal(releaseLookup.values[1], true);

  const displayOnly = await createAssignment(sql, {
    ...body,
    idempotencyKey: "native-image-request",
    target: { kind: "published_native", releaseId: release.id, nativeActivityId: publicationV2Fixture.imageId },
  }, teacher);
  assert.equal(displayOnly.statusCode, 403);
});
