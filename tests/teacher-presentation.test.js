import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "./_vite-test-server.mjs";

import {
  ACTIVITY_MODES,
  canOpenActivityInMode,
  getActivityModeCapabilities,
} from "../src/components/lms/activities/activityModes.js";
import {
  checkPresentationAnswers,
  hidePresentationAnswers,
  resetPresentationAttempt,
  revealPresentationQuestion,
  verifiedSolutionQuestionIds,
} from "../src/components/lms/activities/presentationAnswers.js";
import {
  adjacentEnabledStudentsBookActivity,
  enabledStudentsBookActivitySequence,
  findStudentsBookImplementation,
} from "../src/data/ultimate-b2/studentsBookCatalog.js";
import {
  buildUltimateB2TeacherSolutionPayload,
  isUltimateB2PresentationActivityEnabled,
} from "../netlify/functions/_ultimate-b2-teacher-solutions.js";
import {
  browserSafeBookActivityPayload,
  getTeacherActivitySolutions,
  handler as bookContentHandler,
} from "../netlify/functions/book-content.js";
import { setSqlForTests } from "../netlify/functions/_auth-utils.js";
import { runtimeReadySql } from "./_runtime-schema-test-helper.js";

const enabledMultipleChoiceId = "ultimate-b2-sb-u1-p2-o3";
const enabledTypedId = "ultimate-b2-sb-u2-p3-o4";
const openResponseId = "ultimate-b2-sb-u1-p1-o1";
const listeningResponseId = "ultimate-b2-sb-u1-p2-o2";
const missingSolutionId = "ultimate-b2-sb-u1-p7-o5";
const disabledActivityId = "ultimate-b2-sb-u1-p8-o3";
const packageId = "11111111-1111-4111-8111-111111111111";

const teacher = {
  id: "teacher-a",
  role: "teacher",
  school_id: "school-a",
};
const admin = {
  id: "admin-a",
  role: "admin",
  school_id: "school-a",
};
const student = {
  id: "student-a",
  role: "student",
  school_id: "school-a",
};

function activityRow(stableActivityId, overrides = {}) {
  return {
    id: `db-${stableActivityId}`,
    slug: stableActivityId,
    content_json: {},
    package_id: packageId,
    package_slug: "ultimate-b2",
    package_status: "active",
    component_type: "students_book",
    ...overrides,
  };
}

function mockSql({ currentUser = null, activity = null, accessiblePackageIds = [] } = {}) {
  return runtimeReadySql(async (strings) => {
    const query = strings.join("?").replace(/\s+/g, " ");
    if (query.includes("from auth_sessions s")) return currentUser ? [currentUser] : [];
    if (query.includes("join book_components bc on bc.book_package_id = bp.id")) return activity ? [activity] : [];
    if (query.includes("from book_packages bp")) {
      return accessiblePackageIds.map((id) => ({ id }));
    }
    if (query.includes("from book_component_publication_heads head")) return [];
    throw new Error(`Unexpected verification query: ${query}`);
  });
}

function responseBody(response) {
  return JSON.parse(response.body || "{}");
}

test("central activity modes expose the required capabilities without making presentation a fake student", () => {
  const studentCapabilities = getActivityModeCapabilities(ACTIVITY_MODES.STUDENT);
  assert.equal(studentCapabilities.canEditAnswers, true);
  assert.equal(studentCapabilities.canSubmitStudentWork, true);
  assert.equal(studentCapabilities.canRequestSolutions, false);
  assert.equal(studentCapabilities.canRevealSolutions, false);

  const previewCapabilities = getActivityModeCapabilities(ACTIVITY_MODES.TEACHER_PREVIEW);
  assert.equal(previewCapabilities.isReadOnly, true);
  assert.equal(previewCapabilities.canEditAnswers, false);
  assert.equal(previewCapabilities.canSubmitStudentWork, false);
  assert.equal(previewCapabilities.canRequestSolutions, false);

  const presentationCapabilities = getActivityModeCapabilities(ACTIVITY_MODES.TEACHER_PRESENTATION);
  assert.equal(presentationCapabilities.canEditAnswers, true);
  assert.equal(presentationCapabilities.canCheckLocally, true);
  assert.equal(presentationCapabilities.canResetActivity, true);
  assert.equal(presentationCapabilities.canRequestSolutions, true);
  assert.equal(presentationCapabilities.canRevealSolutions, true);
  assert.equal(presentationCapabilities.canSubmitStudentWork, false);
  assert.equal(presentationCapabilities.persistAttempt, false);
  assert.equal(presentationCapabilities.isPresentation, true);
  assert.equal(presentationCapabilities.showLargeControls, true);
});

