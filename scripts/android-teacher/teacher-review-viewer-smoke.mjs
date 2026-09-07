import { canonicalStudentsBookPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { chromium } from "@playwright/test";
import { localPlaywrightLaunchOptions } from "./playwright-launch-options.mjs";

const root = path.resolve(process.env.HHPLMS_VIEWER_DIR || "dist-netlify/ultimate-b2-interactive");
await access(path.join(root, "index.html"));
const hotspots = { schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug: "students-book", pages: {} };
const studentsUnits = Array.from({ length: 10 }, (_, i) => ({ id: `60000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, slug: `unit-${i + 1}`, title: `Unit ${i + 1}`, unitNumber: i + 1, sortOrder: i + 1 }));
const token = `v1.${Buffer.from("viewer-boundary-smoke").toString("base64url")}.${"a".repeat(43)}`;
const uiPath = "/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/ui-controller";
const hotspotsPath = "/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/hotspots";
const exchangePath = "/preview/authorization/exchange";
const studentsPagePath = "/preview/pages/books/ultimate-b2/components/ultimate-b2-students-book";
const workbookPagePath = "/preview/pages/books/ultimate-b2/components/ultimate-b2-workbook";
const workbookHotspotsPath = "/preview/content/books/ultimate-b2/components/ultimate-b2-workbook/hotspots";
const grammarPagePath = "/preview/pages/books/ultimate-b2/components/ultimate-b2-grammar-book";
const grammarHotspotsPath = "/preview/content/books/ultimate-b2/components/ultimate-b2-grammar-book/hotspots";
const hydrationPaths = Object.freeze([uiPath, hotspotsPath, studentsPagePath, workbookPagePath, workbookHotspotsPath, grammarPagePath, grammarHotspotsPath]);
const managedHydrationPaths = new Set([workbookPagePath, workbookHotspotsPath, grammarPagePath, grammarHotspotsPath]);
const testFlowHeader = "x-hhplms-test-flow";
const delayedManagedFixture = process.env.HHPLMS_VIEWER_BOUNDARY_DELAY_MANAGED === "1";
const mime = { ".css": "text/css", ".gaf": "application/octet-stream", ".html": "text/html", ".jpg": "image/jpeg", ".js": "text/javascript", ".json": "application/json", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".pdf": "application/pdf", ".png": "image/png", ".svg": "image/svg+xml" };
const previewRequestsByFlow = new Map();
const exchangesByFlow = new Map();
const activePreviewRequestsByFlow = new Map();
const delayedManagedRequests = new Set();
let releaseManagedResponses;
const managedResponseGate = new Promise((resolve) => { releaseManagedResponses = resolve; });

function valuesFor(map, flow) {
  if (!map.has(flow)) map.set(flow, []);
  return map.get(flow);
}

function previewRequestsFor(flow) {
  return valuesFor(previewRequestsByFlow, flow);
}

function exchangesFor(flow) {
  return valuesFor(exchangesByFlow, flow);
}

function assertNoPreviewRequests(requests, message) {
  assert.deepEqual(requests.map((url) => url.pathname), [], message);
}

async function awaitManagedFixture(flow, pathname) {
  if (!delayedManagedFixture || flow !== "authorized" || !managedHydrationPaths.has(pathname)) return;
  delayedManagedRequests.add(pathname);
  if ([...managedHydrationPaths].every((expected) => delayedManagedRequests.has(expected))) releaseManagedResponses();
  await managedResponseGate;
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Length": body.length, "Content-Type": "application/json" });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const flow = String(request.headers[testFlowHeader] || "unowned");
  if (url.pathname.startsWith("/preview/")) {
    previewRequestsFor(flow).push(url);
    activePreviewRequestsByFlow.set(flow, (activePreviewRequestsByFlow.get(flow) || 0) + 1);
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      activePreviewRequestsByFlow.set(flow, (activePreviewRequestsByFlow.get(flow) || 1) - 1);
    };
    response.once("finish", finish);
    response.once("close", finish);
  }
  if (url.pathname === exchangePath && request.method === "POST") {
    if (url.searchParams.get("previewAuthorization") !== token) return sendJson(response, 401, { error: "Unauthorized" });
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    exchangesFor(flow).push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return sendJson(response, 200, { token, expiresAt: new Date(Date.now() + 300_000).toISOString() });
  }
  if (url.pathname === uiPath) {
    if (url.searchParams.get("previewAuthorization") !== token) return sendJson(response, 401, { error: "Unauthorized" });
    return sendJson(response, 200, { document: { schemaVersion: "1.0", packageId: "ultimate-b2-students-book", assets: {} } });
  }
  if (url.pathname === hotspotsPath) return sendJson(response, 200, { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", resource: "hotspots", schemaVersion: "1.0", revision: 43, source: "database", document: hotspots });
  if (url.pathname === studentsPagePath) return sendJson(response, 200, { component: { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", kind: "students-book" }, units: studentsUnits, pages: canonicalStudentsBookPages.map((page) => ({ ...page, origin: "canonical", unitId: studentsUnits[page.unitNumber - 1].id })) });
  const managedPageMatch = url.pathname.match(/^\/preview\/pages\/books\/ultimate-b2\/components\/(ultimate-b2-(?:workbook|grammar-book))$/);
  if (managedPageMatch) {
    await awaitManagedFixture(flow, url.pathname);
    const componentSlug = managedPageMatch[1];
    return sendJson(response, 200, {
      component: { bookSlug: "ultimate-b2", componentSlug, kind: "managed" },
      units: Array.from({ length: 10 }, (_, index) => ({ id: `unit-${index + 1}`, slug: `unit-${index + 1}`, unitNumber: index + 1, title: `Unit ${index + 1}` })),
      pages: [],
    });
  }
  const managedHotspotMatch = url.pathname.match(/^\/preview\/content\/books\/ultimate-b2\/components\/(ultimate-b2-(?:workbook|grammar-book))\/hotspots$/);
  if (managedHotspotMatch) {
    await awaitManagedFixture(flow, url.pathname);
    const componentSlug = managedHotspotMatch[1];
    return sendJson(response, 200, { bookSlug: "ultimate-b2", componentSlug, document: { schemaVersion: "1.0", packageSlug: "ultimate-b2", componentSlug, pages: {} } });
  }
  if (url.pathname.startsWith("/preview/")) return sendJson(response, 401, { error: "Unauthorized" });
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`) && file !== path.join(root, "index.html")) return response.writeHead(404).end();
  const details = await stat(file).catch(() => null);
  if (!details?.isFile()) file = path.join(root, "index.html");
  const fallbackDetails = await stat(file);
  response.writeHead(200, { "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store", "Content-Length": fallbackDetails.size, "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" });
  createReadStream(file).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const openContexts = new Set();
try {
  browser = await chromium.launch(localPlaywrightLaunchOptions());

  const runFlow = async (flow, contextOptions, operation) => {
    const context = await browser.newContext({
      ...contextOptions,
      reducedMotion: "reduce",
      extraHTTPHeaders: { ...(contextOptions.extraHTTPHeaders || {}), "X-HHPLMS-Test-Flow": flow },
    });
    openContexts.add(context);
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => { if (message.type() === "error" && !/favicon|ERR_ABORTED|ERR_CACHE_MISS/i.test(message.text())) consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      const result = await operation({ page, consoleErrors });
      assert.deepEqual(consoleErrors, [], `${flow} must not emit console errors.`);
      assert.deepEqual(pageErrors, [], `${flow} must not emit unhandled page errors.`);
      return result;
    } finally {
      await context.close();
      openContexts.delete(context);
    }
  };

  const hydrationResponses = (page) => Promise.all(hydrationPaths.map((expectedPath) => page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === expectedPath && response.ok();
  })));
  const waitForLibrary = (page) => page.locator(".teacher-offline-library").waitFor();
  const waitForPreviewFailure = async (page, flow, consoleErrors) => {
    try {
      await page.locator('main[role="alert"], .teacher-offline-pack-error').first().waitFor();
    } catch (error) {
      console.error(JSON.stringify({ flow, url: page.url(), body: await page.locator("body").innerText(), consoleErrors }, null, 2));
      throw error;
    }
  };

  await runFlow("bare", { viewport: { width: 1366, height: 768 } }, async ({ page }) => {
    await page.goto(`${origin}/#library`, { waitUntil: "domcontentloaded" });
    await waitForLibrary(page);
    assert.equal(await page.title(), "Ultimate B2 Viewer");
    const bareRequests = previewRequestsFor("bare");
    assertNoPreviewRequests(bareRequests, "Bare Viewer must not request any preview endpoint.");
    assert.equal(bareRequests.filter((url) => /native-activities|native-draft|\/assets\//.test(url.pathname)).length, 0, "Bare Viewer must make zero native draft or draft asset requests.");
    assert.equal(await page.getByText("Publisher answer", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /Show all answers|Reveal model answer/i }).count(), 0);
  });

  const authorized = new URL(origin);
  authorized.search = new URLSearchParams({ builderPreview: "1", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", previewAuthorization: token, view: "library" });
  const authorizedResult = await runFlow("authorized", { viewport: { width: 1366, height: 768 } }, async ({ page }) => {
    const hydrated = hydrationResponses(page);
    await page.goto(authorized.toString(), { waitUntil: "domcontentloaded" });
    await waitForLibrary(page);
    await hydrated;
    const authorizedRequests = previewRequestsFor("authorized");
    for (const expectedPath of hydrationPaths) assert.ok(authorizedRequests.some((url) => url.pathname === expectedPath), `Authorized hydration must complete ${expectedPath}.`);
    const uiRequest = authorizedRequests.find((url) => url.pathname === uiPath);
    assert.equal(uiRequest?.searchParams.get("previewAuthorization"), token);
    assert.ok(authorizedRequests.some((url) => url.pathname === exchangePath), "Authorized Builder preview must exchange component authorization.");
    const installedComponentSlugs = new Set(["ultimate-b2-students-book", "ultimate-b2-workbook", "ultimate-b2-grammar-book"]);
    const authorizedExchanges = exchangesFor("authorized");
    assert.deepEqual(new Set(authorizedExchanges.map((exchange) => exchange.intent.componentSlug)), installedComponentSlugs);
    assert.ok(authorizedExchanges.every((exchange) => exchange.source.bookSlug === "ultimate-b2" && exchange.intent.bookSlug === "ultimate-b2" && installedComponentSlugs.has(exchange.source.componentSlug) && installedComponentSlugs.has(exchange.intent.componentSlug)));
    assert.equal(authorizedRequests.filter((url) => /teacher-solution|native-teacher|open-response-teacher/.test(url.pathname)).length, 0, "Teacher answer endpoints must remain on-demand.");
    assert.equal(authorizedRequests.filter((url) => /native-activities/.test(url.pathname)).length, 0, "Library preview must not receive native draft access.");
    assert.equal(await page.getByText("Publisher answer", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /Show all answers|Reveal model answer/i }).count(), 0);
    for (const edition of ["Workbook", "Grammar Book", "Students Book"]) {
      await page.getByRole("button", { name: edition, exact: true }).click();
      await waitForLibrary(page);
    }
    return { uiRequest };
  });

  for (const scenario of [
    { flow: "invalid-missing", search: new URLSearchParams({ builderPreview: "1", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", view: "library" }) },
    { flow: "invalid-malformed", search: new URLSearchParams({ builderPreview: "1", bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", previewAuthorization: "malformed", view: "library" }) },
  ]) {
    await runFlow(scenario.flow, { viewport: { width: 1366, height: 768 } }, async ({ page, consoleErrors }) => {
      await page.goto(`${origin}/?${scenario.search}`, { waitUntil: "domcontentloaded" });
      await waitForPreviewFailure(page, scenario.flow, consoleErrors);
      assertNoPreviewRequests(previewRequestsFor(scenario.flow), "Invalid preview authorization must fail before preview requests.");
      assert.equal(await page.getByText("Publisher answer", { exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: /Show all answers|Reveal model answer/i }).count(), 0);
    });
  }

  assert.throws(
    () => assertNoPreviewRequests([new URL(`${origin}${uiPath}`)], "Negative control must detect a preview request."),
    { code: "ERR_ASSERTION" },
    "The zero-preview-request assertion must fail when a preview request is present.",
  );

  const mobileResult = await runFlow("mobile-authorized", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, async ({ page }) => {
    const hydrated = hydrationResponses(page);
    await page.goto(authorized.toString(), { waitUntil: "domcontentloaded" });
    await waitForLibrary(page);
    await hydrated;
    assert.equal(await page.getByText("Viewer could not start", { exact: true }).count(), 0);
    const mobileRequests = previewRequestsFor("mobile-authorized");
    assert.equal(mobileRequests.find((url) => url.pathname === uiPath)?.searchParams.get("previewAuthorization"), token);
    assert.equal(mobileRequests.filter((url) => /teacher-solution|native-teacher|open-response-teacher/.test(url.pathname)).length, 0);
    const geometry = await page.locator(".teacher-fixed-stage").evaluate((stage) => {
      const stageRect = stage.getBoundingClientRect();
      const hostRect = stage.parentElement.getBoundingClientRect();
      const style = getComputedStyle(stage);
      return {
        logicalWidth: Number.parseFloat(style.width),
        logicalHeight: Number.parseFloat(style.height),
        scale: Number(stage.dataset.teacherStageScale),
        renderedWidth: stageRect.width,
        renderedHeight: stageRect.height,
        hostWidth: hostRect.width,
        hostHeight: hostRect.height,
        horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    assert.equal(geometry.logicalWidth, 1920);
    assert.equal(geometry.logicalHeight, 1080);
    assert.ok(geometry.scale > 0 && geometry.scale < 1);
    assert.ok(geometry.renderedWidth <= geometry.hostWidth + 1);
    assert.ok(geometry.renderedHeight <= geometry.hostHeight + 1);
    assert.equal(geometry.horizontalScroll, false);
    return geometry;
  });

  assertNoPreviewRequests(previewRequestsFor("invalid-missing"), "Late authorized Grammar requests must not enter the missing-authorization ledger.");
  assertNoPreviewRequests(previewRequestsFor("invalid-malformed"), "Late authorized Workbook requests must not enter the malformed-authorization ledger.");
  assertNoPreviewRequests(previewRequestsFor("unowned"), "Every preview request must have an explicit scenario owner.");
  if (delayedManagedFixture) assert.deepEqual(delayedManagedRequests, managedHydrationPaths, "The delayed fixture must exercise every managed hydration response.");
  assert.deepEqual([...activePreviewRequestsByFlow.entries()].filter(([, count]) => count !== 0), [], "All owned preview requests must finish before scenario cleanup.");
  assert.equal(openContexts.size, 0, "Every scenario context must be closed.");
  console.log(JSON.stringify({
    status: "public-viewer-boundary-safe",
    requestOwnership: "per-context-header",
    authorizedHydrationPaths: hydrationPaths.length,
    delayedManagedFixture,
    barePreviewRequests: 0,
    authorizedUiRequest: authorizedResult.uiRequest.pathname,
    authorizedUiToken: "present",
    unauthorizedPreviewRequests: 0,
    mobileAuthorizedPreview: "ready",
    mobileViewport: "390x844-touch",
    mobileHorizontalScroll: mobileResult.horizontalScroll,
    openContexts: openContexts.size,
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
