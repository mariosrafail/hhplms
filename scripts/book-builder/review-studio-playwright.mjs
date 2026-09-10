import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";
import { createServer } from "../../tests/_vite-test-server.mjs";

import { createBookBuilderStudioFixture, SYNTHETIC_TEACHER_SECRET } from "../../tests/helpers/book-builder-studio-fixture.mjs";
import { bookBuilderReviewStudioPlugin } from "./review-studio-api.mjs";
import { runRealWorkspaceValidation } from "./review-studio-validator.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const diagnosticsByPage = new WeakMap();

function installPageDiagnostics(page) {
  const diagnostics = [];
  const record = (value) => diagnostics.push(String(value).replaceAll(SYNTHETIC_TEACHER_SECRET, "[redacted]").slice(0, 2_000));
  diagnosticsByPage.set(page, diagnostics);
  page.on("console", (message) => {
    if (message.type() === "error") record(`[console:error] ${message.text()}`);
  });
  page.on("pageerror", (error) => record(`[pageerror] ${error.message}`));
  page.on("requestfailed", (request) => record(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText || "unknown failure"}`));
  page.on("response", (response) => {
    if (response.status() >= 400) record(`[response:${response.status()}] ${response.request().method()} ${response.url()}`);
  });
}

async function startStudio(workspace) {
  const server = await createServer({
    root: repositoryRoot,
    configFile: path.join(repositoryRoot, "vite.config.js"),
    appType: "mpa",
    logLevel: "error",
    plugins: [bookBuilderReviewStudioPlugin({ workspace })],
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function expectHeading(page, name) {
  try {
    await page.getByRole("heading", { name, exact: true }).waitFor({ state: "visible" });
  } catch (error) {
    const pageState = await page.evaluate(() => ({
      readyState: document.readyState,
      rootChildren: document.querySelector("#root")?.childElementCount ?? null,
      visibleText: document.body?.innerText.slice(0, 1_000) || "",
    })).catch((stateError) => ({ evaluationError: stateError.message }));
    pageState.visibleText = String(pageState.visibleText || "").replaceAll(SYNTHETIC_TEACHER_SECRET, "[redacted]");
    throw new Error([
      `Heading did not become ready: ${JSON.stringify(name)}`,
      `Final URL: ${page.url()}`,
      `Page state: ${JSON.stringify(pageState)}`,
      `Browser diagnostics: ${JSON.stringify((diagnosticsByPage.get(page) || []).slice(-20))}`,
      `Original failure: ${error.message}`,
    ].join("\n"));
  }
}

async function assertSafePage(page, networkBodies) {
  const body = await page.locator("body").innerText();
  assert.doesNotMatch(body, new RegExp(SYNTHETIC_TEACHER_SECRET));
  assert.doesNotMatch(body, /[A-Za-z]:\\(?:Users|AppData)|\/(?:Users|home)\/[A-Za-z0-9._-]+\//i);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "page-level horizontal overflow detected");
  assert.doesNotMatch(networkBodies.join("\n"), new RegExp(SYNTHETIC_TEACHER_SECRET));
}

async function validateHighHotspotLayout(page, origin, viewport, screenshotRoot) {
  await page.setViewportSize(viewport);
  await page.goto(`${origin}/builder.html?visual=${encodeURIComponent(viewport.name)}#/projects/fictional-ultimate-review/pages`, { waitUntil: "domcontentloaded" });
  await expectHeading(page, "Pages & Hotspots");
  await page.locator(".studio-page-image").waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".studio-page-image");
    return Boolean(image?.complete && image.naturalWidth > 0);
  });
  const metrics = await page.evaluate(() => {
    const toolbar = document.querySelector(".studio-inspector-toolbar").getBoundingClientRect();
    const layout = document.querySelector(".studio-page-layout");
    const frame = document.querySelector(".studio-page-preview-frame");
    const frameRect = frame.getBoundingClientRect();
    const detailsRect = document.querySelector(".studio-page-details").getBoundingClientRect();
    const imageRect = document.querySelector(".studio-page-image").getBoundingClientRect();
    const list = document.querySelector(".studio-hotspot-list");
    const listRect = list.getBoundingClientRect();
    const overlays = [...document.querySelectorAll(".studio-hotspot-overlay span")].map((item) => item.getBoundingClientRect());
    return {
      frameHeight: frameRect.height,
      frameTopGap: frameRect.top - toolbar.bottom,
      imageTopGap: imageRect.top - frameRect.top,
      imageVisible: imageRect.width > 100 && imageRect.height > 100,
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
      listOverflowY: getComputedStyle(list).overflowY,
      layoutColumns: getComputedStyle(layout).gridTemplateColumns,
      panelsStacked: detailsRect.top >= frameRect.bottom - 1,
      overlayCount: overlays.length,
      overlaysInsideImage: overlays.every((rect) => rect.left >= imageRect.left - 1 && rect.top >= imageRect.top - 1 && rect.right <= imageRect.right + 1 && rect.bottom <= imageRect.bottom + 1),
      pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      listRect: { top: listRect.top, bottom: listRect.bottom },
    };
  });
  assert.equal(metrics.overlayCount, 24);
  assert.equal(metrics.overlaysInsideImage, true);
  assert.equal(metrics.pageOverflow, 0);
  assert.ok(metrics.imageVisible, "high-hotspot page image must remain visible");
  assert.ok(metrics.imageTopGap <= 30, `page image starts ${metrics.imageTopGap}px below the preview frame`);
  assert.ok(metrics.listScrollHeight > metrics.listClientHeight, "high-hotspot list must scroll independently");
  assert.match(metrics.listOverflowY, /auto|scroll/);
  if (viewport.width > 820) {
    assert.ok(metrics.frameHeight <= 700, `desktop preview frame is unbounded at ${metrics.frameHeight}px`);
    assert.ok(metrics.frameTopGap <= 24, `preview begins ${metrics.frameTopGap}px below the toolbar`);
    assert.equal(metrics.panelsStacked, false);
    assert.ok(metrics.frameHeight < metrics.listScrollHeight, "preview frame must not stretch to hotspot content height");
  } else {
    assert.equal(metrics.panelsStacked, true);
  }
  const lastItem = page.locator(".studio-hotspot-list li").last();
  await lastItem.focus();
  await page.waitForTimeout(50);
  const focusState = await lastItem.evaluate((item) => {
    const itemRect = item.getBoundingClientRect();
    const list = item.closest(".studio-hotspot-list");
    const listRect = list.getBoundingClientRect();
    return {
      visible: itemRect.top >= listRect.top - 1 && itemRect.bottom <= listRect.bottom + 2,
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      maxScrollTop: list.scrollHeight - list.clientHeight,
      itemOffsetTop: item.offsetTop,
      itemTop: itemRect.top,
      itemBottom: itemRect.bottom,
      listTop: listRect.top,
      listBottom: listRect.bottom,
    };
  });
  assert.ok(focusState.scrollTop > 0, `focused hotspot did not scroll the list: ${JSON.stringify(focusState)}`);
  assert.equal(focusState.visible, true, `focused hotspot is outside the bounded list viewport: ${JSON.stringify(focusState)}`);
  await page.screenshot({ path: path.join(screenshotRoot, `studio-high-hotspot-${viewport.name}.png`), fullPage: true });
  return metrics;
}

