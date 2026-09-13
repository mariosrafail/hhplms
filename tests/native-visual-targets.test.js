import assert from "node:assert/strict";
import test from "node:test";
import { sharedFive, sharedFiveTeacher } from "./fixtures/native-runtime-regressions/shared-five-data.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { duplicateNativeMultiPartSection, projectNativeMultiPartChild, nativeMultiPartAssetRequirements } from "../src/data/native-activities/nativeMultiPart.js";
import { updateMultiPartSharedBackground, pruneMultiPartAssetRoots } from "../src/apps/book-builder/hosted/nativeMultiPartAuthoring.js";
import { restoreNativeMarkWordsResponses, toggleNativeMarkWordsResponse } from "../src/data/native-activities/nativeMarkWordsRuntime.js";
import { normalizeMarkWordsResponse, scoreMarkWordsResponse } from "../netlify/functions/_book-content/mark-words-response.js";
import { buildNativeFinalSubmission, restoreNativeSubmissionResponses } from "../src/components/lms/student/runtime/studentSubmissionContract.js";
import { removeVisualTarget } from "../src/data/native-activities/nativeMarkWordsVisualAuthoring.js";

const kind = resolveNativeActivityKind("multi-part");
const visualKind = resolveNativeActivityKind("mark-the-words");
const section = sharedFive.parts[0].interaction.sections.find((entry) => entry.kind === "mark-the-words");
const fixture = () => structuredClone(projectNativeMultiPartChild(sharedFive, section, sharedFiveTeacher));

test("five real shared children round-trip through the server registry, readiness and asset graph", () => {
  const pub = kind.normalizePublic(JSON.parse(JSON.stringify(sharedFive)));
  const teacher = kind.normalizeTeacher(JSON.parse(JSON.stringify(sharedFiveTeacher)));
  assert.equal(kind.validatePair(pub, teacher), true);
  assert.deepEqual(kind.assessReadiness(pub, teacher).issues, []);
  assert.equal(pub.parts[0].interaction.sections.length, 5);
  assert.ok(nativeMultiPartAssetRequirements(pub).some((entry) => entry.slot === "graphic"));
  assert.doesNotMatch(JSON.stringify(pub), /correctTargetIds|correctWordIds|isCorrect/);
});

test("visual targets use no passage and No graphic selections survive submit, grade and restore", () => {
  const { publicDocument: pub, teacherDocument: teacher } = fixture();
  assert.equal(visualKind.validatePair(visualKind.normalizePublic(pub), visualKind.normalizeTeacher(teacher)), true);
  const interaction = pub.parts[0].interaction; const panel = interaction.presentation.panels[0];
  assert.equal(Object.hasOwn(interaction, "items"), false);
  const wrong = panel.hotspots[2]; assert.equal(wrong.graphicAssetSlot, null);
  const responses = toggleNativeMarkWordsResponse(pub, {}, panel.id, wrong.targetId);
  const submission = buildNativeFinalSubmission({ assignmentId: "assignment", target: { nativeKind: "mark-the-words", entry: { document: pub }, capability: { responseSchemaVersion: "native-response.v1" } }, responses });
  const normalized = normalizeMarkWordsResponse(pub, submission.response);
  assert.equal(normalized.error, undefined);
  assert.deepEqual(restoreNativeSubmissionResponses(normalized.payload), responses);
  assert.deepEqual(restoreNativeMarkWordsResponses(pub, responses), responses);
  assert.equal(scoreMarkWordsResponse(pub, teacher, normalized.payload).scorePercent, 0);
  const correct = { schemaVersion: "native-response.v1", items: [{ id: panel.id, value: teacher.parts[0].solution.answers[0].correctTargetIds }] };
  assert.equal(scoreMarkWordsResponse(pub, teacher, normalizeMarkWordsResponse(pub, correct).payload).scorePercent, 100);
  assert.ok(normalizeMarkWordsResponse(pub, { ...correct, items: [{ id: panel.id, value: [wrong.targetId, wrong.targetId] }] }).error);
});

test("visual exact keys, wrong roles, canvas bounds, ambiguous regions and reserved banks stay guarded", () => {
  for (const mutate of [
    (doc) => { doc.parts[0].interaction.targets[0].correct = true; },
    (doc) => { doc.parts[0].interaction.presentation.panels[0].hotspots[0].graphicAssetSlot = "missing"; },
    (doc) => { doc.parts[0].interaction.presentation.panels[0].hotspots[0].markArea.y = 582; },
    (doc) => { doc.parts[0].interaction.presentation.panels[0].hotspots[1].area.x = 40; },
  ]) { const { publicDocument } = fixture(); mutate(publicDocument); assert.throws(() => visualKind.normalizePublic(publicDocument)); }
  for (const kindName of ["open-response", "complete-sentences", "mark-the-words"]) {
    const pub = structuredClone(sharedFive); const child = pub.parts[0].interaction.sections.find((entry) => entry.kind === kindName).interaction;
    const area = kindName === "open-response" ? child.questions[0].responseRegion.area : child.presentation.panels[0].hotspots[0].area;
    area.y = 455;
    assert.throws(() => kind.normalizePublic(pub));
  }
  const oldVersion = structuredClone(sharedFive); oldVersion.parts[0].interaction.schemaVersion = "multi-part.v1";
  assert.throws(() => kind.normalizePublic(oldVersion), /version/);
});

