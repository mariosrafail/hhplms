import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

import { FORBIDDEN_BRAND_PATTERN, FORBIDDEN_VISIBLE_BRANDING_PATTERN } from "../_branding-audit.mjs";
import { localPlaywrightLaunchOptions } from "./playwright-launch-options.mjs";

const baseURL = "http://127.0.0.1:4181";
const artifactRoot = "test-results/legacy-classroom-visual";
const chromeGeometryResults = [];
const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4181"], {
  cwd: process.cwd(),
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});

async function waitForPreview() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(baseURL)).ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Teacher offline preview did not start.");
}

async function openBook(page) {
  await page.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await page.locator(".teacher-offline-book").waitFor();
}

async function waitForPageImage(page) {
  await page.waitForFunction(() => {
    const image = document.querySelector(".teacher-offline-page-image img");
    return image?.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0;
  });
}

async function waitForUnitOverview(page) {
  await page.locator(".teacher-offline-unit-overview").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll(".teacher-unit-page-thumb img")]
    .every((image) => image.complete && image.naturalWidth > 0));
  await page.locator(".teacher-unit-page-thumb img").evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
}

async function setBookLocation(page, patch) {
  await page.evaluate((locationPatch) => {
    const current = window.history.state || {};
    const next = { teacherOffline: true, view: "book", location: { ...(current.location || {}), ...locationPatch } };
    window.history.replaceState(next, "", "#book");
    window.dispatchEvent(new PopStateEvent("popstate", { state: next }));
  }, patch);
}

async function selectOverviewUnit(page, unit) {
  await waitForUnitOverview(page);
  const currentUnit = Number((await page.locator(".legacy-overview-heading h2").textContent()).match(/\d+/)?.[0]);
  if (currentUnit === unit) return;
  await setBookLocation(page, { unitNumber: unit, tab: "pages", pageId: "" });
  await page.getByRole("heading", { name: `Unit ${unit}`, exact: true }).waitFor();
  await waitForUnitOverview(page);
}

const canonicalOverview = {
  1: ["pg 5", "pg 6-7", "pg 8-9", "pg 10-11", "pg 12", "pg 13", "pg 14-15", "pg 16", "pg 17-18"],
  2: ["pg 19", "pg 20-21", "pg 22-23", "pg 24-25", "pg 26", "pg 27", "pg 28-29", "pg 30", "pg 31-32", "pg 33-34"],
};
const canonicalOverviewWidths = {
  1: [229.69, 407.95, 407.95, 348.53, 229.69, 229.69, 348.53, 229.69, 348.53],
  2: [170.27, 348.53, 348.53, 348.53, 170.27, 170.27, 348.53, 170.27, 348.53, 348.53],
};

async function assertLegacyUnitOverview(page, unit, label) {
  await waitForUnitOverview(page);
  const overview = page.locator(".teacher-offline-unit-overview");
  const entries = overview.locator("[data-overview-entry]");
  assert.equal(await entries.count(), canonicalOverview[unit].length, `${label} entry count`);
  assert.deepEqual(await entries.locator(".teacher-unit-page-copy b").allTextContents(), canonicalOverview[unit], `${label} page labels`);
  const pageIds = await entries.evaluateAll((nodes) => nodes.flatMap((node) => node.dataset.pageIds.split(",")));
  assert.equal(pageIds.length, unit === 1 ? 10 : 12, `${label} real page count`);
  assert.equal(new Set(pageIds).size, pageIds.length, `${label} unique real pages`);
  assert.equal(await overview.getByText(/activities$/i).count(), 0, `${label} activity counts hidden`);
  assert.equal(await overview.locator("img").count(), unit === 1 ? 10 : 12, `${label} thumbnail count`);
  const geometry = await entries.evaluateAll((nodes) => ({
    rows: nodes.map((node) => Number(node.dataset.overviewRow)),
    widths: nodes.map((node) => node.getBoundingClientRect().width),
    panelWidth: nodes[0]?.closest(".teacher-offline-unit-overview")?.getBoundingClientRect().width || 0,
  }));
  assert.deepEqual(geometry.rows, unit === 1 ? [1, 1, 1, 1, 2, 2, 2, 2, 2] : [1, 1, 1, 1, 1, 2, 2, 2, 2, 2], `${label} canonical rows`);
  const geometryScale = geometry.panelWidth / 1490.125;
  geometry.widths.forEach((width, index) => assert.ok(Math.abs(width - canonicalOverviewWidths[unit][index] * geometryScale) <= 1.5, `${label} card ${index + 1} baseline width: ${width}`));
  assert.equal(await overview.evaluate((element) => getComputedStyle(element).backgroundSize), "cover", `${label} overview background covers the frame`);
  const overviewFonts = await entries.locator(".teacher-unit-page-copy").evaluateAll((nodes) => nodes
    .filter((node) => node.querySelector("strong"))
    .slice(0, 2)
    .map((node) => ({
      heading: getComputedStyle(node.querySelector("strong")).fontFamily,
      page: getComputedStyle(node.querySelector("b")).fontFamily,
      headingWeight: getComputedStyle(node.querySelector("strong")).fontWeight,
      pageWeight: getComputedStyle(node.querySelector("b")).fontWeight,
    })));
  for (const font of overviewFonts) {
    assert.match(font.heading, /PF Stiele Futura Medium/, `${label} uses the recovered overview heading family`);
    assert.match(font.page, /PF Stiele Futura Medium/, `${label} uses the recovered overview page-label family`);
    assert.equal(font.headingWeight, "400", `${label} overview heading keeps publisher normal weight`);
    assert.equal(font.pageWeight, "400", `${label} overview page label keeps publisher normal weight`);
  }
  if (unit === 2) assert.equal(await overview.locator('[data-page-ids="reading-19"] strong').count(), 0, `${label} pg 19 heading omitted`);
  assert.equal(await page.locator(".legacy-overview-unit-switcher").count(), 0, `${label} top-left unit switcher absent`);
  assert.equal(await page.getByRole("heading", { name: `Unit ${unit}`, exact: true }).isVisible(), true, `${label} centered unit title`);
  assert.equal(await page.getByRole("button", { name: /^(?:Previous|Next) unit$/, exact: true }).count(), 0, `${label} side unit arrows absent`);
  const navigation = page.locator("[data-teacher-book-navigation] button");
  assert.deepEqual(await navigation.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["Home", "Back", "Previous page", "Next page", "Students Book", "Grammar Book", "Workbook"], `${label} canonical navigation`);
  assert.equal(await navigation.nth(2).isDisabled(), true, `${label} Previous page disabled`);
  assert.equal(await navigation.nth(3).isDisabled(), true, `${label} Next page disabled`);
  await assertScreen(page, label);
}

