import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "./_vite-test-server.mjs";
import { deriveStudentAssignmentPresentation } from "../src/components/lms/student/portal/studentAssignmentPresentation.js";
import { assignmentReviewAction, filterAssignmentResultRows, teacherScorePolicy } from "../src/components/lms/teacher/assignmentReviewPresentation.js";

test("student assignment presentation uses only authoritative persisted states", () => {
  assert.equal(deriveStudentAssignmentPresentation({ dueAt: "2099-01-01" }).action, "Start exercise");
  assert.equal(deriveStudentAssignmentPresentation({ dueAt: "2020-01-01" }).key, "overdue");
  assert.deepEqual(deriveStudentAssignmentPresentation({ submissionId: "s1", submissionStatus: "submitted", scorePercent: 84 }), {
    key: "auto-scored", label: "Automatically graded", action: "View results", tone: "green", canSubmit: false, score: 84,
  });
  assert.equal(deriveStudentAssignmentPresentation({ submissionId: "s1", submissionStatus: "awaiting_review" }).label, "Awaiting teacher review");
  assert.equal(deriveStudentAssignmentPresentation({ submissionId: "s1", submissionStatus: "reviewed" }).action, "View feedback");
  assert.equal(deriveStudentAssignmentPresentation({ submissionId: "s1", submissionStatus: "completed", scorePercent: 99 }).score, null);
});

test("assignment book context resolves the stable activity to its authored page and hotspot", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { resolveStudentAssignmentBookContext } = await vite.ssrLoadModule("/src/components/lms/student/portal/studentAssignmentBookContext.js");
  const context = resolveStudentAssignmentBookContext({ activity: { demoActivityKey: "ultimate-b2-sb-u1-p1-o2" } });
  assert.equal(context.packageSlug, "ultimate-b2");
  assert.equal(context.componentId, "students-book");
  assert.equal(context.pageId, "ub2-sb-unit-1-part-1");
  assert.equal(context.pageNumber, 5);
  assert.match(context.hotspotId, /^hotspot-/);
  assert.equal(context.activityKey, "ultimate-b2-sb-u1-p1-o2");
});

test("teacher review actions, filters, and score policy preserve grading semantics", () => {
  assert.equal(assignmentReviewAction({ awaitingReviewCount: 1, submittedCount: 2 }), "Review submissions");
  assert.equal(assignmentReviewAction({ submittedCount: 2 }), "View results");
  assert.equal(assignmentReviewAction({ submittedCount: 0 }), "View assignment");
  const rows = [{ studentId: "a", submissionStatus: "awaiting_review", submissionId: "1" }, { studentId: "b" }];
  assert.deepEqual(filterAssignmentResultRows(rows, "awaiting_review").map((row) => row.studentId), ["a"]);
  assert.deepEqual(filterAssignmentResultRows(rows, "missing").map((row) => row.studentId), ["b"]);
  assert.equal(teacherScorePolicy(rows[0], { implementationMode: "teacher-reviewed" }).required, true);
  assert.equal(teacherScorePolicy({ submissionId: "2" }, { implementationMode: "auto-scored" }).editable, false);
  assert.equal(teacherScorePolicy({ submissionId: "3" }, { implementationMode: "unscored-practice" }).label, "No numerical score");
});

test("student and teacher assignment workspace routes survive direct parsing", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const routes = await vite.ssrLoadModule("/src/utils/hashRoutes.js");
  const studentHash = routes.buildStudentAssignmentHash("assignment-123");
  const teacherHash = routes.buildTeacherAssignmentReviewHash("assignment-123");
  assert.deepEqual(routes.parseHashRoute(studentHash), routes.parseHashRoute(studentHash));
  assert.equal(routes.parseHashRoute(studentHash).selectedAssignmentId, "assignment-123");
  assert.equal(routes.parseHashRoute(studentHash).view, "student-assignment");
  assert.equal(routes.parseHashRoute(teacherHash).routeAction, "review");
  assert.equal(routes.parseHashRoute(teacherHash).selectedAssignmentId, "assignment-123");
  assert.equal(routes.parseHashRoute("/student/assignments/missing/extra").view, "invalid-route");
  const appSource = await readFile("src/App.jsx", "utf8");
  assert.match(appSource, /<StudentPortal[\s\S]*initialSelectedAssignmentId=\{selectedAssignmentId\}/);
});

test("assignment review backend keeps auto scores server-authoritative", async () => {
  const source = await readFile("netlify/functions/_book-content/class-actions.js", "utf8");
  const assignmentsSource = await readFile("netlify/functions/_book-content/assignment-actions.js", "utf8");
  assert.match(source, /implementation_mode !== "teacher-reviewed" && scorePercent !== null/);
  assert.match(source, /scorePercent can only be set for teacher-reviewed activities/);
  assert.match(source, /aa\.school_id = \$\{currentUser\.school_id\}/);
  assert.match(source, /aa\.teacher_id = \$\{currentUser\.id\}/);
  assert.match(assignmentsSource, /l\.id as lesson_id, l\.slug as lesson_slug/);
  assert.match(assignmentsSource, /coalesce\(bc\.id, native_component\.id\) as component_id/);
  assert.match(assignmentsSource, /coalesce\(bp\.id, native_package\.id\) as package_id/);
});

test("assignment results are routed to the full-page workspace instead of the results modal", async () => {
  const section = await readFile("src/components/lms/teacher/sections/TeacherAssignmentsSection.jsx", "utf8");
  const workspace = await readFile("src/components/lms/teacher/components/TeacherAssignmentReviewWorkspace.jsx", "utf8");
  assert.doesNotMatch(section, /ResultsModal/);
  assert.match(section, /TeacherAssignmentReviewWorkspace/);
  assert.match(workspace, /downloadAssignmentResultsCsv/);
  assert.match(workspace, /filterAssignmentResultRows/);
  const studentWorkspace = await readFile("src/components/lms/student/portal/StudentAssignmentWorkspace.jsx", "utf8");
  assert.match(studentWorkspace, /StudentInteractiveRuntimeShell/);
  assert.match(studentWorkspace, /STUDENT_RUNTIME_MODES\.REVIEW/);
  assert.doesNotMatch(studentWorkspace, /BookPackageBrowser/);
});
