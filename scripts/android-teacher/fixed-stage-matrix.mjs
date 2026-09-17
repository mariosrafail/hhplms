import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { localPlaywrightLaunchOptions } from "./playwright-launch-options.mjs";

const baseURL = "http://127.0.0.1:4182";
const artifactRoot = "test-results/android-teacher-fixed-stage";
const viewports = [
  { width: 800, height: 360 },
  { width: 1024, height: 600 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

const preview = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4182"],
  { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);

async function waitForPreview() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(baseURL)).ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Teacher fixed-stage preview did not start.");
}

function near(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`);
}

async function completeStartupIntro(page) {
  const intro = page.getByRole("dialog", { name: "Ultimate B2 opening" });
  if (await intro.count()) await intro.locator("video").evaluate((video) => video.dispatchEvent(new Event("ended")));
  await page.locator(".legacy-home-launcher").waitFor();
}

async function readViewportBackdrop(page) {
  return page.evaluate(() => {
    const host = document.querySelector("[data-teacher-stage-host]");
    const hostStyle = getComputedStyle(host);
    const surfaceStyle = (selector) => {
      const element = document.querySelector(selector);
      const style = element ? getComputedStyle(element) : null;
      return {
        image: style?.backgroundImage || "none",
        color: style?.backgroundColor || "rgba(0, 0, 0, 0)",
      };
    };
    return {
      name: host.dataset.viewportBackdrop || "",
      image: hostStyle.backgroundImage,
      color: hostStyle.backgroundColor,
      position: hostStyle.backgroundPosition,
      size: hostStyle.backgroundSize,
      repeat: hostStyle.backgroundRepeat,
      library: surfaceStyle(".teacher-offline-library"),
      book: surfaceStyle(".teacher-offline-book"),
      overview: surfaceStyle(".teacher-offline-unit-overview-screen"),
      page: surfaceStyle(".teacher-offline-pages-viewer"),
      media: surfaceStyle(".teacher-offline-media"),
    };
  });
}

function assertTransparent(surface, label) {
  assert.equal(surface.image, "none", `${label} has no duplicate background image`);
  assert.equal(surface.color, "rgba(0, 0, 0, 0)", `${label} outer surface is transparent`);
}

function assertBackdrop(backdrop, name, label, { classroomImage = false } = {}) {
  assert.equal(backdrop.name, name, `${label} viewport backdrop`);
  assert.notEqual(backdrop.color, "rgb(17, 24, 39)", `${label} has no dark fallback bars`);
  if (classroomImage) {
    assert.match(backdrop.image, /linear-gradient/iu, `${label} keeps its tint gradient`);
    assert.match(backdrop.image, /url\(/iu, `${label} keeps the classroom image`);
  }
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const stage = document.querySelector("[data-teacher-stage]");
    const host = document.querySelector("[data-teacher-stage-host]");
    const stageRect = stage.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const scale = Number(stage.dataset.teacherStageScale);
    const logicalRect = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {
        x: (rect.left - stageRect.left) / scale,
        y: (rect.top - stageRect.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      };
    };
    return {
      scale,
      logicalStage: { width: stage.offsetWidth, height: stage.offsetHeight },
      renderedStage: { left: stageRect.left, top: stageRect.top, width: stageRect.width, height: stageRect.height },
      host: { left: hostRect.left, top: hostRect.top, width: hostRect.width, height: hostRect.height },
      launcher: logicalRect(".legacy-home-launcher"),
      firstUnit: logicalRect(".legacy-home-unit"),
      title: logicalRect(".legacy-menu-title-animation"),
      toolbar: logicalRect(".teacher-offline-library > .classroom-teaching-toolbar"),
      document: {
        widthOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        heightOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bodyWidthOverflow: document.body.scrollWidth - document.body.clientWidth,
        bodyHeightOverflow: document.body.scrollHeight - document.body.clientHeight,
      },
    };
  });
}

async function logicalRects(page, selectors) {
  return page.evaluate((requested) => {
    const stage = document.querySelector("[data-teacher-stage]");
    const stageRect = stage.getBoundingClientRect();
    const scale = Number(stage.dataset.teacherStageScale);
    return Object.fromEntries(Object.entries(requested).map(([key, selector]) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return [key, {
        x: (rect.left - stageRect.left) / scale,
        y: (rect.top - stageRect.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
        offsetWidth: element.offsetWidth,
        offsetHeight: element.offsetHeight,
      }];
    }));
  }, selectors);
}

function assertSameLogicalRect(actual, expected, label) {
  for (const field of ["x", "y", "width", "height"]) near(actual[field], expected[field], .5, `${label}.${field}`);
}

const shellControlLabels = ["Open classroom settings", "Minimize application", "Close application"];
const bookNavigationLabels = ["Home", "Back", "Previous page", "Next page", "Students Book", "Grammar Book", "Workbook"];

async function waitForBookNavigation(page) {
  await page.waitForFunction(() => {
    const navigation = document.querySelector("[data-teacher-book-navigation]");
    const images = [...(navigation?.querySelectorAll("img") || [])];
    return navigation?.querySelectorAll("button").length >= 7
      && images.length >= 7
      && images.every((image) => image.complete && image.naturalWidth > 0);
  });
}

async function assertShellControls(page, label) {
  const controls = page.locator("[data-teacher-shell-chrome] button");
  assert.equal(await controls.count(), 3, `${label} has exactly three shell controls`);
  assert.deepEqual(await controls.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), shellControlLabels, `${label} shell control order`);
}

async function assertBookNavigation(page, label, { previousDisabled, nextDisabled } = {}) {
  await waitForBookNavigation(page);
  const buttons = page.locator("[data-teacher-book-navigation] button");
  const labels = await buttons.evaluateAll((items) => items.map((button) => button.getAttribute("aria-label")));
  assert.deepEqual(labels.slice(0, 4), bookNavigationLabels.slice(0, 4), `${label} primary book navigation order`);
  assert.deepEqual(labels.slice(-3), bookNavigationLabels.slice(-3), `${label} book-switch order`);
  if (previousDisabled !== undefined) assert.equal(await buttons.nth(2).isDisabled(), previousDisabled, `${label} previous-page state`);
  if (nextDisabled !== undefined) assert.equal(await buttons.nth(3).isDisabled(), nextDisabled, `${label} next-page state`);
  assert.equal(await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Grammar Book", exact: true }).isDisabled(), false, `${label} GB remains visible and enabled`);
  assert.equal(await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Workbook", exact: true }).isDisabled(), false, `${label} WB remains visible and enabled`);
  assert.equal(await page.locator(".legacy-home-window-controls,.legacy-page-window-controls,.teacher-unit-side-navigation,.legacy-overview-book-links,.legacy-page-navigation,.teacher-offline-view-tabs,.teacher-offline-unit-tabs").count(), 0, `${label} has no obsolete or duplicate navigation`);
}

async function openInternalContents(page, unitNumber = 1) {
  await page.evaluate((selectedUnitNumber) => {
    const current = window.history.state || {};
    const next = {
      teacherOffline: true,
      view: "book",
      location: { ...(current.location || {}), unitNumber: selectedUnitNumber, tab: "exercises", pageId: "" },
    };
    window.history.replaceState(next, "", "#book");
    window.dispatchEvent(new PopStateEvent("popstate", { state: next }));
  }, unitNumber);
  await page.locator(".teacher-offline-lessons").waitFor();
}

let browser;
try {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await waitForPreview();
  browser = await chromium.launch(localPlaywrightLaunchOptions());
  const results = [];
  let canonicalLauncher;

  for (const target of viewports) {
    const context = await browser.newContext({ viewport: target });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon/i.test(message.text())) consoleErrors.push(message.text());
    });
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.locator("[data-teacher-stage-host]").waitFor();
    const introBackdrop = await readViewportBackdrop(page);
    assertBackdrop(introBackdrop, "intro", `${target.width}x${target.height} intro`);
    assert.equal(introBackdrop.image, "none", `${target.width}x${target.height} intro has no launcher image`);
    assert.equal(introBackdrop.color, "rgb(254, 254, 254)", `${target.width}x${target.height} intro viewport uses its authored near-white backing`);
    await completeStartupIntro(page);
    await assertShellControls(page, `${target.width}x${target.height} library`);

    const launcherBackdrop = await readViewportBackdrop(page);
    assertBackdrop(launcherBackdrop, "library", `${target.width}x${target.height} library`);
    assert.notEqual(launcherBackdrop.image, "none", `${target.width}x${target.height} launcher viewport image`);
    assert.equal(launcherBackdrop.position, "50% 50%", `${target.width}x${target.height} centered launcher backdrop`);
    assert.equal(launcherBackdrop.size, "cover", `${target.width}x${target.height} launcher backdrop cover`);
    assert.equal(launcherBackdrop.repeat, "no-repeat", `${target.width}x${target.height} launcher backdrop repeat`);
    assertTransparent(launcherBackdrop.library, `${target.width}x${target.height} logical library`);

    const geometry = await readGeometry(page);
    const expectedScale = Math.min(target.width / 1920, target.height / 1080);
    near(geometry.scale, expectedScale, 0.00001, `${target.width}x${target.height} scale`);
    assert.deepEqual(geometry.logicalStage, { width: 1920, height: 1080 }, `${target.width}x${target.height} intrinsic stage`);
    near(geometry.renderedStage.width, 1920 * expectedScale, 1, `${target.width}x${target.height} rendered width`);
    near(geometry.renderedStage.height, 1080 * expectedScale, 1, `${target.width}x${target.height} rendered height`);
    near(geometry.renderedStage.left + geometry.renderedStage.width / 2, geometry.host.left + geometry.host.width / 2, 1, `${target.width}x${target.height} horizontal center`);
    near(geometry.renderedStage.top + geometry.renderedStage.height / 2, geometry.host.top + geometry.host.height / 2, 1, `${target.width}x${target.height} vertical center`);
    assert.ok(geometry.renderedStage.left >= geometry.host.left - 1 && geometry.renderedStage.top >= geometry.host.top - 1, `${target.width}x${target.height} leading stage bounds`);
    assert.ok(geometry.renderedStage.left + geometry.renderedStage.width <= geometry.host.left + geometry.host.width + 1, `${target.width}x${target.height} horizontal containment`);
    assert.ok(geometry.renderedStage.top + geometry.renderedStage.height <= geometry.host.top + geometry.host.height + 1, `${target.width}x${target.height} vertical containment`);
    assert.deepEqual(geometry.document, { widthOverflow: 0, heightOverflow: 0, bodyWidthOverflow: 0, bodyHeightOverflow: 0 }, `${target.width}x${target.height} document overflow`);

    if ((target.width === 1280 && target.height === 800) || (target.width === 2560 && target.height === 1080)) {
      await page.screenshot({ path: `${artifactRoot}/launcher-bleed-${target.width}x${target.height}.png` });
    }

    await page.getByRole("button", { name: /^Open Unit 1:/ }).click();
    await page.locator(".teacher-offline-unit-overview").waitFor();
    let overviewBackdrop = await readViewportBackdrop(page);
    assertBackdrop(overviewBackdrop, "unit-overview", `${target.width}x${target.height} overview`, { classroomImage: true });
    assertTransparent(overviewBackdrop.book, `${target.width}x${target.height} overview book`);
    assertTransparent(overviewBackdrop.overview, `${target.width}x${target.height} overview screen`);
    await assertShellControls(page, `${target.width}x${target.height} overview`);
    await assertBookNavigation(page, `${target.width}x${target.height} overview`, { previousDisabled: true, nextDisabled: true });
    if (target.width === 1280 && target.height === 800) {
      await page.screenshot({ path: `${artifactRoot}/overview-bleed-1280x800.png` });
    }
    if (target.width === 1280 && target.height === 800) {
      await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Home", exact: true }).click();
      await page.locator(".legacy-home-launcher").waitFor();
      const restoredBackdrop = await readViewportBackdrop(page);
      assertBackdrop(restoredBackdrop, "library", "returning to Library");
      assert.notEqual(restoredBackdrop.image, "none", "returning to Library restores launcher image");
      assertTransparent(restoredBackdrop.library, "returning to Library logical surface");
      await page.getByRole("button", { name: /^Open Unit 1:/ }).click();
      await page.locator(".teacher-offline-unit-overview").waitFor();
      await assertBookNavigation(page, "reopened Unit 1", { previousDisabled: true, nextDisabled: true });
      overviewBackdrop = await readViewportBackdrop(page);
      assertBackdrop(overviewBackdrop, "unit-overview", "reopened Unit 1", { classroomImage: true });
    }
    await page.waitForFunction(() => [...document.querySelectorAll(".teacher-unit-page-thumb img")].every((image) => image.complete && image.naturalWidth > 0));
    const overview = await logicalRects(page, {
      screen: ".teacher-offline-unit-overview-screen",
      heading: ".legacy-overview-heading",
      frame: ".teacher-offline-unit-overview",
      firstEntry: ".teacher-unit-page-card",
      navigation: "[data-teacher-book-navigation]",
      toolbar: ".teacher-offline-unit-overview-screen > .classroom-teaching-toolbar",
    });
    await page.locator(".teacher-unit-page-card").first().locator(".teacher-unit-page-open").first().click();
    await page.waitForFunction(() => {
      const image = document.querySelector(".teacher-offline-page-image img");
      return image?.naturalWidth > 0 && image.getBoundingClientRect().width > 0;
    });
    const pageBackdrop = await readViewportBackdrop(page);
    assertBackdrop(pageBackdrop, "page", `${target.width}x${target.height} page`, { classroomImage: true });
    assertTransparent(pageBackdrop.book, `${target.width}x${target.height} page book`);
    assertTransparent(pageBackdrop.page, `${target.width}x${target.height} page screen`);
    await assertShellControls(page, `${target.width}x${target.height} page`);
    await assertBookNavigation(page, `${target.width}x${target.height} first page`, { previousDisabled: true, nextDisabled: false });
    if (target.width === 1280 && target.height === 800) {
      await page.screenshot({ path: `${artifactRoot}/page-bleed-1280x800.png` });
    }
    const pageView = await logicalRects(page, {
      screen: ".teacher-offline-pages-viewer",
      heading: ".legacy-page-heading",
      reader: ".teacher-offline-page-reader",
      stage: ".teacher-offline-page-stage",
      image: ".teacher-offline-page-image",
      navigation: "[data-teacher-book-navigation]",
      toolbar: ".teacher-offline-pages-viewer > .classroom-teaching-toolbar",
    });
    assertSameLogicalRect(pageView.navigation, overview.navigation, `${target.width}x${target.height} overview-to-page navigation`);
    assertSameLogicalRect(pageView.toolbar, overview.toolbar, `${target.width}x${target.height} overview-to-page toolbar`);
    const toolbarBeforeSelection = await page.locator(".teacher-offline-pages-viewer > .classroom-teaching-toolbar").boundingBox();
    await page.locator('[data-teacher-tool="pencil"]').click();
    const toolbarWithPencil = await page.locator(".teacher-offline-pages-viewer > .classroom-teaching-toolbar").boundingBox();
    await page.locator('[data-teacher-tool="eraser"]').click();
    const toolbarWithEraser = await page.locator(".teacher-offline-pages-viewer > .classroom-teaching-toolbar").boundingBox();
    await page.locator('[data-teacher-tool="mouse"]').click();
    for (const [selection, rect] of [["pencil", toolbarWithPencil], ["eraser", toolbarWithEraser]]) {
      for (const field of ["x", "y", "width", "height"]) near(rect[field], toolbarBeforeSelection[field], .5, `${target.width}x${target.height} toolbar ${field} after ${selection} selection`);
    }
    const pageSafety = await page.evaluate(() => {
      const image = document.querySelector(".teacher-offline-page-image").getBoundingClientRect();
      const hotspots = [...document.querySelectorAll(".teacher-offline-page-hotspot")].map((element) => element.getBoundingClientRect());
      return {
        hotspotCount: hotspots.length,
        hotspotsContained: hotspots.every((rect) => rect.left >= image.left - 1 && rect.right <= image.right + 1 && rect.top >= image.top - 1 && rect.bottom <= image.bottom + 1),
        image: { left: image.left, right: image.right, top: image.top, bottom: image.bottom },
        hotspots: hotspots.map(({ left, right, top, bottom }) => ({ left, right, top, bottom })),
        documentWidthOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        documentHeightOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      };
    });
    assert.ok(pageSafety.hotspotCount > 0, `${target.width}x${target.height} page hotspots`);
    assert.equal(pageSafety.hotspotsContained, true, `${target.width}x${target.height} hotspot containment: ${JSON.stringify(pageSafety)}`);
    assert.equal(pageSafety.documentWidthOverflow, 0, `${target.width}x${target.height} page horizontal overflow`);
    assert.equal(pageSafety.documentHeightOverflow, 0, `${target.width}x${target.height} page vertical overflow`);

    let interaction = null;
    if ([[1280, 720], [1920, 1080], [2560, 1440]].some(([width, height]) => width === target.width && height === target.height)) {
      await page.locator('[data-teacher-tool="pencil"]').click();
      const overlayBox = await page.locator(".classroom-tools-overlay").boundingBox();
      const start = { x: overlayBox.x + overlayBox.width * .25, y: overlayBox.y + overlayBox.height * .4 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + overlayBox.width * .05, start.y + overlayBox.height * .05, { steps: 4 });
      await page.mouse.up();
      const annotation = await page.evaluate(() => {
        const overlay = document.querySelector(".classroom-tools-overlay");
        const path = [...overlay.querySelectorAll("path[data-drawing-id]")].at(-1);
        const match = path?.getAttribute("d")?.match(/^M\s+([\d.]+)\s+([\d.]+)/);
        return { x: Number(match?.[1]) / overlay.clientWidth, y: Number(match?.[2]) / overlay.clientHeight };
      });
      near(annotation.x, .25, .015, `${target.width}x${target.height} normalized pencil x`);
      near(annotation.y, .4, .015, `${target.width}x${target.height} normalized pencil y`);

      await page.locator('[data-teacher-tool="mouse"]').click();
      for (let index = 0; index < 5; index += 1) {
        await page.locator(".teacher-offline-page-stage").dispatchEvent("wheel", { deltaY: -100, ctrlKey: true });
        await page.waitForFunction((minimum) => Number(document.querySelector(".teacher-offline-page-image")?.dataset.zoom) >= minimum, 1.19 + index * .2);
      }
      await page.waitForFunction(() => Number(document.querySelector(".teacher-offline-page-image")?.dataset.zoom) >= 1.8);
      const panBox = await page.locator(".teacher-offline-page-stage").boundingBox();
      const panStart = { x: panBox.x + panBox.width * .05, y: panBox.y + panBox.height * .45 };
      await page.mouse.move(panStart.x, panStart.y);
      await page.mouse.down();
      await page.mouse.move(panStart.x, panStart.y + 60, { steps: 5 });
      await page.mouse.up();
      const panY = await page.locator(".teacher-offline-page-image").evaluate((element) => Number(element.style.transform.match(/translate3d\([^,]+,\s*([\d.-]+)px/)?.[1]));
      near(panY, 60 / expectedScale, 3, `${target.width}x${target.height} logical page-pan delta`);
      interaction = { annotation, renderedPanDelta: 60, logicalPanDelta: panY };
      await page.mouse.click(panStart.x, panStart.y);
    }

    await page.locator(".teacher-offline-page-hotspot").first().click({ force: true });
    await page.locator(".teacher-offline-embedded-activity").waitFor();
    await page.waitForFunction(() => document.querySelector(".teacher-offline-embedded-activity")?.dataset.fitScale);
    const activity = await page.evaluate(() => {
      const host = document.querySelector(".teacher-offline-embedded-activity");
      const content = document.querySelector(".teacher-offline-embedded-activity-content");
      const hostRect = host.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        id: host.dataset.embeddedActivityId,
        mode: host.dataset.fitMode,
        scale: Number(host.dataset.fitScale),
        contained: contentRect.left >= hostRect.left - 1 && contentRect.right <= hostRect.right + 1 && contentRect.top >= hostRect.top - 1 && contentRect.bottom <= hostRect.bottom + 1,
        documentWidthOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        documentHeightOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      };
    });
    assert.equal(activity.mode, "scale", `${target.width}x${target.height} activity fit mode`);
    assert.ok(activity.scale > 0 && activity.scale <= 1, `${target.width}x${target.height} activity fit scale`);
    assert.equal(activity.contained, true, `${target.width}x${target.height} activity containment`);
    assert.equal(activity.documentWidthOverflow, 0, `${target.width}x${target.height} activity horizontal overflow`);
    assert.equal(activity.documentHeightOverflow, 0, `${target.width}x${target.height} activity vertical overflow`);
    const activityBackdrop = await readViewportBackdrop(page);
    assertBackdrop(activityBackdrop, "page", `${target.width}x${target.height} activity`, { classroomImage: true });
    assertTransparent(activityBackdrop.page, `${target.width}x${target.height} activity page screen`);
    await assertBookNavigation(page, `${target.width}x${target.height} activity`, { previousDisabled: true, nextDisabled: true });
    const activityNavigation = await logicalRects(page, { navigation: "[data-teacher-book-navigation]" });
    assertSameLogicalRect(activityNavigation.navigation, overview.navigation, `${target.width}x${target.height} overview-to-activity navigation`);

    if (target.width === 1280 && target.height === 800) {
      await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
      await page.locator(".teacher-offline-page-image").waitFor();
      assertBackdrop(await readViewportBackdrop(page), "page", "activity return to page", { classroomImage: true });
      await assertBookNavigation(page, "activity return to page", { previousDisabled: true, nextDisabled: false });

      const beforeEditionButtons = await page.evaluate(() => JSON.stringify(window.history.state));
      for (const label of ["Students Book", "Grammar Book", "Workbook"]) await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: label, exact: true }).click();
      assert.equal(await page.evaluate(() => JSON.stringify(window.history.state)), beforeEditionButtons, "GB and WB are intentional no-ops");

      const pageNavigation = page.locator("[data-teacher-book-navigation]");
      for (let remaining = 20; remaining > 0 && !await pageNavigation.getByRole("button", { name: "Next page", exact: true }).isDisabled(); remaining -= 1) {
        await pageNavigation.getByRole("button", { name: "Next page", exact: true }).click();
      }
      assert.equal(await pageNavigation.getByRole("button", { name: "Next page", exact: true }).isDisabled(), true, "last page disables Next page");
      assert.equal(await pageNavigation.getByRole("button", { name: "Previous page", exact: true }).isDisabled(), false, "last page keeps Previous page enabled");
      const lastPageNavigation = await logicalRects(page, { navigation: "[data-teacher-book-navigation]" });
      assertSameLogicalRect(lastPageNavigation.navigation, overview.navigation, "overview-to-another-page navigation");

      await openInternalContents(page);
      const contentsBackdrop = await readViewportBackdrop(page);
      assertBackdrop(contentsBackdrop, "contents", "Contents / Exercises", { classroomImage: true });
      assertTransparent(contentsBackdrop.book, "Contents / Exercises book surface");
      await assertBookNavigation(page, "Contents / Exercises", { previousDisabled: true, nextDisabled: true });
      const contentsNavigation = await logicalRects(page, { navigation: "[data-teacher-book-navigation]" });
      assertSameLogicalRect(contentsNavigation.navigation, overview.navigation, "overview-to-contents navigation");

      await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
      await page.locator(".teacher-offline-unit-overview").waitFor();
      assertBackdrop(await readViewportBackdrop(page), "unit-overview", "Contents return to overview", { classroomImage: true });
      await page.locator(".teacher-unit-page-card").filter({ hasText: "pg 6-7" }).first().locator(".teacher-unit-page-open").first().click();
      await page.locator(".teacher-offline-pages-viewer").waitFor();

      assert.equal(await page.getByRole("button", { name: "Page activities" }).count(), 0, "obsolete Page activities control stays absent");
      await page.getByRole("button", { name: "Extra Videos", exact: true }).click();
      await page.getByRole("menuitem", { name: "Unit 1 extra video 1", exact: true }).click();
      await page.locator(".teacher-offline-media").waitFor();
      const mediaBackdrop = await readViewportBackdrop(page);
      assertBackdrop(mediaBackdrop, "media", "Media");
      assert.match(mediaBackdrop.image, /linear-gradient/iu, "Media keeps its existing gradient");
      assert.doesNotMatch(mediaBackdrop.image, /url\(/iu, "Media does not invent an image background");
      assertTransparent(mediaBackdrop.media, "Media outer surface");
      await assertShellControls(page, "Media");
      await assertBookNavigation(page, "Media", { previousDisabled: true, nextDisabled: true });
      const mediaNavigation = await logicalRects(page, { navigation: "[data-teacher-book-navigation]" });
      assertSameLogicalRect(mediaNavigation.navigation, overview.navigation, "overview-to-media navigation");
      await page.screenshot({ path: `${artifactRoot}/media-bleed-1280x800.png` });

      await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
      await page.locator(".teacher-offline-pages-viewer").waitFor();
      assertBackdrop(await readViewportBackdrop(page), "page", "Media return to page", { classroomImage: true });

      await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
      await page.locator(".teacher-offline-unit-overview").waitFor();
      await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
      await page.locator(".legacy-home-launcher").waitFor();
      const finalLibraryBackdrop = await readViewportBackdrop(page);
      assertBackdrop(finalLibraryBackdrop, "library", "final Library return");
      assertTransparent(finalLibraryBackdrop.library, "final Library logical surface");
    }

    const currentCanonical = { launcher: geometry.launcher, firstUnit: geometry.firstUnit, title: geometry.title, toolbar: geometry.toolbar, overview, pageView };
    if (target.width === 1920 && target.height === 1080) canonicalLauncher = currentCanonical;
    results.push({ viewport: `${target.width}x${target.height}`, expectedScale, ...geometry, overview, pageView, pageSafety, activity, interaction, consoleErrors });
    await context.close();
  }

  for (const result of results) {
    for (const key of ["launcher", "firstUnit", "title", "toolbar"]) {
      for (const field of ["x", "y", "width", "height"]) {
        near(result[key][field], canonicalLauncher[key][field], 1, `${result.viewport} ${key}.${field} canonical geometry`);
      }
    }
    for (const screen of ["overview", "pageView"]) {
      for (const key of Object.keys(canonicalLauncher[screen])) {
        for (const field of ["x", "y", "width", "height", "offsetWidth", "offsetHeight"]) {
          near(result[screen][key][field], canonicalLauncher[screen][key][field], 1, `${result.viewport} ${screen}.${key}.${field} canonical geometry`);
        }
      }
    }
    assert.deepEqual(result.consoleErrors, [], `${result.viewport} console errors`);
  }

  const nonWide = results.find(({ viewport }) => viewport === "1280x800");
  near(nonWide.renderedStage.top, 40, 1, "1280x800 vertical letterbox");
  near(nonWide.renderedStage.left, 0, 1, "1280x800 no horizontal pillarbox");

  await writeFile(`${artifactRoot}/matrix.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "passed",
    viewports: results.map(({ viewport, expectedScale, renderedStage }) => ({ viewport, expectedScale, renderedStage })),
    artifacts: artifactRoot,
  }, null, 2));
} finally {
  await browser?.close();
  preview.kill();
}
