import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

test("runtime shell exposes accessible practice and final-submit states", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { StudentInteractiveRuntimeShell } = await vite.ssrLoadModule("/src/components/lms/student/runtime/StudentInteractiveRuntimeShell.jsx");
  const practice = renderToStaticMarkup(React.createElement(StudentInteractiveRuntimeShell, { mode: "practice", title: "Practice activity", submittable: true }, React.createElement("div", null, "Questions")));
  assert.match(practice, /data-runtime-mode="practice"/);
  assert.match(practice, /Your work here is not submitted or graded/);
  assert.doesNotMatch(practice, /Submit assignment/);
  const assigned = renderToStaticMarkup(React.createElement(StudentInteractiveRuntimeShell, { mode: "assigned", title: "Assigned activity", submittable: true, onConfirmSubmit() {} }, React.createElement("div", null, "Questions")));
  assert.match(assigned, /Submit assignment/);
  assert.match(assigned, /Open activity fullscreen/);
  const review = renderToStaticMarkup(React.createElement(StudentInteractiveRuntimeShell, { mode: "review", title: "Saved activity", submitted: true }, React.createElement("div", null, "Saved responses")));
  assert.match(review, /Submitted and locked/);
  assert.doesNotMatch(review, /Submit assignment/);
});

test("confirmation dialog is modal, warns about locking, and disables actions while pending", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { FinalSubmitDialog } = await vite.ssrLoadModule("/src/components/lms/student/runtime/FinalSubmitDialog.jsx");
  const html = renderToStaticMarkup(React.createElement(FinalSubmitDialog, { open: true, pending: true, onCancel() {}, onConfirm() {} }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /final submission/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Submitting…/);
});

test("books, assignment workspace, and native student surfaces retain one safe runtime contract", async () => {
  const [books, assignment, nativeRunner, shell, styles] = await Promise.all([
    readFile("src/components/lms/books/BookPageViewer.jsx", "utf8"),
    readFile("src/components/lms/student/portal/StudentAssignmentWorkspace.jsx", "utf8"),
    readFile("src/components/lms/activities/ultimate-b2/PublishedNativeStudentActivityRunner.jsx", "utf8"),
    readFile("src/components/lms/student/runtime/StudentInteractiveRuntimeShell.jsx", "utf8"),
    readFile("src/styles/student.css", "utf8"),
  ]);
  assert.match(books, /StudentInteractiveRuntimeShell mode="practice"/);
  assert.match(books, /"student-practice"/);
  assert.match(assignment, /buildNativeFinalSubmission/);
  assert.match(assignment, /isDuplicateFinalSubmission/);
  assert.doesNotMatch(nativeRunner, /teacherProject|answerKey|correctAnswer|show_answer/);
  assert.match(nativeRunner, /NativeOpenResponseStudentSurface/);
  assert.match(nativeRunner, /NativeSingleChoiceStudentSurface/);
  assert.match(shell, /requestFullscreen/);
  assert.match(shell, /document\.exitFullscreen/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.student-runtime-stage \.ultimate-b2-legacy-unit-opener\s*\{[^}]*height: auto;[^}]*aspect-ratio:/s);
});