async function run() {
  const fixture = await createBookBuilderStudioFixture();
  const primary = await startStudio(fixture.workspace);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    installPageDiagnostics(page);
    const networkBodies = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/__hhplms/book-builder/") || !String(response.headers()["content-type"] || "").includes("application/json")) return;
      try { networkBodies.push(await response.text()); } catch { /* response may have been cancelled during navigation */ }
    });

    await page.goto(`${primary.origin}/builder.html`, { waitUntil: "domcontentloaded" });
    await expectHeading(page, "Book Project dashboard");
    await page.getByText("Read-only review — start the explicit local authoring command to create decisions.").waitFor();
    await page.getByRole("heading", { name: "Fictional Ultimate Review Book" }).waitFor();
    await page.getByRole("heading", { name: "Fictional Journey Control" }).waitFor();
    const principalComponents = page.locator(".studio-project-components").first();
    await principalComponents.getByText("Students Book", { exact: true }).waitFor();
    await principalComponents.getByText("Workbook", { exact: true }).waitFor();
    await principalComponents.getByText("Grammar Book", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Incomplete projects" }).waitFor();
    await page.getByRole("heading", { name: "Ultimate B2 hotspot authoring" }).waitFor();
    await assertSafePage(page, networkBodies);

    await page.goto(`${primary.origin}/builder.html#/projects/fictional-ultimate-review/overview`, { waitUntil: "domcontentloaded" });
    await expectHeading(page, "Overview");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectHeading(page, "Overview");
    await page.getByText("The project is an authoring draft. Publication data is incomplete and no content has been published.").waitFor();

    await page.getByRole("tab", { name: "Components" }).click();
    await expectHeading(page, "Components");
    await page.locator("label.studio-field").filter({ hasText: /^Pages/ }).locator("select").selectOption("true");
    await page.locator("tbody").getByText("Effective: students_book", { exact: true }).waitFor();

    await page.getByRole("tab", { name: "Pages & Hotspots" }).click();
    await expectHeading(page, "Pages & Hotspots");
    const pageComponent = page.locator(".studio-hierarchy-navigator select").nth(0);
    const pageUnit = page.locator(".studio-hierarchy-navigator select").nth(1);
    assert.equal(await pageUnit.isDisabled(), true);
    await pageComponent.selectOption({ label: "Students Book" });
    await pageUnit.selectOption({ label: "Unit 1" });
    assert.match(page.url(), /component=componentkey_/);
    assert.match(page.url(), /unit=unitgroup_/);
    assert.deepEqual(await pageUnit.locator("option").allTextContents(), ["All Units", "Unit 1", "Unit 2", "Unit 3", "Unit 4"]);
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await pageComponent.inputValue(), await pageComponent.locator("option", { hasText: "Students Book" }).getAttribute("value"));
    assert.equal(await pageUnit.locator("option:checked").textContent(), "Unit 1");
    await page.getByAltText("Preview of course Unit 1 Part 1").waitFor();
    await page.getByText("Normalized geometry available").first().waitFor();
    await page.getByRole("button", { name: "Hide hotspots" }).click();
    assert.equal(await page.getByRole("button", { name: "Show hotspots" }).isVisible(), true);
    await pageComponent.selectOption({ label: "Workbook" });
    await page.waitForFunction(() => document.querySelectorAll(".studio-hierarchy-navigator select")[1]?.options.length === 3 && document.querySelectorAll(".studio-hierarchy-navigator select")[1]?.options[1]?.textContent === "Unit 1");
    assert.deepEqual(await page.locator(".studio-hierarchy-navigator select").nth(1).locator("option").allTextContents(), ["All Units", "Unit 1", "Unit 2"]);
    await page.locator(".studio-hierarchy-navigator select").nth(1).selectOption({ label: "Unit 1" });
    await page.getByRole("heading", { name: "Workbook · Unit 1 · Part 1", exact: true }).waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "Workbook · Unit 1 · Part 1", exact: true }).waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "Students Book · Unit 1 · Part 1", exact: true }).waitFor();
    await page.goForward();
    await page.getByRole("heading", { name: "Workbook · Unit 1 · Part 1", exact: true }).waitFor();
    await pageComponent.selectOption({ label: "Tests" });
    await page.waitForFunction(() => document.querySelectorAll(".studio-hierarchy-navigator select")[1]?.options[1]?.textContent === "Group 1");
    assert.deepEqual(await pageUnit.locator("option").allTextContents(), ["All groups", "Group 1", "Group 2"]);
    await page.getByRole("heading", { name: "No pages match these filters" }).waitFor();

    await page.getByRole("tab", { name: "Menu & Branding" }).click();
    await expectHeading(page, "Menu & Branding");
    await page.getByRole("heading", { name: "GAF timeline summary" }).waitFor();
    await page.getByRole("heading", { name: "Startup intro" }).waitFor();
    await page.getByText("The startup intro is explicitly distinct from the central on-menu title animation.").waitFor();
    await page.getByAltText("fictional-menu-preview.png").waitFor();

    await page.getByRole("tab", { name: "Activities", exact: true }).click();
    await expectHeading(page, "Activities");
    await page.getByText("152 items").waitFor();
    await page.locator(".studio-hierarchy-navigator select").nth(0).selectOption({ label: "Workbook" });
    await page.getByText("32 items").waitFor();
    await page.locator(".studio-hierarchy-navigator select").nth(0).selectOption({ label: "Grammar Book" });
    await page.waitForFunction(() => document.querySelectorAll(".studio-selectable-table tbody tr").length === 20);
    await page.locator(".studio-hierarchy-navigator select").nth(0).selectOption("");
    await page.getByLabel("Completeness").selectOption("raster-gaps");
    await page.getByText("Structured content has raster-only or missing text gaps.").waitFor();
    await page.getByText("Labels remain independent. Correct drag/drop mappings are never available here.").waitFor();

    await page.getByRole("tab", { name: "Review Queue" }).click();
    await expectHeading(page, "Review Queue");
    await page.getByText("5,007", { exact: true }).first().waitFor();
    await page.locator(".studio-hierarchy-navigator select").nth(0).selectOption({ label: "Students Book" });
    await page.waitForFunction(() => document.querySelectorAll(".studio-hierarchy-navigator select")[1]?.options.length === 5);
    await page.locator(".studio-hierarchy-navigator select").nth(1).selectOption({ label: "Unit 1" });
    await page.getByLabel("Group by").selectOption("unit");
    await page.getByText("Students Book · Unit 1", { exact: true }).first().waitFor();
    await page.getByLabel("Group by").selectOption("cluster");
    await page.getByText("120 candidates").waitFor();
    assert.equal(await page.getByRole("button", { name: /approve|dismiss|apply/i }).count(), 0);

    await page.getByRole("tab", { name: "Source Diff" }).click();
    await expectHeading(page, "Source Diff");
    await page.getByText("Revision 2 → 3").waitFor();
    await page.getByText("fact_fictional_1").waitFor();
    await assertSafePage(page, networkBodies);

    await page.goto(`${primary.origin}/builder.html#/projects/not-a-project/overview`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Book Project unavailable" }).waitFor();
    const internalStatus = await page.evaluate(async () => (await fetch("/__hhplms/book-builder/projects/fictional-ultimate-review/internal")).status);
    assert.notEqual(internalStatus, 200);

    await page.goto(`${primary.origin}/ultimate-b2-builder.html`, { waitUntil: "domcontentloaded" });
    await expectHeading(page, "Builder sign in");
    assert.equal(await page.getByRole("heading", { name: "Students Book hotspot builder", exact: true }).count(), 0);

    const viewports = [
      { width: 1280, height: 720, name: "1280x720" },
      { width: 1920, height: 1080, name: "1920x1080" },
      { width: 768, height: 900, name: "768-tablet" },
      { width: 390, height: 844, name: "390-mobile" },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${primary.origin}/builder.html`, { waitUntil: "domcontentloaded" });
      await expectHeading(page, "Book Project dashboard");
      await assertSafePage(page, networkBodies);
      await page.screenshot({ path: path.join(fixture.root, `studio-${viewport.name}.png`), fullPage: true });
    }

    const highHotspotViewports = [
      { width: 1440, height: 900, name: "1440x900" },
      { width: 1280, height: 720, name: "1280x720" },
      { width: 768, height: 900, name: "768-tablet" },
      { width: 390, height: 844, name: "390-mobile" },
    ];
    const highHotspotMetrics = [];
    for (const viewport of highHotspotViewports) highHotspotMetrics.push({
      viewport: viewport.name,
      ...await validateHighHotspotLayout(page, primary.origin, viewport, fixture.root),
    });

    const mixedValidation = await runRealWorkspaceValidation({
      url: primary.origin,
      screenshotDirectory: path.join(fixture.root, "mixed-validator-screenshots"),
    });
    assert.equal(mixedValidation.status, "real-workspace-safe");
    assert.equal(mixedValidation.projectCapabilityMatrix[0].projectId, fixture.olderUltimate.projectId);
    assert.equal(mixedValidation.selectedProjects.activities, fixture.ultimate.projectId);
    assert.equal(mixedValidation.selectedProjects.activityClusters, fixture.ultimate.projectId);
    assert.doesNotMatch(JSON.stringify(mixedValidation), new RegExp(SYNTHETIC_TEACHER_SECRET));

    const oldOnlyWorkspace = path.join(fixture.root, "old-only-workspace");
    await fs.mkdir(path.join(oldOnlyWorkspace, "projects"), { recursive: true });
    await fs.cp(fixture.olderUltimate.projectRoot, path.join(oldOnlyWorkspace, "projects", fixture.olderUltimate.projectId), { recursive: true });
    const oldOnly = await startStudio(oldOnlyWorkspace);
    let oldOnlyValidation;
    const oldOnlyStarted = performance.now();
    try {
      oldOnlyValidation = await runRealWorkspaceValidation({
        url: oldOnly.origin,
        screenshotDirectory: path.join(fixture.root, "old-only-validator-screenshots"),
      });
    } finally { await oldOnly.server.close(); }
    assert.equal(oldOnlyValidation.status, "real-workspace-incomplete");
    assert.ok(performance.now() - oldOnlyStarted < 20_000, "old-only validation must not wait for an unavailable heading timeout");
    assert.equal(oldOnlyValidation.selectedProjects.activities, null);
    assert.equal(oldOnlyValidation.selectedProjects.activityClusters, null);
    assert.ok(oldOnlyValidation.missingCapabilities.includes("activitiesAvailable"));
    assert.ok(oldOnlyValidation.screenshots.files.some((file) => file.endsWith("activities-unavailable.png")));
    assert.ok(oldOnlyValidation.screenshots.files.some((file) => file.endsWith("activity-clusters-unavailable.png")));
    assert.doesNotMatch(JSON.stringify(oldOnlyValidation), new RegExp(SYNTHETIC_TEACHER_SECRET));

    const emptyWorkspace = path.join(fixture.root, "empty-workspace");
    await fs.mkdir(path.join(emptyWorkspace, "projects"), { recursive: true });
    const empty = await startStudio(emptyWorkspace);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${empty.origin}/builder.html`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "No Book Projects found" }).waitFor();
    } finally { await empty.server.close(); }

    process.stdout.write(`${JSON.stringify({
      status: "review-studio-visual-safe",
      flows: 14,
      viewports: viewports.map((item) => item.name),
      syntheticReviews: 5007,
      mixedValidatorStatus: mixedValidation.status,
      oldOnlyValidatorStatus: oldOnlyValidation.status,
      highHotspotMetrics,
      screenshots: "temporary",
    }, null, 2)}\n`);
  } finally {
    await browser?.close();
    await primary.server.close();
    await fixture.cleanup();
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