test("disabled activities cannot open in teacher presentation mode", () => {
  const disabled = findStudentsBookImplementation(disabledActivityId);
  assert.ok(disabled);
  assert.equal(canOpenActivityInMode(disabled, ACTIVITY_MODES.TEACHER_PRESENTATION), false);
  assert.equal(canOpenActivityInMode(disabled, ACTIVITY_MODES.TEACHER_PREVIEW), true);
  assert.equal(isUltimateB2PresentationActivityEnabled(disabledActivityId), false);
});

test("solution payloads use stable IDs, correct option IDs, and all verified typed answers", () => {
  const multipleChoice = buildUltimateB2TeacherSolutionPayload(enabledMultipleChoiceId);
  const multipleChoiceQuestion = multipleChoice.questions[`${enabledMultipleChoiceId}-q1`];
  assert.equal(multipleChoice.activityId, enabledMultipleChoiceId);
  assert.equal(multipleChoice.solutionAvailability, "explicit");
  assert.deepEqual(multipleChoiceQuestion.correctOptionIds, [`${enabledMultipleChoiceId}-q1-o2`]);
  assert.equal(multipleChoiceQuestion.acceptedAnswers.length, 1);

  const typed = buildUltimateB2TeacherSolutionPayload(enabledTypedId);
  const typedQuestion = typed.questions[`${enabledTypedId}-q8`];
  assert.deepEqual(typedQuestion.acceptedAnswers, ["out/off", "out", "off"]);
  assert.equal(checkPresentationAnswers({ [typedQuestion.questionId]: " OFF. " }, typed)[typedQuestion.questionId], "correct");
});

test("publisher model responses and missing evidence states are represented truthfully", () => {
  const openResponse = buildUltimateB2TeacherSolutionPayload(openResponseId);
  const listeningResponse = buildUltimateB2TeacherSolutionPayload(listeningResponseId);
  const missing = buildUltimateB2TeacherSolutionPayload(missingSolutionId);
  assert.equal(openResponse.solutionAvailability, "model-response");
  assert.equal(openResponse.solutionType, "publisher-model-answer");
  assert.equal(Object.keys(openResponse.questions).length, 3);
  assert.match(openResponse.questions[`${openResponseId}-q1`].acceptedAnswers[0], /many artistic processes/);
  assert.equal(listeningResponse.solutionAvailability, "model-response");
  assert.equal(Object.keys(listeningResponse.questions).length, 3);
  assert.match(listeningResponse.questions[`${listeningResponseId}-q1`].acceptedAnswers[0], /on-demand series have become more popular/);
  assert.match(listeningResponse.questions[`${listeningResponseId}-q2`].acceptedAnswers[0], /binge-watching many episodes at a time/);
  assert.match(listeningResponse.questions[`${listeningResponseId}-q3`].acceptedAnswers[0], /identify with characters and situations/);
  assert.equal(missing.solutionAvailability, "missing");
  assert.deepEqual(missing.questions, {});
});

test("reveal, hide, check, and reset preserve temporary classroom answers correctly", () => {
  const solution = buildUltimateB2TeacherSolutionPayload(enabledMultipleChoiceId);
  const [questionId] = verifiedSolutionQuestionIds(solution);
  const classroomAnswers = { [questionId]: "classroom response" };
  const revealed = revealPresentationQuestion([], questionId);
  assert.deepEqual(revealed, [questionId]);
  assert.deepEqual(classroomAnswers, { [questionId]: "classroom response" });
  assert.deepEqual(hidePresentationAnswers(), []);
  assert.deepEqual(resetPresentationAttempt(), {
    answers: {},
    revealedQuestionIds: [],
    checkResults: {},
  });
  assert.equal(checkPresentationAnswers(classroomAnswers, solution)[questionId], "incorrect");
  assert.deepEqual(verifiedSolutionQuestionIds(solution), Object.keys(solution.questions));
});

