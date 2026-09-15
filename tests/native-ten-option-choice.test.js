import assert from "node:assert/strict";
import test from "node:test";
import { tenOptionChoicePair, choiceInteraction, choiceSolution, choiceId } from "./fixtures/ten-option-choice.js";
import { resolveNativeActivityKind } from "../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../src/data/native-activities/nativeActivityRuntimeValidation.js";
import { NATIVE_SINGLE_CHOICE_LIMITS, nativeSingleChoiceCorrectOptionIds, normalizeNativeSingleChoiceInteraction } from "../src/data/native-activities/nativeSingleChoice.js";
import { generateNativeBulkCandidate, parseNativeSingleChoiceBulk } from "../src/data/native-activities/nativeBulkAuthoring.js";
import { generateNativeSingleChoiceHotspotImportCandidate, parseNativeSingleChoiceHotspotBulk } from "../src/data/native-activities/nativeSingleChoiceHotspotBulkAuthoring.js";
import { alignNativeSingleChoiceAnswers, removeNativeSingleChoiceOption } from "../src/data/native-activities/nativeSingleChoiceAuthoring.js";
import { nativeAssignmentCapability } from "../netlify/functions/_book-content/native-assignment-runtime.js";

for (const kind of ["single-choice", "multi-part", "oldschool-listening"]) for (const visual of [false, true]) {
  test(`${kind} ${visual ? "visual/canvas" : "flow"}: 6–10 options preserve public/private identities; 11 is rejected`, () => {
    const definition = resolveNativeActivityKind(kind);
    for (const count of [6, 7, 8, 9, 10]) for (const multiple of [false, true]) {
      const pair = tenOptionChoicePair(kind, { count, multiple, visual });
      const options = { kind, activityId: pair.publicDocument.activityId };
      assert.equal(definition.validatePair(pair.publicDocument, pair.teacherDocument), true);
      const publicDocument = normalizeNativeRuntimePublicDocument(pair.publicDocument, options);
      const teacherDocument = normalizeNativeRuntimeTeacherDocument(pair.teacherDocument, { ...options, publicDocument });
      assert.deepEqual(choiceInteraction({ publicDocument }).questions, choiceInteraction(pair).questions);
      assert.deepEqual(choiceSolution({ teacherDocument }).correctAnswers, choiceSolution(pair).correctAnswers);
      assert.doesNotMatch(JSON.stringify(publicDocument), /correctOptionIds?|correctAnswers|solution/);
    }
    const overflow = tenOptionChoicePair(kind, { count: 11, visual });
    assert.throws(() => definition.normalizePublic(overflow.publicDocument), /invalid/);
    assert.throws(() => normalizeNativeRuntimePublicDocument(overflow.publicDocument, { kind }), /invalid/);
  });
}

test("ten-option validation rejects invalid IDs, duplicates, unknown fields and wrong selection cardinality", () => {
  const definition = resolveNativeActivityKind("single-choice");
  for (const corrupt of [q => q.options[9].id = "invalid", q => q.options[9].id = q.options[0].id, q => q.options[9].answer = true]) {
    const pair = tenOptionChoicePair(); corrupt(choiceInteraction(pair).questions[0]); assert.throws(() => definition.validatePair(pair.publicDocument, pair.teacherDocument));
  }
  for (const values of [[choiceId("opt", 10), choiceId("opt", 10)], [choiceId("opt", 11)], [choiceId("opt", 9), choiceId("opt", 10)]]) {
    const pair = tenOptionChoicePair(); choiceSolution(pair).correctAnswers = [{ questionId: choiceId("q", 1), correctOptionIds: values }];
    assert.throws(() => definition.validatePair(pair.publicDocument, pair.teacherDocument));
  }
  assert.equal(NATIVE_SINGLE_CHOICE_LIMITS.optionsMinimum, 2);
  assert.deepEqual(normalizeNativeSingleChoiceInteraction({ kind: "single-choice", questions: [] }).questions, []);
  const draft = tenOptionChoicePair(); choiceInteraction(draft).questions[0].options = [];
  assert.deepEqual(definition.normalizePublic(draft.publicDocument).parts[0].interaction.questions[0].options, [], "incomplete drafts remain representable");
});

test("bulk text accepts every 7–10 boundary, including correct option 10 and multiple 7–10", () => {
  for (const count of [7, 8, 9, 10]) for (const multiple of [false, true]) {
    const source = `1. Choose\n${Array.from({ length: count }, (_, i) => `${i === count - 1 || multiple && i >= 6 ? "*" : ""}Answer ${i + 1}`).join("\n")}`;
    assert.equal(parseNativeSingleChoiceBulk(source)[0].options.length, count);
    const pair = tenOptionChoicePair("single-choice", { count: 6 });
    let next = 200;
    const result = generateNativeBulkCandidate({ kind: "single-choice", source, ...pair, replaceExisting: true, createId: prefix => choiceId(prefix, ++next) });
    assert.equal(choiceInteraction(result).questions[0].options.length, count);
    assert.equal(nativeSingleChoiceCorrectOptionIds(choiceSolution(result).correctAnswers[0]).at(-1), choiceInteraction(result).questions[0].options.at(-1).id);
    assert.deepEqual(choiceInteraction(result).questions[0].options.slice(0, 6).map(option => option.id), choiceInteraction(pair).questions[0].options.map(option => option.id));
  }
  assert.throws(() => parseNativeSingleChoiceBulk(`1. Too many\n${Array.from({ length: 11 }, (_, i) => `${i === 10 ? "*" : ""}Answer ${i + 1}`).join("\n")}`), /line 12: no more than 10 options/);
});