async function assertGenericUnitOverview(page, unit, expected, label) {
  await waitForUnitOverview(page);
  await page.waitForFunction((expectedCount) => {
    const images = [...document.querySelectorAll(".teacher-unit-page-thumb img")];
    return images.length === expectedCount && images.every((image) => image.complete && image.naturalWidth > 0);
  }, expected.labels.length);
  await page.locator(".teacher-unit-page-thumb img").evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector(".teacher-offline-unit-overview").getBoundingClientRect();
    const entries = [...document.querySelectorAll("[data-overview-entry]")];
    const rectangles = entries.map((entry) => entry.getBoundingClientRect());
    const overlaps = rectangles.some((first, index) => rectangles.slice(index + 1).some((second) => (
      first.left < second.right - 1 && first.right > second.left + 1
      && first.top < second.bottom - 1 && first.bottom > second.top + 1
    )));
    return {
      labels: entries.map((entry) => entry.querySelector(".teacher-unit-page-copy b")?.textContent?.trim()),
      headings: entries.map((entry) => entry.querySelector(".teacher-unit-page-copy strong")?.textContent?.trim() || null),
      rows: entries.map((entry) => Number(entry.dataset.overviewRow)),
      weights: entries.map((entry) => Number(entry.dataset.overviewWeight)),
      spans: entries.map((entry) => Number(entry.dataset.overviewColumnSpan)),
      minimumWidth: Math.min(...rectangles.map((rectangle) => rectangle.width)),
      rowTopSpreads: [1, 2].map((row) => {
        const tops = rectangles.filter((_, index) => Number(entries[index].dataset.overviewRow) === row).map((rectangle) => rectangle.top);
        return tops.length ? Math.max(...tops) - Math.min(...tops) : null;
      }),
      contained: rectangles.every((rectangle) => rectangle.left >= panel.left - 2 && rectangle.right <= panel.right + 2 && rectangle.top >= panel.top - 2 && rectangle.bottom <= panel.bottom + 2),
      overlaps,
      objectFits: [...document.querySelectorAll(".teacher-unit-page-thumb img")].map((image) => getComputedStyle(image).objectFit),
      objectPositions: [...document.querySelectorAll(".teacher-unit-page-thumb img")].map((image) => getComputedStyle(image).objectPosition),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert.deepEqual(metrics.labels, expected.labels, `${label} printed labels`);
  assert.deepEqual(metrics.rows, expected.rows, `${label} semantic rows`);
  assert.deepEqual(metrics.weights, expected.weights, `${label} physical weights`);
  assert.equal(metrics.spans.filter((_, index) => metrics.rows[index] === 1).reduce((sum, span) => sum + span, 0), 24, `${label} top columns`);
  assert.equal(metrics.spans.filter((_, index) => metrics.rows[index] === 2).reduce((sum, span) => sum + span, 0), 24, `${label} bottom columns`);
  assert.ok(metrics.minimumWidth >= 160, `${label} readable card widths: ${metrics.minimumWidth}`);
  assert.ok(metrics.rowTopSpreads.every((spread) => spread !== null && spread <= 3), `${label} exactly two visual rows: ${JSON.stringify(metrics.rowTopSpreads)}`);
  assert.equal(metrics.contained, true, `${label} cards contained`);
  assert.equal(metrics.overlaps, false, `${label} cards do not overlap`);
  assert.ok(metrics.objectFits.every((value) => value === "contain"), `${label} images contained`);
  assert.equal(metrics.objectFits.length, expected.labels.length, `${label} all images rendered`);
  assert.ok(metrics.objectPositions.every((value) => value === "50% 0%"), `${label} images top-centered`);
  assert.ok(metrics.headings.every((heading) => !/parts?_part_/i.test(heading || "")), `${label} internal filenames hidden`);
  assert.ok(metrics.documentOverflow <= 1, `${label} document overflow`);
  await assertScreen(page, label);
}

async function openPage(page, label) {
  await page.locator(".teacher-unit-page-card").filter({ hasText: label }).first().locator(".teacher-unit-page-open").first().click();
  await waitForPageImage(page);
}

async function returnToOverview(page, unit) {
  if (await page.locator(".teacher-offline-embedded-activity").count()) await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
  if (await page.locator(".teacher-offline-pages-viewer").count()) await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
  await setBookLocation(page, { unitNumber: unit, tab: "pages", pageId: "" });
  await waitForUnitOverview(page);
}

async function openActivity(page, unit, title) {
  if (await page.locator(".teacher-offline-embedded-activity").count()) await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
  await setBookLocation(page, { unitNumber: unit, tab: "exercises", pageId: "" });
  await page.locator(".teacher-offline-lessons").waitFor();
  const row = page.locator(".teacher-offline-lessons article").filter({ hasText: title }).first();
  await row.getByRole("button", { name: "Present" }).click();
  await page.locator(".teacher-offline-embedded-activity").waitFor();
  await assertEmbeddedActivity(page, `${title} embedded`);
}

function assertRectStable(actual, expected, label) {
  for (const property of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs(actual[property] - expected[property]) <= 1, `${label} ${property} changed: ${actual[property]} vs ${expected[property]}`);
  }
}

async function captureChromeGeometry(page, label, baseline = null) {
  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
    };
    return {
      navigation: rect("[data-teacher-book-navigation]"),
      toolbar: rect(".teacher-offline-pages-viewer .classroom-teaching-toolbar"),
    };
  });
  assert.ok(geometry.navigation?.width && geometry.navigation?.height, `${label} bottom navigation must be visible`);
  assert.ok(geometry.toolbar?.width && geometry.toolbar?.height, `${label} classroom toolbar must be visible`);
  if (baseline) {
    assertRectStable(geometry.navigation, baseline.navigation, `${label} bottom navigation`);
    assertRectStable(geometry.toolbar, baseline.toolbar, `${label} classroom toolbar`);
  }
  chromeGeometryResults.push({ label, ...geometry });
  return geometry;
}