test("enabled presentation navigation contains exactly 38 + 40 activities and skips disabled rows", () => {
  const sequence = enabledStudentsBookActivitySequence();
  assert.equal(sequence.filter((item) => item.unitNumber === 1).length, 38);
  assert.equal(sequence.filter((item) => item.unitNumber === 2).length, 40);
  assert.equal(sequence.length, 78);
  assert.equal(new Set(sequence.map((item) => item.stableActivityId)).size, 78);
  assert.equal(sequence.some((item) => item.stableActivityId === disabledActivityId), false);

  const beforeDisabledGap = sequence.find((item) => item.stableActivityId === "ultimate-b2-sb-u1-p7-o10");
  const next = adjacentEnabledStudentsBookActivity(beforeDisabledGap.stableActivityId, 1);
  assert.equal(next.stableActivityId, "ultimate-b2-sb-u1-p8-o1");
  assert.equal(sequence.indexOf(adjacentEnabledStudentsBookActivity(sequence[0].stableActivityId, -1)), -1);
  assert.equal(adjacentEnabledStudentsBookActivity(sequence.at(-1).stableActivityId, 1), null);
});

test("teacher solution authorization allows entitled same-school teacher and admin", async () => {
  for (const currentUser of [teacher, admin]) {
    const response = await getTeacherActivitySolutions(
      mockSql({
        activity: activityRow(enabledMultipleChoiceId),
        accessiblePackageIds: [packageId],
      }),
      currentUser,
      { stableActivityId: enabledMultipleChoiceId },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(responseBody(response).solution.activityId, enabledMultipleChoiceId);
    assert.equal(response.headers["Cache-Control"], "no-store, private");
    assert.equal(response.headers.Vary, "Cookie");
  }
});

test("teacher solution authorization denies students, unentitled teachers, and cross-school teachers", async () => {
  const studentResponse = await getTeacherActivitySolutions(
    mockSql(),
    student,
    { stableActivityId: enabledMultipleChoiceId },
  );
  assert.equal(studentResponse.statusCode, 403);
  assert.equal(studentResponse.headers["Cache-Control"], "no-store, private");

  for (const currentUser of [
    teacher,
    { ...teacher, id: "teacher-school-b", school_id: "school-b" },
  ]) {
    const response = await getTeacherActivitySolutions(
      mockSql({
        activity: activityRow(enabledMultipleChoiceId),
        accessiblePackageIds: [],
      }),
      currentUser,
      { stableActivityId: enabledMultipleChoiceId },
    );
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers["Cache-Control"], "no-store, private");
  }
});

test("unknown and disabled activities return controlled not-found responses without solutions", async () => {
  const unknown = await getTeacherActivitySolutions(
    mockSql(),
    teacher,
    { stableActivityId: "ultimate-b2-sb-u1-p99-o99" },
  );
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(responseBody(unknown), { error: "Activity not found" });

  const disabled = await getTeacherActivitySolutions(
    mockSql({ activity: activityRow(disabledActivityId) }),
    teacher,
    { stableActivityId: disabledActivityId },
  );
  assert.equal(disabled.statusCode, 404);
  assert.equal(responseBody(disabled).solution, undefined);
});

test("solution endpoint returns only the requested activity and dispatches over authenticated GET", async () => {
  const previousConfirmation = process.env.TEST_DATABASE_CONFIRMATION;
  process.env.TEST_DATABASE_CONFIRMATION = "isolated-test-database";
  setSqlForTests(mockSql({
    currentUser: teacher,
    activity: activityRow(enabledTypedId),
    accessiblePackageIds: [packageId],
  }));
  try {
    const response = await bookContentHandler({
      httpMethod: "GET",
      headers: { host: "localhost:8888", cookie: "hh_lms_session=test-session" },
      queryStringParameters: {
        action: "teacher-activity-solutions",
        stableActivityId: enabledTypedId,
      },
      rawQuery: `action=teacher-activity-solutions&stableActivityId=${enabledTypedId}`,
      body: "",
    });
    const serialized = response.body;
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Cache-Control"], "no-store, private");
    assert.match(serialized, new RegExp(enabledTypedId));
    assert.doesNotMatch(serialized, new RegExp(enabledMultipleChoiceId));
  } finally {
    setSqlForTests(null);
    if (previousConfirmation === undefined) delete process.env.TEST_DATABASE_CONFIRMATION;
    else process.env.TEST_DATABASE_CONFIRMATION = previousConfirmation;
  }
});

