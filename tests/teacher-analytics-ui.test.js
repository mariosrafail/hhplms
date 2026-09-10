import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "./_vite-test-server.mjs";

import { chartMotion, chartPercent, metricLabel } from "../src/components/lms/teacher/analytics/analyticsPresentation.js";

test("analytics presentation handles nulls, zero totals, and reduced motion deterministically", () => {
  assert.equal(metricLabel(null, "%"), "Not scored");
  assert.equal(metricLabel(0, "%"), "0%");
  assert.equal(chartPercent(0, 0), 0);
  assert.equal(chartPercent(1, 3), 33.3);
  assert.deepEqual(chartMotion(true), { initial: false, transition: { duration: 0 } });
  assert.equal(chartMotion(false).transition.duration, 0.45);
});

test("donut and distribution charts expose names, legends, and text equivalents", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { AccessibleDonutChart, ScoreDistributionChart } = await vite.ssrLoadModule("/src/components/lms/teacher/analytics/TeacherAnalyticsCharts.jsx");
  const items = [{ id: "excellent", label: "Excellent", count: 2 }, { id: "good", label: "Good", count: 1 }];
  const donut = renderToStaticMarkup(React.createElement(AccessibleDonutChart, { title: "Score bands", description: "Scored final work", items }));
  assert.match(donut, /role="img"/);
  assert.match(donut, /<title>Score bands<\/title>/);
  assert.match(donut, /Excellent/);
  assert.match(donut, /66\.7%/);
  const bars = renderToStaticMarkup(React.createElement(ScoreDistributionChart, { bands: items, notScored: 3 }));
  assert.match(bars, /aria-label="Score distribution\./);
  assert.match(bars, /Not scored or awaiting review/);
});

test("analytics data fetching aborts stale filter requests and teacher surfaces share the contract", async () => {
  const [hook, dashboard, students, review] = await Promise.all([
    readFile("src/components/lms/teacher/analytics/useTeacherGradeAnalytics.js", "utf8"),
    readFile("src/components/lms/teacher/sections/TeacherDashboardSection.jsx", "utf8"),
    readFile("src/components/lms/teacher/sections/TeacherStudentsSection.jsx", "utf8"),
    readFile("src/components/lms/teacher/components/TeacherAssignmentReviewWorkspace.jsx", "utf8"),
  ]);
  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.match(dashboard, /TeacherPerformanceSnapshot/);
  assert.match(students, /TeacherPerformancePanel/);
  assert.match(review, /TeacherPerformancePanel/);
});
