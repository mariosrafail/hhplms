import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeTeacherActivityPresentationState } from "../src/apps/android-teacher-offline/teacherActivityPresentation.js";
import {
  ultimateB2TeacherAppAuthoring,
  ultimateB2TeacherRevealControlDefinitions,
} from "../src/data/ultimate-b2/teacherAppAuthoring.js";

test("publisher reveal controls use canonical active, pressed and disabled UI Controller bindings", () => {
  assert.deepEqual(ultimateB2TeacherRevealControlDefinitions.map(({ id, controlId }) => ({ id, controlId })), [
    { id: "reload", controlId: "reveal:reload" },
    { id: "show-all", controlId: "reveal:show-all" },
    { id: "show-next", controlId: "reveal:show-next" },
  ]);
  for (const control of ultimateB2TeacherAppAuthoring.shell.revealControls) {
    assert.equal(control.active.role, "navigation-control");
    assert.equal(control.pressed.role, "navigation-control");
    assert.equal(control.disabled.role, "navigation-control");
    assert.match(control.active.repositoryPath, new RegExp(`navibar-${control.id}-active\\.png$`));
    assert.match(control.pressed.repositoryPath, new RegExp(`navibar-${control.id}-pressed\\.png$`));
    assert.match(control.disabled.repositoryPath, new RegExp(`navibar-${control.id}-disabled\\.png$`));
  }
});

test("the Teacher runtime resolver eagerly bundles all nine reveal-control state images", async () => {
  const resolver = await readFile("src/data/ultimate-b2/ultimateB2AuthoredAssetUrls.js", "utf8");
  for (const control of ["reload", "show-all", "show-next"]) {
    for (const state of ["active", "pressed", "disabled"]) assert.match(resolver, new RegExp(`navibar-${control}-${state}\\.png`));
  }
});

test("the shell presentation contract exposes progress but strips answer-bearing activity data", () => {
  assert.deepEqual(normalizeTeacherActivityPresentationState({
    view: "text",
    panelIndex: 9,
    panelCount: 2,
    panelNavigationActive: true,
    reveal: { supported: true, total: 3, revealed: 8, pristine: false, answerText: "private", ids: ["q1"] },
    solutions: { q1: "private" },
  }), {
    view: "text",
    panelIndex: 1,
    panelCount: 2,
    panelNavigationActive: true,
    reveal: { supported: true, total: 3, revealed: 3, pristine: false },
    readableTextAvailable: false,
    videoAvailable: false,
    audioFocusActive: false,
  });
  assert.equal(normalizeTeacherActivityPresentationState({ reveal: { supported: false, total: 9 } }).reveal, null);
  assert.equal(normalizeTeacherActivityPresentationState({ audioFocusActive: true, privateAnswer: "hidden" }).audioFocusActive, true);
});

test("legacy and native Teacher activities implement the command/progress boundary without exposing answers", async () => {
  const [page5, complete, debate, embedded, singleChoice, singleChoiceRuntime, openResponse, openResponseRuntime, readable, pages] = await Promise.all([
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2LegacyUnitOpenerActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2CompleteSentencesActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2DebateClubActivity.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherOfflineEmbeddedActivity.jsx", "utf8"),
    readFile("src/components/native-single-choice/NativeSingleChoiceTeacherSurface.jsx", "utf8"),
    readFile("src/components/native-single-choice/nativeSingleChoiceTeacherRuntime.js", "utf8"),
    readFile("src/components/native-open-response/NativeOpenResponseTeacherSurface.jsx", "utf8"),
    readFile("src/components/native-open-response/nativeOpenResponseTeacherRuntime.js", "utf8"),
    readFile("src/components/native-readable-text/NativeReadableTextPresentation.jsx", "utf8"),
    readFile("src/apps/android-teacher-offline/TeacherClassroomPages.jsx", "utf8"),
  ]);
  for (const source of [page5, complete, debate]) {
    assert.match(source, /command\.type === "reset-activity"/);
    assert.match(source, /command\.type === "show-all"/);
    assert.match(source, /command\.type === "show-next"/);
    assert.match(source, /reveal:[^\n]*\{ supported: true, total:/);
    assert.doesNotMatch(source, /onStateChange\?\.\([^)]*(?:answer|solution)/i);
  }
  assert.match(page5, /revealableQuestions\.find\(\(question\) => !revealedQuestionIds/);
  assert.match(complete, /runtime\?\.blanks\.find\(\(blank\) => !revealedBlankIds\.includes/);
  assert.match(debate, /parts\.findIndex\(\(part\) => !revealedPartIds\.includes/);
  assert.match(embedded, /activityPresentation=\{\{[\s\S]*command: activityPresentationCommand,[\s\S]*onStateChange: onActivityPresentationStateChange/);
  for (const source of [singleChoice + singleChoiceRuntime, openResponse + openResponseRuntime]) {
    assert.match(source, /reset-activity/);
    assert.match(source, /show-all/);
    assert.match(source, /show-next/);
    assert.match(source, /onStateChange\?\.\(/);
  }
  assert.match(singleChoice, /nativeSingleChoiceTeacherPresentationState/);
  assert.match(openResponse, /reveal: \{ supported: true, total: questionIds\.length, revealed: revealed\.size/);
  assert.match(readable, /normalizeNativeChildPresentationState/);
  assert.match(readable, /panelIndex: activityState\.panelIndex/);
  assert.doesNotMatch(readable, /correctOptionIds|modelAnswers|teacherDocument/);
  assert.match(pages, /setActivitySessionEpoch\(\(current\) => current \+ 1\)/);
  assert.match(pages, /activityPresentationState\.panelCount > 1/);
  assert.match(pages, /disabled: !revealSupported/);
  assert.match(pages, /!activityPresentationState\.audioFocusActive/);
});