test("presentation routes resolve stable IDs on refresh and preserve Students Book context", { timeout: 60_000 }, async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  try {
    const routes = await vite.ssrLoadModule("/src/utils/hashRoutes.js");
    const hash = routes.buildTeacherPresentationHash(enabledMultipleChoiceId);
    const first = routes.parseHashRoute(hash);
    const refreshed = routes.parseHashRoute(hash);
    assert.equal(first.view, "teacher-presentation");
    assert.equal(first.mode, ACTIVITY_MODES.TEACHER_PRESENTATION);
    assert.equal(first.activityKey, enabledMultipleChoiceId);
    assert.equal(first.selectedPackageSlug, "ultimate-b2");
    assert.equal(first.selectedBookId, "students-book");
    assert.equal(first.selectedBookSubview, "exercises");
    assert.deepEqual(refreshed, first);

    const disabled = routes.parseHashRoute(routes.buildTeacherPresentationHash(disabledActivityId));
    assert.equal(disabled.valid, false);
    assert.equal(disabled.view, "invalid-route");
  } finally {
    await vite.close();
  }
});

test("presentation state clears on activity changes and never enters student progress or submission paths", async () => {
  const [renderer, presentationView, app, server] = await Promise.all([
    readFile("src/components/lms/activities/ultimate-b2/NormalizedStudentsBookActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/TeacherPresentationView.jsx", "utf8"),
    readFile("src/App.jsx", "utf8"),
    Promise.all([
      readFile("netlify/functions/_book-content/submission-actions.js", "utf8"),
      readFile("netlify/functions/_book-content/book-activity-actions.js", "utf8"),
    ]).then((parts) => parts.join("\n")),
  ]);
  assert.match(renderer, /useEffect\(\(\) => \{[\s\S]*setSolutions\(null\)[\s\S]*setRevealedQuestionIds\(\[\]\)[\s\S]*setCheckResults\(\{\}\)[\s\S]*\}, \[activityId,/);
  assert.match(renderer, /if \(!capabilities\.canSubmitStudentWork\) return;/);
  assert.match(renderer, /capabilities\.canSubmitStudentWork/);
  assert.match(presentationView, /mode="teacher-presentation"/);
  assert.match(app, /view === "teacher-presentation"[\s\S]*TeacherPresentationView/);
  assert.match(server, /if \(!isStudent\(currentUser\)\) return forbidden\("Only student accounts can submit assignments"\)/);
  assert.match(server, /if \(!isStudent\(currentUser\)\) return forbidden\("Only student accounts can submit activity responses"\)/);
});

test("Teacher response regions override learner labels without changing reveal-button semantics", async () => {
  const [responseRegion, page5, debate] = await Promise.all([
    readFile("src/components/lms/activities/ultimate-b2/ResponseRegion.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2LegacyUnitOpenerActivity.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/UltimateB2DebateClubActivity.jsx", "utf8"),
  ]);
  assert.match(responseRegion, /interactiveAriaLabel = null/);
  assert.match(responseRegion, /<button[\s\S]*aria-label=\{interactiveAriaLabel \?\? region\.ariaLabel\}[\s\S]*aria-pressed=\{revealed\}[\s\S]*onClick=\{onReveal\}/);
  assert.match(page5, /interactiveAriaLabel=\{`Show model response for question \$\{index \+ 1\}`\}/);
  assert.match(debate, /interactiveAriaLabel=\{`Show model response for part \$\{part\.number\}`\}/);
});

test("student-safe payloads and browser runtime remain answer-key free", async () => {
  const safe = browserSafeBookActivityPayload({
    id: enabledMultipleChoiceId,
    answer: "server-only",
    feedbackJson: {
      acceptedAnswers: ["server-only"],
      correctOptionId: "option-only",
    },
    questions: [{ prompt: "Question", correct: true }],
  });
  assert.deepEqual(safe, {
    id: enabledMultipleChoiceId,
    feedbackJson: {},
    questions: [{ prompt: "Question" }],
  });

  const browserRuntime = [
    await readFile("src/data/ultimate-b2/generated/unit-01.runtime.json", "utf8"),
    await readFile("src/data/ultimate-b2/generated/unit-02.runtime.json", "utf8"),
  ].join("\n");
  assert.doesNotMatch(browserRuntime, /acceptedAnswers|correctOptionId|publisherAnswerValue|sourceProvenance/);
  const publicListeningAuthoring = await readFile("src/data/ultimate-b2/authoring/unit-01-reading-exercise-2.listening.json", "utf8");
  for (const phrase of ["on-demand series have become more popular", "binge-watching many episodes at a time", "They both allow viewers to identify with characters and situations"]) {
    assert.doesNotMatch(browserRuntime, new RegExp(phrase, "i"));
    assert.doesNotMatch(publicListeningAuthoring, new RegExp(phrase, "i"));
  }
});