test("duplicate retains graphics and remaps private target bindings; removal cleans only unused assets", () => {
  const privateSection = sharedFiveTeacher.parts[0].solution.sections.find((entry) => entry.id === section.id);
  const copy = duplicateNativeMultiPartSection(section, privateSection);
  assert.notEqual(copy.section.interaction.targets[0].id, section.interaction.targets[0].id);
  assert.equal(copy.privateSection.solution.answers[0].correctTargetIds[0], copy.section.interaction.targets[0].id);
  assert.equal(copy.section.interaction.presentation.panels[0].hotspots[0].graphicAssetSlot, "graphic");
  const { publicDocument: pub, teacherDocument: teacher } = fixture(); const panel = pub.parts[0].interaction.presentation.panels[0];
  removeVisualTarget(pub, teacher, panel.id, panel.hotspots[0].id);
  assert.ok(pub.assets.some((asset) => asset.slot === "graphic"));
  removeVisualTarget(pub, teacher, panel.id, panel.hotspots[0].id);
  assert.ok(!pub.assets.some((asset) => asset.slot === "graphic"));
  visualKind.validatePair(visualKind.normalizePublic(pub), visualKind.normalizeTeacher(teacher));
});

test("shared background replacement propagates to all five without moving authored regions", () => {
  const pub = structuredClone(sharedFive); const original = JSON.stringify(pub.parts[0].interaction.sections.map((entry) => entry.interaction.questions || entry.interaction.presentation?.panels?.[0].hotspots || entry.interaction.panels[0].dropTargets));
  const reference = { ...pub.assets[0], assetId: "10000000-0000-4000-8000-000000000003", slot: "replacement" }; pub.assets.push(reference);
  updateMultiPartSharedBackground(pub, pub.parts[0].interaction.panels[0].id, reference, { width: 1024, height: 582 }); pruneMultiPartAssetRoots(pub);
  assert.equal(JSON.stringify(pub.parts[0].interaction.sections.map((entry) => entry.interaction.questions || entry.interaction.presentation?.panels?.[0].hotspots || entry.interaction.panels[0].dropTargets)), original);
  kind.normalizePublic(pub);
  updateMultiPartSharedBackground(pub, pub.parts[0].interaction.panels[0].id, reference, { width: 500, height: 300 });
  assert.throws(() => kind.normalizePublic(pub));
});


test("immutable publication retains versioned native targets, marker dependencies and private keys without draft fallback", async () => {
  const { studentsBookV3Sources, studentsBookV3ReleaseRow } = await import("./fixtures/students-book-publication-v3.js");
  const { appendMultiPartPublicationFixture } = await import("./fixtures/native-multi-part-publication.js");
  const { compileStudentsBookReleaseV3 } = await import("../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js");
  const { verifyImmutableComponentRelease } = await import("../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js");
  const historical = compileStudentsBookReleaseV3(studentsBookV3Sources());
  const historicalRow = studentsBookV3ReleaseRow(historical);
  const sources = appendMultiPartPublicationFixture(studentsBookV3Sources(), { publicDocument: sharedFive, teacherDocument: sharedFiveTeacher });
  const compiled = compileStudentsBookReleaseV3(sources);
  const release = studentsBookV3ReleaseRow(compiled);
  assert.equal(compiled.publicProjection.nativeActivities[sharedFive.activityId].document.parts[0].interaction.schemaVersion, "multi-part.v2");
  assert.ok(compiled.assetManifest.some((asset) => asset.sha256 === "b".repeat(64)));
  assert.doesNotMatch(JSON.stringify(compiled.publicProjection), /correctTargetIds|isCorrect/);
  assert.match(JSON.stringify(compiled.teacherProjection), /correctTargetIds/);
  sources.native.activities = {}; sources.documents.hotspots.payload.pages = {};
  assert.deepEqual(verifyImmutableComponentRelease(release).publicProjection, compiled.publicProjection);
  assert.deepEqual(verifyImmutableComponentRelease(historicalRow).publicProjection, historical.publicProjection);
  assert.deepEqual(compileStudentsBookReleaseV3(studentsBookV3Sources()), historical);
});


test("every shared child duplicate remaps both its private key and derived response identities", () => {
  for (const original of sharedFive.parts[0].interaction.sections) {
    const privateSection = sharedFiveTeacher.parts[0].solution.sections.find((entry) => entry.id === original.id);
    const copied = duplicateNativeMultiPartSection(original, privateSection);
    const root = structuredClone(sharedFive); root.parts[0].interaction.sections.push(copied.section);
    const teacher = structuredClone(sharedFiveTeacher); teacher.parts[0].solution.sections.push(copied.privateSection);
    const pair = projectNativeMultiPartChild(root, copied.section, teacher);
    const adapter = resolveNativeActivityKind(original.kind);
    const pub = adapter.normalizePublic(pair.publicDocument); const key = adapter.normalizeTeacher(pair.teacherDocument);
    assert.equal(adapter.validatePair(pub, key), true);
    if (original.kind === "open-response") {
      const question = pub.parts[0].interaction.questions[0];
      assert.equal(question.responseRegion.id, `${question.id}-response`);
      assert.notEqual(question.id, original.interaction.questions[0].id);
    }
  }
});
