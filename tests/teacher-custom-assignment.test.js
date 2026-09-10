import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

test("teacher custom assignment route and compatibility alias select the custom assignment section", async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { parseHashRoute } = await vite.ssrLoadModule("/src/utils/hashRoutes.js");
    const current = parseHashRoute("#teacher-custom-assignment");
    const compatibility = parseHashRoute("#teacher-course-editor");

    assert.equal(current.view, "teacher-custom-assignment");
    assert.equal(current.section, "custom-assignment");
    assert.equal(compatibility.view, "teacher-course-editor");
    assert.equal(compatibility.section, "custom-assignment");
  } finally {
    await vite.close();
  }
});

test("Custom Assignment renders recoverable loading and error states without course data", async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { TeacherCustomAssignment } = await vite.ssrLoadModule(
      "/src/components/lms/teacher/sections/TeacherCustomAssignmentSection.jsx",
    );
    const baseProps = {
      course: null,
      onCourseChange() {},
      navigateTo() {},
      reloadCourse() {},
    };

    const loadingMarkup = renderToStaticMarkup(React.createElement(TeacherCustomAssignment, {
      ...baseProps,
      courseLoading: true,
      courseError: "",
    }));
    assert.match(loadingMarkup, /Loading course content/);
    assert.match(loadingMarkup, /Custom Assignment/);

    const errorMarkup = renderToStaticMarkup(React.createElement(TeacherCustomAssignment, {
      ...baseProps,
      courseLoading: false,
      courseError: "Course data could not be loaded from the server.",
    }));
    assert.match(errorMarkup, /Course data could not be loaded from the server/);
    assert.match(errorMarkup, /Try again/);
  } finally {
    await vite.close();
  }
});
