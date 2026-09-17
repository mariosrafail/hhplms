import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { chromium } from "@playwright/test";
import { localPlaywrightLaunchOptions } from "../android-teacher/playwright-launch-options.mjs";

const baseURL = "http://127.0.0.1:4184";
const artifactRoot = "test-results/ultimate-b2-page5-open-response-teacher";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4184"], {
  cwd: process.cwd(),
  env: { ...process.env, VITE_APP_MODE: "android-teacher-offline", VITE_ANDROID_APP_MODE: "teacher-presentation-offline", VITE_OFFLINE_BOOK_SLUG: "ultimate-b2" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(baseURL)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Focused Page 5 Teacher preview did not start.");
}

let browser;
try {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await waitForServer();
  browser = await chromium.launch(localPlaywrightLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultNavigationTimeout(120_000);
  const consoleErrors = [];
  const externalRequests = [];
  page.on("console", (message) => { if (message.type() === "error" && !/favicon/i.test(message.text())) consoleErrors.push(message.text()); });
  page.on("request", (request) => { if (!request.url().startsWith(baseURL)) externalRequests.push(request.url()); });
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  const intro = page.getByRole("dialog", { name: "Ultimate B2 opening" });
  if (await intro.count()) await intro.locator("video").evaluate((video) => video.dispatchEvent(new Event("ended")));
  await page.locator(".legacy-home-launcher").waitFor();
  await page.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await page.locator(".teacher-offline-unit-overview").waitFor();
  const bookNavigation = page.locator("[data-teacher-book-navigation]");
  const bookSwitches = bookNavigation.locator(".teacher-book-navigation-book-switch");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-teacher-book-navigation] .teacher-book-navigation-book-switch img")].length === 3 && [...document.querySelectorAll("[data-teacher-book-navigation] .teacher-book-navigation-book-switch img")].every((image) => image.complete && image.naturalWidth > 0));
  assert.deepEqual(await bookSwitches.evaluateAll((buttons) => buttons.map((button) => ({ label: button.getAttribute("aria-label"), controlId: button.dataset.teacherControlId, bookId: button.dataset.bookId }))), [
    { label: "Students Book", controlId: "book-switch:students-book", bookId: "students-book" },
    { label: "Grammar Book", controlId: "book-switch:grammar-book", bookId: "grammar-book" },
    { label: "Workbook", controlId: "book-switch:workbook", bookId: "workbook" },
  ]);
  const switchImages = await bookSwitches.locator("img").evaluateAll((images) => images.map((image) => ({ filename: new URL(image.src).pathname.split("/").pop(), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, objectFit: getComputedStyle(image).objectFit })));
  assert.deepEqual(switchImages, [
    { filename: "navibar-sb-active.png", naturalWidth: 60, naturalHeight: 60, objectFit: "contain" },
    { filename: "navibar-gb-active.png", naturalWidth: 60, naturalHeight: 60, objectFit: "contain" },
    { filename: "navibar-workbook-active.png", naturalWidth: 60, naturalHeight: 60, objectFit: "contain" },
  ]);
  assert.equal(await bookSwitches.first().getAttribute("aria-current"), "page");
  const hashBeforeBookSwitches = await page.evaluate(() => location.hash);
  const navigationBoxBefore = await bookNavigation.boundingBox();
  for (const label of ["Students Book", "Grammar Book", "Workbook"]) await bookNavigation.getByRole("button", { name: label, exact: true }).click();
  assert.equal(await page.evaluate(() => location.hash), hashBeforeBookSwitches, "Book switches must not invent content routing");
  assert.deepEqual(await bookNavigation.boundingBox(), navigationBoxBefore, "Book-switch clicks must not alter navigation geometry");
  await page.locator(".teacher-unit-page-card").filter({ hasText: "pg 5" }).first().locator(".teacher-unit-page-open").first().click();
  await page.waitForFunction(() => document.querySelector(".teacher-offline-page-image img")?.naturalWidth > 0);
  await page.locator('.teacher-offline-page-hotspot[aria-label="Unit opener · Exercise 1"]').click();
  await page.locator(".teacher-offline-embedded-activity").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll(".ultimate-b2-legacy-unit-opener img")].every((image) => image.complete && image.naturalWidth > 0));

  const canvas = page.locator('.legacy-unit-opener-paper[data-source-canvas="1024x582"]');
  const metrics = await canvas.evaluate((element) => {
    const canvasBox = element.getBoundingClientRect();
    const sourceBox = (selector) => {
      const box = element.querySelector(selector).getBoundingClientRect();
      return { x: (box.left - canvasBox.left) / canvasBox.width * 1024, y: (box.top - canvasBox.top) / canvasBox.height * 582, width: box.width / canvasBox.width * 1024, height: box.height / canvasBox.height * 582 };
    };
    const navigation = document.querySelector("[data-teacher-book-navigation]")?.getBoundingClientRect();
    const toolbar = document.querySelector(".teacher-offline-pages-viewer .classroom-teaching-toolbar")?.getBoundingClientRect();
    const host = document.querySelector(".teacher-offline-embedded-activity-content")?.getBoundingClientRect();
    return {
      canvas: { width: canvasBox.width, height: canvasBox.height },
      instruction: sourceBox(".legacy-unit-opener-instruction"), quote: sourceBox(".legacy-unit-opener-quote-art"),
      prompts: [1, 2, 3].map((index) => sourceBox(`.legacy-unit-opener-question.question-${index}`)),
      responses: [1, 2, 3].map((index) => sourceBox(`[data-response-region-id$="q${index}-response"]`)),
      lineLayers: [1, 2, 3].map((index) => (getComputedStyle(element.querySelector(`[data-response-region-id$="q${index}-response"]`)).backgroundSize.match(/1px/g) || []).length),
      contained: Boolean(host && canvasBox.left >= host.left - 1 && canvasBox.right <= host.right + 1 && canvasBox.top >= host.top - 1 && canvasBox.bottom <= host.bottom + 1),
      navigationVisible: Boolean(navigation?.width && navigation?.height), toolbarVisible: Boolean(toolbar?.width && toolbar?.height),
      documentOverflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, 0),
    };
  });
  const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1.1, `${label}: expected ${expected}, got ${actual}`);
  closeTo(metrics.canvas.width / metrics.canvas.height, 1024 / 582, "canvas ratio");
  for (const [key, expected] of Object.entries({ instruction: { x: 206, y: 18, width: 606, height: 34 }, quote: { x: 696, y: 75, width: 317, height: 507 } })) for (const dimension of Object.keys(expected)) closeTo(metrics[key][dimension], expected[dimension], `${key}.${dimension}`);
  const expectedPrompts = [{ x: 54, y: 79, width: 604, height: 29 }, { x: 54, y: 214, width: 571, height: 29 }, { x: 54, y: 372, width: 491, height: 29 }];
  const expectedResponses = [{ x: 73, y: 117, width: 605, height: 73 }, { x: 73, y: 253, width: 605, height: 96 }, { x: 73, y: 410, width: 601, height: 96 }];
  for (const [index, expected] of expectedPrompts.entries()) for (const dimension of Object.keys(expected)) closeTo(metrics.prompts[index][dimension], expected[dimension], `prompt${index + 1}.${dimension}`);
  for (const [index, expected] of expectedResponses.entries()) for (const dimension of Object.keys(expected)) closeTo(metrics.responses[index][dimension], expected[dimension], `response${index + 1}.${dimension}`);
  assert.deepEqual(metrics.lineLayers, [3, 4, 4]);
  assert.deepEqual({ contained: metrics.contained, navigationVisible: metrics.navigationVisible, toolbarVisible: metrics.toolbarVisible, documentOverflow: metrics.documentOverflow }, { contained: true, navigationVisible: true, toolbarVisible: true, documentOverflow: 0 });

  const regions = page.locator(".legacy-unit-opener-response-region");
  assert.equal(await regions.count(), 3);
  for (let index = 0; index < 3; index += 1) await regions.nth(index).click();
  const reveals = await regions.evaluateAll((nodes) => nodes.map((region) => {
    const text = region.querySelector(".response-region-text");
    return { revealed: region.dataset.revealed, color: getComputedStyle(region).color, fontFamily: getComputedStyle(text).fontFamily, lineCount: text.textContent.split("\n").length, clipped: text.scrollHeight > region.clientHeight + 1 || text.scrollWidth > region.clientWidth + 1 };
  }));
  assert.deepEqual(reveals.map((value) => value.revealed), ["true", "true", "true"]);
  assert.deepEqual(reveals.map((value) => value.lineCount), [3, 4, 4]);
  assert.ok(reveals.every((value) => value.color === "rgb(228, 0, 131)" && /ITC Flora Std Medium/.test(value.fontFamily) && !value.clipped));
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(externalRequests, []);
  await page.screenshot({ path: `${artifactRoot}/teacher-page5-open-response.png`, animations: "disabled" });
  const report = { status: "passed", viewport: "1366x768", canvas: "1024x582", lineCounts: [3, 4, 4], revealColor: "#e40083", clipping: false, bookSwitches: switchImages.map(({ filename }) => filename), bookSwitchRouting: "no-op", teacherNavigationUnchanged: true, teacherToolbarUnchanged: true, artifactRoot };
  await writeFile(`${artifactRoot}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