test("20 × 10 visual options need 200 bounded hotspots; ordinal 1.10 remains distinct from 1.1", () => {
  const pair = tenOptionChoicePair("single-choice", { visual: true, questionCount: 20 });
  const definition = resolveNativeActivityKind("single-choice");
  assert.equal(NATIVE_SINGLE_CHOICE_LIMITS.hotspots, 200);
  assert.equal(definition.validatePair(pair.publicDocument, pair.teacherDocument), true);
  const source = `SOURCE 1024x1100\nPANEL 1\n${Array.from({ length: 20 }, (_, q) => Array.from({ length: 10 }, (_, i) => `${q + 1}.${i + 1} x=${40 + i * 90} y=${40 + q * 50} width=75 height=35`).join("\n")).join("\n")}`;
  assert.equal(parseNativeSingleChoiceHotspotBulk(source).hotspotCount, 200);
  const imported = generateNativeSingleChoiceHotspotImportCandidate({ source, publicDocument: pair.publicDocument, replaceExistingPanels: true });
  assert.equal(imported.summary.preservedIds, 200);
  assert.deepEqual(imported.publicDocument, pair.publicDocument);
  const hotspots = choiceInteraction(imported).presentation.panels[0].hotspots;
  assert.notEqual(hotspots[0].optionId, hotspots[9].optionId);
  assert.equal(hotspots[9].optionId, choiceId("opt", 10));
  assert.throws(() => parseNativeSingleChoiceHotspotBulk(source + "\n1.11 x=0 y=0 width=1 height=1"), /option ordinal.*1 to 10/);
  assert.throws(() => parseNativeSingleChoiceHotspotBulk(source + "\n21.1 x=0 y=0 width=1 height=1"), /question ordinal.*1 to 20/);
  assert.throws(() => parseNativeSingleChoiceHotspotBulk(source + "\n1.10 x=0 y=0 width=1 height=1"), /duplicated/);
  hotspots.push({ ...hotspots[0], id: choiceId("hot", 9999) });
  assert.throws(() => definition.normalizePublic(imported.publicDocument), /invalid/);
});

test("reorder and delete preserve option/hotspot identities and canonical multiple-answer order", () => {
  const pair = tenOptionChoicePair("single-choice", { visual: true, multiple: true });
  const question = choiceInteraction(pair).questions[0];
  const hotspots = structuredClone(choiceInteraction(pair).presentation.panels[0].hotspots);
  question.options.reverse(); alignNativeSingleChoiceAnswers(pair.publicDocument, pair.teacherDocument);
  assert.deepEqual(nativeSingleChoiceCorrectOptionIds(choiceSolution(pair).correctAnswers[0]), [10, 9, 8, 7].map(n => choiceId("opt", n)));
  assert.deepEqual(choiceInteraction(pair).presentation.panels[0].hotspots, hotspots);
  removeNativeSingleChoiceOption(pair.publicDocument, pair.teacherDocument, question.id, choiceId("opt", 8));
  assert.deepEqual(nativeSingleChoiceCorrectOptionIds(choiceSolution(pair).correctAnswers[0]), [10, 9, 7].map(n => choiceId("opt", n)));
  assert.deepEqual(choiceInteraction(pair).presentation.panels[0].hotspots, hotspots.filter(hotspot => hotspot.optionId !== choiceId("opt", 8)));
  assert.equal(resolveNativeActivityKind("single-choice").validatePair(pair.publicDocument, pair.teacherDocument), true);
});

for (const kind of ["single-choice", "oldschool-listening"]) test(`${kind}: tenth and multiple 7–10 responses grade strictly`, () => {
  for (const multiple of [false, true]) {
    const pair = tenOptionChoicePair(kind, { multiple }); const question = choiceInteraction(pair).questions[0];
    const capability = nativeAssignmentCapability(kind, pair.publicDocument);
    const value = multiple ? question.options.slice(-4).map(option => option.id) : question.options[9].id;
    const envelope = { schemaVersion: "native-response.v1", items: [{ id: question.id, value }] };
    const result = capability.normalizeResponse(pair.publicDocument, envelope); assert.ok(!result.error, result.error);
    assert.equal(capability.evaluateResponse(pair.publicDocument, pair.teacherDocument, result.payload).scorePercent, 100);
    for (const invalid of [multiple ? [choiceId("opt", 11)] : choiceId("opt", 11), multiple ? [value[0], value[0]] : [value]]) assert.ok(capability.normalizeResponse(pair.publicDocument, { ...envelope, items: [{ id: question.id, value: invalid }] }).error);
  }
});