async function assertEmbeddedActivity(page, label) {
  const metrics = await page.evaluate(() => {
    const visible = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return Boolean(rect?.width && rect?.height);
    };
    const reader = document.querySelector(".teacher-offline-page-reader")?.getBoundingClientRect();
    const host = document.querySelector(".teacher-offline-embedded-activity");
    const hostRect = host?.getBoundingClientRect();
    const content = document.querySelector(".teacher-offline-embedded-activity-content")?.getBoundingClientRect();
    return {
      heading: visible(".legacy-page-heading"),
      reader: visible(".teacher-offline-page-reader"),
      readerBackground: document.querySelector(".teacher-offline-page-reader") ? getComputedStyle(document.querySelector(".teacher-offline-page-reader")).backgroundColor : "",
      navigation: visible(".teacher-book-navigation"),
      toolbarCount: document.querySelectorAll(".teacher-offline-pages-viewer .classroom-teaching-toolbar").length,
      standaloneChrome: document.querySelectorAll(".teacher-offline-presentation").length,
      pageImages: document.querySelectorAll(".teacher-offline-page-image").length,
      pageContext: document.querySelector(".legacy-page-heading strong")?.textContent?.trim(),
      locationPills: document.querySelectorAll(".legacy-page-location").length,
      floatingControls: document.querySelectorAll(".legacy-classroom-sound-toggle, .legacy-classroom-settings-trigger").length,
      navigationLabels: [...document.querySelectorAll('.teacher-book-navigation button')].map((button) => button.getAttribute("aria-label")),
      fitScale: Number(document.querySelector(".teacher-offline-embedded-activity")?.dataset.fitScale),
      hostContained: reader && hostRect
        ? hostRect.left >= reader.left - 1 && hostRect.right <= reader.right + 1
          && hostRect.top >= reader.top - 1 && hostRect.bottom <= reader.bottom + 1
        : false,
      neutralHostCanvas: host ? getComputedStyle(host).backgroundColor === "rgb(255, 255, 255)" : false,
      hostOverflow: host ? `${getComputedStyle(host).overflowX}/${getComputedStyle(host).overflowY}` : "",
      contentVisible: Boolean(content?.width && content?.height),
      contained: reader && content
        ? content.left >= reader.left - 1 && content.right <= reader.right + 1
          && content.top >= reader.top - 1 && content.bottom <= reader.bottom + 1
        : false,
    };
  });
  assert.equal(metrics.heading, true, `${label} keeps unit heading`);
  assert.equal(metrics.reader, true, `${label} keeps the reader`);
  assert.equal(metrics.readerBackground, "rgb(255, 255, 255)", `${label} uses the neutral embedded-activity backing`);
  assert.equal(metrics.navigation, true, `${label} keeps legacy navigation`);
  assert.equal(metrics.toolbarCount, 1, `${label} has one toolbar`);
  assert.equal(metrics.standaloneChrome, 0, `${label} removes standalone presentation chrome`);
  assert.equal(metrics.pageImages, 0, `${label} replaces page image`);
  assert.doesNotMatch(metrics.pageContext, /pg \d/, `${label} omits the page number from the heading`);
  assert.equal(metrics.locationPills, 0, `${label} removes the lower page location pill`);
  assert.equal(metrics.floatingControls, 0, `${label} has no floating controls`);
  assert.deepEqual(metrics.navigationLabels.slice(0, 4), ["Home", "Back", "Previous page", "Next page"], `${label} keeps canonical leading navigation`);
  assert.deepEqual(metrics.navigationLabels.slice(-3), ["Students Book", "Grammar Book", "Workbook"], `${label} keeps canonical book-switch navigation`);
  assert.ok(metrics.fitScale > 0, `${label} uses a positive fit scale`);
  assert.equal(metrics.hostContained, true, `${label} host remains inside the reader: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.neutralHostCanvas, true, `${label} masks the reader background behind activity corners`);
  assert.equal(metrics.hostOverflow, "hidden/hidden", `${label} disables embedded scrolling`);
  assert.equal(metrics.contentVisible, true, `${label} keeps the activity visible`);
  assert.equal(metrics.contained, true, `${label} content fits reader`);
}

async function assertPublisherImageCanvas(page, label) {
  const styles = await page.locator(".ultimate-b2-image-activity, .ultimate-b2-image-activity-sheet").evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderWidth, radius: style.borderRadius, shadow: style.boxShadow };
  }));
  assert.deepEqual(styles, [
    { background: "rgb(255, 255, 255)", border: "0px", radius: "0px", shadow: "none" },
    { background: "rgb(255, 255, 255)", border: "0px", radius: "0px", shadow: "none" },
  ], `${label} uses a continuous white canvas`);
  const fit = await page.locator(".ultimate-b2-image-activity-main").evaluate((image) => {
    const imageBox = image.getBoundingClientRect();
    const sheetBox = image.closest(".ultimate-b2-image-activity-sheet").getBoundingClientRect();
    return { widthRatio: imageBox.width / sheetBox.width, heightRatio: imageBox.height / sheetBox.height, objectFit: getComputedStyle(image).objectFit };
  });
  assert.ok(fit.widthRatio > .95 && fit.heightRatio > .95, `${label} lets 16:9 artwork dominate the available activity viewport: ${JSON.stringify(fit)}`);
  assert.equal(fit.objectFit, "contain", `${label} preserves the complete image without crop or stretch`);
}

async function assertScreen(page, label) {
  await page.waitForFunction(() => [...document.querySelectorAll(".teacher-offline-view-transition, .teacher-offline-unit-overview-screen, .teacher-offline-pages-viewer")]
    .every((element) => Number.parseFloat(getComputedStyle(element).opacity) >= 0.99));
  await page.waitForFunction(() => [...document.images]
    .every((image) => image.complete && image.naturalWidth > 0));
  const metrics = await page.evaluate(() => ({
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    missingImages: [...document.images].filter((image) => !image.complete || !image.naturalWidth).map((image) => image.src),
  }));
  assert.equal(metrics.overflow, 0, `${label} horizontal overflow`);
  assert.deepEqual(metrics.missingImages, [], `${label} missing images`);
  assert.doesNotMatch(await page.locator("body").innerText(), FORBIDDEN_BRAND_PATTERN, `${label} visible branding`);
}

async function assertCleanAbout(page, label) {
  const dialog = page.getByRole("dialog", { name: "Classroom settings" });
  const text = await dialog.innerText();
  assert.match(text, /Hamilton House LMS/);
  assert.match(text, /Version 0\.1\.0/);
  assert.doesNotMatch(text, /Ultimate English B2 interactive classroom content/i, `${label} generic title`);
  assert.doesNotMatch(text, FORBIDDEN_VISIBLE_BRANDING_PATTERN, `${label} branding`);
  await assertScreen(page, label);
}

async function completeStartupIntro(page) {
  const intro = page.getByRole("dialog", { name: "Ultimate B2 opening" });
  if (await intro.count()) {
    assert.equal(await intro.getByRole("button", { name: "Skip intro" }).count(), 0);
    await intro.locator("video").evaluate((video) => video.dispatchEvent(new Event("ended")));
  }
  await page.locator(".legacy-home-launcher").waitFor();
}

async function assertLegacyLauncher(page, label) {
  const metrics = await page.evaluate(() => {
    const visible = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return Boolean(rect?.width && rect?.height);
    };
    const unitHeights = [...document.querySelectorAll(".legacy-home-unit")].map((button) => button.getBoundingClientRect().height);
    const chrome = document.querySelector("[data-teacher-shell-chrome]");
    const settings = chrome?.querySelector('[aria-label="Open classroom settings"]');
    return {
      launcher: visible(".legacy-home-launcher"),
      unitColumns: document.querySelectorAll(".legacy-home-unit-column").length,
      units: document.querySelectorAll(".legacy-home-unit").length,
      lockedUnits: document.querySelectorAll(".legacy-home-unit.locked, .legacy-home-unit .legacy-home-lock").length,
      disabledUnits: document.querySelectorAll(".legacy-home-unit:disabled").length,
      books: document.querySelectorAll(".legacy-home-book-button").length,
      lockedBooks: document.querySelectorAll(".legacy-home-book-button.locked, .legacy-home-book-button .legacy-home-lock").length,
      disabledBooks: document.querySelectorAll(".legacy-home-book-button:disabled").length,
      toolbar: visible(".legacy-home-classroom-toolbar"),
      teachingToolbar: visible(".teacher-offline-library .classroom-teaching-toolbar"),
      settings: visible('[data-teacher-shell-chrome] [aria-label="Open classroom settings"]'),
      settingsInFloatingChrome: Boolean(settings?.closest("[data-teacher-shell-chrome]")),
      bottomSettings: visible(".legacy-classroom-settings-trigger"),
      floatingSound: visible(".legacy-classroom-sound-toggle"),
      close: visible('[data-teacher-shell-chrome] [aria-label="Close application"]'),
      minimize: document.querySelectorAll('[aria-label^="Minimize"]').length,
      horizontalTopbars: document.querySelectorAll(".legacy-home-topbar").length,
      floatingChromeBackground: getComputedStyle(chrome).backgroundColor,
      launcherBackground: getComputedStyle(document.querySelector(".legacy-home-launcher")).backgroundImage,
      launcherBorder: getComputedStyle(document.querySelector(".legacy-home-launcher")).borderTopWidth,
      launcherRadius: getComputedStyle(document.querySelector(".legacy-home-launcher")).borderTopLeftRadius,
      minimumUnitHeight: Math.min(...unitHeights),
      maximumUnitHeight: Math.max(...unitHeights),
      displayScale: Number(document.querySelector(".teacher-offline-settings-surface").dataset.teacherDisplayScale),
    };
  });
  assert.deepEqual({ ...metrics, minimumUnitHeight: undefined, maximumUnitHeight: undefined, displayScale: undefined }, {
    launcher: true,
    unitColumns: 2,
    units: 10,
    lockedUnits: 0,
    disabledUnits: 0,
    books: 4,
    lockedBooks: 0,
    disabledBooks: 0,
    toolbar: false,
    teachingToolbar: true,
    settings: true,
    settingsInFloatingChrome: true,
    bottomSettings: false,
    floatingSound: false,
    close: true,
    minimize: 1,
    horizontalTopbars: 0,
    floatingChromeBackground: "rgba(0, 0, 0, 0)",
    launcherBackground: "none",
    launcherBorder: "0px",
    launcherRadius: "0px",
    minimumUnitHeight: undefined,
    maximumUnitHeight: undefined,
    displayScale: undefined,
  }, `${label} launcher composition`);
  assert.ok(metrics.minimumUnitHeight >= (44 * metrics.displayScale) - 1, `${label} scaled unit touch target: ${metrics.minimumUnitHeight}`);
  assert.ok(metrics.maximumUnitHeight <= (94 * metrics.displayScale) + 1, `${label} proportional unit height: ${metrics.maximumUnitHeight}`);
}

async function assertLegacyPageViewer(page, label, expectedPageTitle = "Unit opener") {
  const metrics = await page.evaluate(() => {
    const reader = document.querySelector(".teacher-offline-page-reader");
    const panel = reader?.getBoundingClientRect();
    const image = document.querySelector(".teacher-offline-page-image")?.getBoundingClientRect();
    const visible = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return Boolean(rect?.width && rect?.height);
    };
    return {
      panelExists: visible(".teacher-offline-page-reader"),
      headingExists: visible(".legacy-page-heading"),
      navigationExists: visible(".teacher-book-navigation"),
      toolsExist: visible(".legacy-classroom-viewer-toolbar"),
      bookHeaderVisible: visible(".teacher-offline-book-header"),
      backgroundSize: reader ? getComputedStyle(reader).backgroundSize : "",
      backgroundPosition: reader ? getComputedStyle(reader).backgroundPosition : "",
      pageContext: document.querySelector(".legacy-page-heading strong")?.textContent?.trim(),
      locationPills: document.querySelectorAll(".legacy-page-location").length,
      floatingControls: document.querySelectorAll(".legacy-classroom-sound-toggle, .legacy-classroom-settings-trigger").length,
      navigationLabels: [...document.querySelectorAll('.teacher-book-navigation button')].map((button) => button.getAttribute("aria-label")),
      centered: panel && image ? Math.abs((image.left + image.width / 2) - (panel.left + panel.width / 2)) < 3 : false,
      contained: panel && image ? image.left >= panel.left - 4 && image.right <= panel.right + 4 && image.top >= panel.top - 4 && image.bottom <= panel.bottom + 4 : false,
      panel: panel ? { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom } : null,
      image: image ? { left: image.left, top: image.top, right: image.right, bottom: image.bottom } : null,
    };
  });
  assert.equal(metrics.panelExists, true, `${label} legacy panel`);
  assert.equal(metrics.headingExists, true, `${label} legacy heading`);
  assert.equal(metrics.navigationExists, true, `${label} lower navigation`);
  assert.equal(metrics.toolsExist, true, `${label} viewer tools`);
  assert.equal(metrics.bookHeaderVisible, false, `${label} web-style book header hidden`);
  assert.equal(metrics.backgroundSize, "cover", `${label} page background matches overview cover fitting`);
  assert.match(metrics.backgroundPosition, /50%/, `${label} page background remains centered`);
  assert.equal(metrics.pageContext, expectedPageTitle, `${label} heading shows only the current page title`);
  assert.equal(metrics.locationPills, 0, `${label} removes the lower page location pill`);
  assert.equal(metrics.floatingControls, 0, `${label} has no floating controls`);
  assert.deepEqual(metrics.navigationLabels, ["Home", "Back", "Previous page", "Next page", "Students Book", "Grammar Book", "Workbook"], `${label} canonical page navigation`);
  assert.equal(metrics.centered, true, `${label} page centered`);
  assert.equal(metrics.contained, true, `${label} page contained: ${JSON.stringify({ panel: metrics.panel, image: metrics.image })}`);
}

let browser;
try {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await waitForPreview();
  browser = await chromium.launch(localPlaywrightLaunchOptions());

  const capture = async ({ width, height }, run) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    const forbiddenRequests = [];
    page.on("console", (message) => { if (message.type() === "error" && !/favicon/i.test(message.text())) consoleErrors.push(message.text()); });
    page.on("request", (request) => { if (!request.url().startsWith(baseURL)) forbiddenRequests.push(request.url()); });
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await completeStartupIntro(page);
    await run(page);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(forbiddenRequests, []);
    await context.close();
  };

  await capture({ width: 1920, height: 1080 }, async (page) => {
    await assertScreen(page, "home-launcher-1920x1080");
    await assertLegacyLauncher(page, "home-launcher-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/home-launcher-1920x1080.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-home-1920x1080.png` });
    await page.getByRole("button", { name: "Open classroom settings" }).click();
    const settingsDialog = page.getByRole("dialog", { name: "Classroom settings" });
    await settingsDialog.waitFor();
    assert.equal(await settingsDialog.getByRole("tab").count(), 4, "Settings tab count");
    await assertScreen(page, "settings-audio-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/settings-audio-1920x1080.png` });
    await settingsDialog.getByRole("tab", { name: "Content" }).click();
    await settingsDialog.locator('[data-settings-panel="content"]').waitFor();
    await page.screenshot({ path: `${artifactRoot}/settings-content-1920x1080.png` });
    await settingsDialog.getByRole("tab", { name: "Graphics" }).click();
    await settingsDialog.locator('[data-settings-panel="graphics"]').waitFor();
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${artifactRoot}/settings-graphics-1920x1080.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-settings-graphics-1920x1080.png` });
    await settingsDialog.getByRole("tab", { name: "About" }).click();
    await settingsDialog.getByText("Version 0.1.0", { exact: true }).waitFor();
    await assertCleanAbout(page, "modern-about-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/settings-about-1920x1080.png` });
    await settingsDialog.getByRole("button", { name: "Close settings" }).click();
    await openBook(page);
    await selectOverviewUnit(page, 1);
    await assertLegacyUnitOverview(page, 1, "students-book-unit1-overview-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit1-overview-1920x1080.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-unit1-overview-1920x1080.png` });
    await selectOverviewUnit(page, 2);
    await assertLegacyUnitOverview(page, 2, "students-book-unit2-overview-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit2-overview-1920x1080.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-unit2-overview-1920x1080.png` });
    await selectOverviewUnit(page, 5);
    await assertGenericUnitOverview(page, 5, {
      labels: ["pg 65", "pg 66-67", "pg 68-69", "pg 70-71", "pg 72", "pg 73", "pg 74-75", "pg 76", "pg 77", "pg 78"],
      rows: [1, 1, 1, 1, 2, 2, 2, 2, 2, 2],
      weights: [1, 2, 2, 2, 1, 1, 2, 1, 1, 1],
    }, "students-book-unit5-overview-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit5-overview-1920x1080.png` });
    await page.locator('[data-page-ids="ub2-sb-unit-5-part-2"]').click();
    await waitForPageImage(page);
    await page.getByAltText("Unit 5, Reading, pg 66-67", { exact: true }).waitFor();
    await returnToOverview(page, 5);
    await selectOverviewUnit(page, 1);
    await openPage(page, "pg 5");
    await assertScreen(page, "page-viewer-unit1-page5-1920x1080");
    await assertLegacyPageViewer(page, "page-viewer-unit1-page5-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/page-viewer-unit1-page5-1920x1080.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-page-viewer-1920x1080.png` });
    await page.screenshot({ path: `${artifactRoot}/normal-toolbar-1920x1080.png` });
    await returnToOverview(page, 1);
    await page.locator('[data-page-ids="ub2-sb-unit-1-part-4"]').click();
    await waitForPageImage(page);
    await assertLegacyPageViewer(page, "page-viewer-unit1-page10-11-1920x1080", "Grammar in Use");
    await page.screenshot({ path: `${artifactRoot}/page-viewer-unit1-page10-11-1920x1080.png` });
    await returnToOverview(page, 1);
    await page.locator('[data-page-ids="ub2-sb-unit-1-part-7"]').click();
    await waitForPageImage(page);
    await assertLegacyPageViewer(page, "page-viewer-unit1-page14-15-1920x1080", "Writing");
    await page.screenshot({ path: `${artifactRoot}/page-viewer-unit1-page14-15-1920x1080.png` });
    await returnToOverview(page, 1);
    await openPage(page, "pg 5");
    const unselectedToolGaps = await page.locator(".classroom-teaching-toolbar .legacy-teacher-tool-icon-stack").evaluateAll((icons) => {
      const unselected = icons.slice(1);
      return unselected.slice(1).map((icon, index) => icon.getBoundingClientRect().left - unselected[index].getBoundingClientRect().right);
    });
    assert.ok(unselectedToolGaps.every((gap) => gap >= 3 && gap <= 6), `toolbar artwork gaps must remain subtle: ${unselectedToolGaps}`);
    const pencil = page.getByRole("button", { name: "Pencil", exact: true });
    await pencil.hover();
    await page.waitForTimeout(140);
    assert.equal(await pencil.locator(".legacy-teacher-tool-icon-active").evaluate((icon) => getComputedStyle(icon).opacity), "1");
    assert.equal(await pencil.evaluate((button) => getComputedStyle(button).cursor), "pointer");
    await page.screenshot({ path: `${artifactRoot}/toolbar-hover-1920x1080.png` });
    await pencil.click();
    await page.waitForTimeout(140);
    assert.equal(await page.locator('.classroom-teaching-toolbar [aria-pressed="true"]').count(), 1);
    assert.equal(await pencil.getAttribute("aria-pressed"), "true");
    await page.screenshot({ path: `${artifactRoot}/toolbar-selected-1920x1080.png` });
    const pencilBox = await pencil.boundingBox();
    await page.mouse.move(pencilBox.x + pencilBox.width / 2, pencilBox.y + pencilBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(70);
    assert.equal(await pencil.locator(".legacy-teacher-tool-icon-active").evaluate((icon) => getComputedStyle(icon).opacity), "1");
    await page.screenshot({ path: `${artifactRoot}/toolbar-pressed-1920x1080.png` });
    await page.mouse.up();
    const overlay = page.locator(".classroom-tools-overlay");
    assert.equal(await overlay.getAttribute("data-active-classroom-tool"), "pen");
    const overlayBox = await overlay.boundingBox();
    await page.mouse.move(overlayBox.x + 260, overlayBox.y + 210);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + 470, overlayBox.y + 300, { steps: 10 });
    await page.mouse.up();
    await overlay.locator("path[data-drawing-id]").waitFor();
    await page.screenshot({ path: `${artifactRoot}/classroom-tools-pen-1920x1080.png` });
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await overlay.click({ position: { x: 520, y: 220 } });
    await page.getByRole("textbox", { name: "Annotation text" }).fill("Class note");
    await page.screenshot({ path: `${artifactRoot}/text-mode-1920x1080.png` });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Mouse", exact: true }).click();
    await page.getByRole("button", { name: "Hide screen", exact: true }).click();
    await page.mouse.move(overlayBox.x + 520, overlayBox.y + 160);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + 760, overlayBox.y + 330, { steps: 8 });
    await page.mouse.up();
    await overlay.locator(".classroom-cover").waitFor();
    await page.screenshot({ path: `${artifactRoot}/cover-mode-1920x1080.png` });
    await page.getByRole("button", { name: "Mouse", exact: true }).click();
    await page.getByRole("button", { name: "Show screen", exact: true }).click();
    await page.mouse.move(overlayBox.x + 300, overlayBox.y + 140);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + 700, overlayBox.y + 380, { steps: 8 });
    await page.mouse.up();
    await overlay.locator("mask").waitFor({ state: "attached" });
    await page.screenshot({ path: `${artifactRoot}/spotlight-mode-1920x1080.png` });
    await page.getByRole("button", { name: "Mouse", exact: true }).click();
    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await page.mouse.move(overlayBox.x + 280, overlayBox.y + 130);
    await page.mouse.down();
    await page.mouse.move(overlayBox.x + 760, overlayBox.y + 410, { steps: 8 });
    await page.screenshot({ path: `${artifactRoot}/zoom-region-selection-1920x1080.png` });
    await page.mouse.up();
    await page.locator(".classroom-stage-transform.region-zoom-active").waitFor();
    await page.screenshot({ path: `${artifactRoot}/zoom-region-active-1920x1080.png` });
    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await page.getByRole("button", { name: "Timer", exact: true }).click();
    await page.getByRole("complementary", { name: "Classroom timer" }).waitFor();
    await page.screenshot({ path: `${artifactRoot}/timer-1920x1080.png` });
    await page.getByRole("button", { name: "Close timer" }).click();
    await page.getByRole("button", { name: "Scoreboard", exact: true }).click();
    await page.getByRole("complementary", { name: "Two-team scoreboard" }).waitFor();
    await page.screenshot({ path: `${artifactRoot}/scoreboard-1920x1080.png` });
    await page.getByRole("button", { name: "Close scoreboard" }).click();
    await page.getByRole("button", { name: "Clear screen", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "All classroom markup", exact: true }).click();
    await openActivity(page, 1, "Reading · Exercise 3");
    await assertScreen(page, "multiple-choice-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/multiple-choice-1920x1080.png` });
    assert.equal(await page.locator(".teacher-multiple-choice-part-indicator").count(), 0);
    await page.getByRole("button", { name: /Question 1 option A:/ }).click();
    await page.getByRole("button", { name: /Question 1 option B:/ }).click();
    await page.getByRole("button", { name: "Next activity part" }).click();
    await page.locator('[data-multiple-choice-panel="2"]').waitFor();
    assert.equal(await page.getByText(/Part\s+2\s*\/\s*2/i).count(), 0);
    await page.screenshot({ path: `${artifactRoot}/multiple-choice-panel-2-1920x1080.png` });
    await openActivity(page, 2, "Vocabulary in Use · Exercise 4");
    await assertScreen(page, "text-gap-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/text-gap-1920x1080.png` });
    await openActivity(page, 1, "Listening · Exercise 3");
    await page.locator("audio").first().waitFor();
    await assertScreen(page, "media-listening-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/media-listening-1920x1080.png` });
  });

  await capture({ width: 1920, height: 1080 }, async (page) => {
    await page.getByRole("button", { name: "Open classroom settings" }).click();
    await page.getByRole("tab", { name: "Graphics" }).click();
    assert.equal(await page.locator(".teacher-offline-settings-surface").getAttribute("data-teacher-theme"), "legacy");
    assert.equal(await page.getByRole("group", { name: "Interface style" }).count(), 0);
    await page.screenshot({ path: `${artifactRoot}/legacy-settings-1920x1080.png` });
    await page.getByRole("tab", { name: "About" }).click();
    await assertCleanAbout(page, "legacy-about-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/legacy-about-1920x1080.png` });
    await page.getByRole("button", { name: "Close settings" }).click();
    await assertScreen(page, "legacy-home-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/legacy-home-1920x1080.png` });
    assert.equal(await page.locator('.legacy-home-book-button[aria-pressed="true"]').getAttribute("aria-label"), "Students Book");
    const editionArtwork = await page.locator(".legacy-home-book-button").evaluateAll((buttons) => buttons.map((button) => [...button.querySelectorAll("img")].map((image) => image.src)));
    assert.notDeepEqual(editionArtwork[0], editionArtwork[1], "Workbook uses its tracked authored normal/active artwork");
    assert.notDeepEqual(editionArtwork[0], editionArtwork[2], "Grammar Book uses its tracked authored normal/active artwork");
    assert.notDeepEqual(editionArtwork[1], editionArtwork[2], "Workbook and Grammar Book authored artwork stay distinct");
    assert.notDeepEqual(editionArtwork[0], editionArtwork[3], "Extras retains its distinct publisher artwork");
    await page.getByRole("button", { name: "Extras", exact: true }).click();
    assert.equal(await page.locator('.legacy-home-book-button[aria-pressed="true"]').getAttribute("aria-label"), "Extras");
    assert.equal(await page.locator(".legacy-home-extras-column.is-left .legacy-home-extra-button").count(), 7);
    assert.equal(await page.locator(".legacy-home-extras-column.is-right .legacy-home-extra-button").count(), 7);
    await assertScreen(page, "legacy-extras-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/legacy-extras-1920x1080.png` });
    await page.getByRole("button", { name: "Students Book", exact: true }).click();
    assert.equal(await page.locator(".legacy-home-unit").count(), 10);
    await openBook(page);
    await selectOverviewUnit(page, 1);
    await waitForUnitOverview(page);
    await assertScreen(page, "legacy-unit1-overview-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/legacy-unit1-overview-1920x1080.png` });
    await openPage(page, "pg 5");
    await page.waitForFunction(() => document.querySelector(".teacher-offline-page-image img")?.getBoundingClientRect().width > innerWidth * 0.2);
    await assertScreen(page, "legacy-page-viewer-1920x1080");
    await page.screenshot({ path: `${artifactRoot}/legacy-page-viewer-1920x1080.png` });
    const chromeBaseline = await captureChromeGeometry(page, "normal page");
    await openActivity(page, 1, "Unit opener · Exercise 1");
    const page5ResponseRegions = page.locator(".legacy-unit-opener-response-region");
    assert.equal(await page5ResponseRegions.count(), 3, "Page 5 Exercise 1 exposes three lined Response Regions");
    assert.deepEqual(await page5ResponseRegions.evaluateAll((regions) => regions.map((region) => region.getAttribute("aria-label"))), ["Show model response for question 1", "Show model response for question 2", "Show model response for question 3"]);
    await page5ResponseRegions.first().click();
    await page.locator('.legacy-unit-opener-response-region[data-revealed="true"]').waitFor();
    await assertEmbeddedActivity(page, "open-response-1920x1080");
    await captureChromeGeometry(page, "Page 5 Exercise 1", chromeBaseline);
    await page.screenshot({ path: `${artifactRoot}/open-response-1920x1080.png` });
    await openActivity(page, 1, "Unit opener · Exercise 2");
    await assertEmbeddedActivity(page, "publisher-image-1920x1080");
    await assertPublisherImageCanvas(page, "publisher-image-1920x1080");
    await captureChromeGeometry(page, "Page 5 Exercise 2", chromeBaseline);
    await page.screenshot({ path: `${artifactRoot}/publisher-image-1920x1080.png` });
    await openActivity(page, 1, "Reading · Exercise 1");
    await captureChromeGeometry(page, "Video", chromeBaseline);
    await openActivity(page, 1, "Reading · Exercise 2");
    await page.locator('[data-listening-view="questions"]').waitFor();
    await captureChromeGeometry(page, "Listening Questions", chromeBaseline);
    await page.getByRole("button", { name: "Show Text", exact: true }).click();
    await page.locator('[data-listening-view="static-text"]').waitFor();
    await captureChromeGeometry(page, "Listening Static Text", chromeBaseline);
    await page.getByRole("button", { name: "Return to questions", exact: true }).click();
    await page.locator('[data-listening-view="questions"]').waitFor();
    await page.getByRole("button", { name: "Play full reading", exact: true }).click();
    await page.locator('[data-listening-view="karaoke"]').waitFor();
    await captureChromeGeometry(page, "Listening Karaoke", chromeBaseline);
    await openActivity(page, 1, "Reading · Exercise 3");
    await page.locator('[data-multiple-choice-panel="1"]').waitFor();
    await captureChromeGeometry(page, "Multiple Choice panel 1", chromeBaseline);
    await page.getByRole("button", { name: "Next activity part", exact: true }).click();
    await page.locator('[data-multiple-choice-panel="2"]').waitFor();
    await captureChromeGeometry(page, "Multiple Choice panel 2", chromeBaseline);
  });

  await capture({ width: 1280, height: 720 }, async (page) => {
    await assertScreen(page, "home-launcher-1280x720");
    await assertLegacyLauncher(page, "home-launcher-1280x720");
    await page.screenshot({ path: `${artifactRoot}/home-launcher-1280x720.png` });
    await openBook(page);
    await selectOverviewUnit(page, 1);
    await assertLegacyUnitOverview(page, 1, "students-book-unit1-overview-1280x720");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit1-overview-1280x720.png` });
    await selectOverviewUnit(page, 2);
    await assertLegacyUnitOverview(page, 2, "students-book-unit2-overview-1280x720");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit2-overview-1280x720.png` });
    await selectOverviewUnit(page, 1);
    await openPage(page, "pg 5");
    await assertScreen(page, "page-viewer-unit1-page5-1280x720");
    await assertLegacyPageViewer(page, "page-viewer-unit1-page5-1280x720");
    await page.screenshot({ path: `${artifactRoot}/page-viewer-unit1-page5-1280x720.png` });
  });

  await capture({ width: 1366, height: 768 }, async (page) => {
    await openBook(page);
    await selectOverviewUnit(page, 1);
    await openPage(page, "pg 5");
    await page
      .locator('.teacher-offline-page-hotspot[aria-label="Unit opener · Exercise 1"]')
      .click();
    await page.locator(".teacher-offline-embedded-activity").waitFor();
    await assertEmbeddedActivity(page, "unit-opener-1366x768");
    assert.equal(await page.getByRole("button", { name: "Library" }).count(), 0, "embedded activity has no redundant library button");
    assert.equal(await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).count(), 1, "embedded activity keeps one logical Back button");
    assert.equal(await page.locator(".legacy-page-heading strong").textContent(), "Unit opener", "unit opener keeps its parent page title");
    const compactResponseRegions = page.locator(".legacy-unit-opener-response-region");
    assert.equal(await compactResponseRegions.count(), 3);
    for (let index = 0; index < 3; index += 1) await compactResponseRegions.nth(index).click();
    await page.locator('.legacy-unit-opener-response-region[data-response-region-id$="q3-response"][data-revealed="true"]').waitFor();
    const unitOpenerFonts = await page.evaluate(() => ({
      question: getComputedStyle(document.querySelector(".legacy-unit-opener-question h3")).fontFamily,
      answer: getComputedStyle(document.querySelector(".legacy-unit-opener-response-region.is-revealed .response-region-text")).fontFamily,
      answerWeight: getComputedStyle(document.querySelector(".legacy-unit-opener-response-region.is-revealed .response-region-text")).fontWeight,
    }));
    assert.match(unitOpenerFonts.question, /Fira Sans/, "unit opener question uses the recovered Fira Sans family");
    assert.match(unitOpenerFonts.answer, /ITC Flora Std Medium/, "unit opener Response Region uses the publisher reveal family");
    assert.equal(unitOpenerFonts.answerWeight, "400", "unit opener Response Region uses the publisher reveal weight");
    await page.screenshot({ path: `${artifactRoot}/embedded-unit-opener-1366x768.png` });
    await page.locator("[data-teacher-book-navigation]").getByRole("button", { name: "Back", exact: true }).click();
    await waitForPageImage(page);
    await page
      .locator('.teacher-offline-page-hotspot[aria-label="Unit opener · Exercise 1"]')
      .click();
    await page.locator(".teacher-offline-embedded-activity").waitFor();
    await page.goBack();
    await waitForPageImage(page);
  });

  await capture({ width: 800, height: 360 }, async (page) => {
    await assertScreen(page, "home-launcher-800x360");
    await assertLegacyLauncher(page, "home-launcher-800x360");
    await page.screenshot({ path: `${artifactRoot}/home-launcher-800x360.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-home-800x360.png` });
    await page.getByRole("button", { name: "Open classroom settings" }).click();
    await page.getByRole("dialog", { name: "Classroom settings" }).waitFor();
    await page.screenshot({ path: `${artifactRoot}/settings-audio-800x360.png` });
    await page.getByRole("tab", { name: "About" }).click();
    await assertCleanAbout(page, "modern-about-800x360");
    await page.screenshot({ path: `${artifactRoot}/modern-about-800x360.png` });
    await page.getByRole("button", { name: "Close settings" }).click();
    await openBook(page);
    await assertLegacyUnitOverview(page, 1, "students-book-unit1-overview-800x360");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit1-overview-800x360.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-unit1-overview-800x360.png` });
    await selectOverviewUnit(page, 2);
    await assertLegacyUnitOverview(page, 2, "students-book-unit2-overview-800x360");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit2-overview-800x360.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-unit2-overview-800x360.png` });
    await selectOverviewUnit(page, 1);
    await openPage(page, "pg 5");
    await assertScreen(page, "page-viewer-unit1-page5-800x360");
    await assertLegacyPageViewer(page, "page-viewer-unit1-page5-800x360");
    await page.screenshot({ path: `${artifactRoot}/page-viewer-unit1-page5-800x360.png` });
    await page.screenshot({ path: `${artifactRoot}/normal-toolbar-800x360.png` });
  });

  await capture({ width: 2560, height: 1440 }, async (page) => {
    await assertScreen(page, "home-launcher-2560x1440");
    await assertLegacyLauncher(page, "home-launcher-2560x1440");
    await page.screenshot({ path: `${artifactRoot}/home-launcher-2560x1440.png` });
  });

  await capture({ width: 3840, height: 2160 }, async (page) => {
    await assertScreen(page, "home-launcher-3840x2160");
    await assertLegacyLauncher(page, "home-launcher-3840x2160");
    await page.screenshot({ path: `${artifactRoot}/home-launcher-3840x2160.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-home-3840x2160.png` });
    await page.getByRole("button", { name: "Open classroom settings" }).click();
    await page.getByRole("dialog", { name: "Classroom settings" }).waitFor();
    await page.screenshot({ path: `${artifactRoot}/settings-audio-3840x2160.png` });
    await page.getByRole("tab", { name: "Graphics" }).click();
    await page.locator('[data-settings-panel="graphics"]').waitFor();
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${artifactRoot}/settings-graphics-3840x2160.png` });
    await page.getByRole("tab", { name: "About" }).click();
    await assertCleanAbout(page, "modern-about-3840x2160");
    await page.screenshot({ path: `${artifactRoot}/modern-about-3840x2160.png` });
    await page.getByRole("button", { name: "Close settings" }).click();
    await openBook(page);
    await selectOverviewUnit(page, 1);
    await assertLegacyUnitOverview(page, 1, "students-book-unit1-overview-3840x2160");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit1-overview-3840x2160.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-unit1-overview-3840x2160.png` });
    await selectOverviewUnit(page, 2);
    await assertLegacyUnitOverview(page, 2, "students-book-unit2-overview-3840x2160");
    await page.screenshot({ path: `${artifactRoot}/students-book-unit2-overview-3840x2160.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-unit2-overview-3840x2160.png` });
    await selectOverviewUnit(page, 1);
    await openPage(page, "pg 5");
    await assertScreen(page, "page-viewer-unit1-page5-3840x2160");
    await assertLegacyPageViewer(page, "page-viewer-unit1-page5-3840x2160");
    await page.screenshot({ path: `${artifactRoot}/page-viewer-unit1-page5-3840x2160.png` });
    await page.screenshot({ path: `${artifactRoot}/modern-page-viewer-3840x2160.png` });
    await page.screenshot({ path: `${artifactRoot}/normal-toolbar-3840x2160.png` });
  });

  console.log(JSON.stringify({ status: "passed", screenshots: 50, chromeGeometryResults, artifactRoot }, null, 2));
} finally {
  await browser?.close();
  preview.kill();
}
