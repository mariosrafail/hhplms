import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { chromium } from "@playwright/test";
import { canonicalStudentsBookPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { componentPageLayoutPolicy, splitUnitPageRows } from "../../src/apps/book-builder/hosted/componentPageRows.js";
import { localPlaywrightLaunchOptions } from "../android-teacher/playwright-launch-options.mjs";

const root = path.resolve("dist-netlify/ultimate-b2-builder");
const mime = { ".css": "text/css", ".html": "text/html", ".jpg": "image/jpeg", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const imageA = await readFile("unit/1/parts/HD/parts_part_1.png");
const imageB = await readFile("unit/1/parts/HD/parts_part_2.png");
const managedSlugs = ["ultimate-b2-students-book", "ultimate-b2-workbook", "ultimate-b2-grammar-book"];
const unitsFor = (componentSlug) => Array.from({ length: 10 }, (_, index) => ({ id: `${componentSlug}-unit-${index + 1}`, slug: `unit-${index + 1}`, title: `Unit ${index + 1}`, unitNumber: index + 1, sortOrder: index + 1 }));
const managedImage = (uploadId, bytes) => ({ source: "managed", assetId: uploadId, url: `/test-uploaded/${uploadId}`, originalFilename: "browser-page.png", mimeType: "image/png", byteSize: bytes.length, checksumSha256: "a".repeat(64), width: 581, height: 794 });
const legacyAssetId = "40000000-0000-4000-8000-000000000001";
const managedFixturePage = (componentSlug, unitNumber, printedLabel, index) => ({
  id: `${componentSlug.endsWith("workbook") ? "wb" : "gb"}-u${unitNumber}-${printedLabel.replaceAll(/[^0-9]+/g, "-")}-${index}`,
  stableKey: `${componentSlug}/pages/unit-${unitNumber}-${index}`,
  componentSlug,
  source: "managed",
  unitId: `${componentSlug}-unit-${unitNumber}`,
  unitSlug: `unit-${unitNumber}`,
  unitNumber,
  unitTitle: `Unit ${unitNumber}`,
  unitSortOrder: unitNumber,
  printedPages: [],
  printedLabel,
  sortOrder: (unitNumber * 100) + index,
  label: `${componentSlug.endsWith("workbook") ? "Workbook" : "Grammar"} page ${printedLabel}`,
  image: managedImage(legacyAssetId, imageA),
});
const workbookUnit7 = ["70-71", "72-73", "74-75", "76", "77", "78-79"].map((label, index) => managedFixturePage("ultimate-b2-workbook", 7, label, index + 1));
const grammarUnit4 = ["40", "41-42", "43"].map((label, index) => managedFixturePage("ultimate-b2-grammar-book", 4, label, index + 1));
const state = {
  "ultimate-b2-students-book": { revision: 0, hotspotRevision: 0, units: unitsFor("ultimate-b2-students-book"), pages: canonicalStudentsBookPages.map((page) => ({ ...page, origin: "canonical", unitId: `ultimate-b2-students-book-unit-${page.unitNumber}`, unitSortOrder: page.unitNumber })), deletedPages: [] },
  "ultimate-b2-workbook": { revision: 0, hotspotRevision: 0, units: unitsFor("ultimate-b2-workbook"), pages: [...workbookUnit7, { id: "wb-legacy-unassigned", stableKey: "ultimate-b2-workbook/pages/wb-legacy-unassigned", componentSlug: "ultimate-b2-workbook", source: "managed", unitId: null, unitSlug: null, unitNumber: null, unitTitle: "", unitSortOrder: null, printedPages: [], printedLabel: "L", sortOrder: 1, label: "Legacy unassigned", image: managedImage(legacyAssetId, imageA) }], deletedPages: [] },
  "ultimate-b2-grammar-book": { revision: 0, hotspotRevision: 0, units: unitsFor("ultimate-b2-grammar-book"), pages: grammarUnit4, deletedPages: [] },
};
const sessions = new Map();
const uploads = new Map([[legacyAssetId, imageA]]);
const reviewIntents = [];
let nextMutationFailure = null;
let previewAuthorizationRequests = 0;
let origin;

function json(response, status, value) { const encoded = JSON.stringify(value); response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(encoded), "Cache-Control": "no-store" }); response.end(encoded); }
async function requestBody(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); }
function projectPage(componentSlug, page) { return { ...page, capabilities: { moveUp: true, moveDown: true, editMetadata: true, replaceImage: true, restoreCanonicalImage: componentSlug.endsWith("students-book") && page.source === "override", deletePage: true } }; }
function projectDeleted(page) { return { ...page, canRestore: true, canDeleteCompletely: true }; }
function library(componentSlug) { const current = state[componentSlug]; const title = componentSlug.endsWith("workbook") ? "Workbook" : componentSlug.endsWith("grammar-book") ? "Grammar Book" : "Students Book"; return { revision: current.revision, hotspotRevision: current.hotspotRevision, component: { bookSlug: "ultimate-b2", componentSlug, kind: managedSlugs.includes(componentSlug) ? "managed" : "students-book", title, capabilities: { restoreDeletedPage: true, deleteCompletely: true } }, units: current.units, pages: current.pages.map((page) => projectPage(componentSlug, page)), deletedPages: current.deletedPages.map(projectDeleted) }; }
function unitMetadata(current, unitId) { const unit = current.units.find((candidate) => candidate.id === unitId); return unit ? { unitId: unit.id, unitSlug: unit.slug, unitNumber: unit.unitNumber, unitTitle: unit.title, unitSortOrder: unit.sortOrder } : { unitId: null, unitSlug: null, unitNumber: null, unitTitle: "", unitSortOrder: null }; }

async function pagesApi(request, response, url) {
  const match = url.pathname.match(/^\/builder\/api\/pages\/books\/ultimate-b2\/components\/(ultimate-b2-(?:students-book|workbook|grammar-book))(.*)$/);
  if (!match) return false;
  const [, componentSlug, suffix] = match; const current = state[componentSlug];
  if (!suffix && request.method === "GET") { json(response, 200, library(componentSlug)); return true; }
  const input = request.method === "POST" ? JSON.parse((await requestBody(request)).toString("utf8")) : {};
  if (suffix === "/assets/prepare") {
    if (input.expectedRevision !== current.revision) { json(response, 409, { error: "revision_conflict", currentRevision: current.revision }); return true; }
    if (managedSlugs.includes(componentSlug) && input.mode === "create" && !current.units.some((unit) => unit.id === input.metadata.unitId)) { json(response, 400, { error: "invalid_page_unit" }); return true; }
    const prefix = componentSlug.endsWith("students-book") ? "sb" : componentSlug.endsWith("workbook") ? "wb" : "gb"; const pageId = input.mode === "create" ? `${prefix}-page-${input.clientMutationId.replaceAll("-", "")}` : input.pageId; const uploadId = input.clientMutationId;
    sessions.set(uploadId, { componentSlug, pageId, mode: input.mode, metadata: input.metadata }); json(response, 200, { pageId, uploadId, expectedRevision: current.revision, expiresIn: 900, authorization: { url: `${origin}/test-upload/${uploadId}`, headers: { "Content-Type": input.file.type } }, idempotent: false }); return true;
  }
  if (suffix === "/assets/finalize") {
    const session = sessions.get(input.uploadId); const bytes = uploads.get(input.uploadId); if (!session || session.componentSlug !== componentSlug || !bytes) { json(response, 409, { error: "session_identity_conflict" }); return true; }
    if (session.mode === "create") current.pages.push({ id: session.pageId, stableKey: `${componentSlug}/pages/${session.pageId}`, componentSlug, origin: "managed", source: "managed", ...unitMetadata(current, session.metadata.unitId), printedPages: [], printedLabel: session.metadata.printedLabel, sortOrder: session.metadata.sortOrder, label: session.metadata.label, image: managedImage(input.uploadId, bytes) });
    else { const index = current.pages.findIndex((page) => page.id === session.pageId); const existing = current.pages[index]; current.pages[index] = { ...existing, source: componentSlug.endsWith("students-book") ? "override" : "managed", image: managedImage(input.uploadId, bytes), ...(componentSlug.endsWith("students-book") ? { baselineImage: existing.baselineImage || existing.image } : {}) }; }
    current.revision += 1; json(response, 200, { ...library(componentSlug), idempotent: false }); return true;
  }
  const mutation = suffix.match(/^\/pages\/([a-z0-9-]+)\/(metadata|reorder|delete|restore|restore-image|purge)$/); if (!mutation) { json(response, 404, { error: "page_route_not_found" }); return true; }
  const [, pageId, action] = mutation; const index = current.pages.findIndex((page) => page.id === pageId); const deletedIndex = current.deletedPages.findIndex((page) => page.id === pageId); if (index < 0 && !(["restore", "purge"].includes(action) && deletedIndex >= 0)) { json(response, 404, { error: "page_not_found" }); return true; }
  if (nextMutationFailure) { const failure = nextMutationFailure; nextMutationFailure = null; json(response, failure.status, { error: failure.code, currentRevision: current.revision, currentHotspotRevision: current.hotspotRevision }); return true; }
  if (action === "restore" && deletedIndex >= 0) {
    const [deleted] = current.deletedPages.splice(deletedIndex, 1);
    const { removedHotspotCount: _removed, preservedActivityCount: _preserved, ...restored } = deleted;
    current.pages.push(restored);
    current.pages.sort((left, right) => (left.unitSortOrder ?? left.unitNumber ?? Number.MAX_SAFE_INTEGER) - (right.unitSortOrder ?? right.unitNumber ?? Number.MAX_SAFE_INTEGER) || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  } else if (action === "restore-image") {
    const baseline = canonicalStudentsBookPages.find((page) => page.id === pageId);
    current.pages[index] = { ...current.pages[index], source: "metadata-override", image: baseline.image };
    delete current.pages[index].baselineImage;
  } else if (action === "purge" && deletedIndex >= 0) current.deletedPages.splice(deletedIndex, 1);
  else if (action === "delete") { const [deleted] = current.pages.splice(index, 1); current.deletedPages.push({ ...deleted, removedHotspotCount: componentSlug.endsWith("students-book") ? 2 : 1, preservedActivityCount: componentSlug.endsWith("students-book") ? 3 : 2 }); current.hotspotRevision += 1; }
  else current.pages[index] = { ...current.pages[index], ...input.metadata, ...(current.pages[index].origin !== "canonical" ? unitMetadata(current, input.metadata.unitId) : { source: current.pages[index].source === "override" ? "override" : "metadata-override" }) };
  if (action === "metadata" || action === "reorder") current.pages.sort((left, right) => (left.unitSortOrder ?? Number.MAX_SAFE_INTEGER) - (right.unitSortOrder ?? Number.MAX_SAFE_INTEGER) || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  current.revision += 1; json(response, 200, { ...library(componentSlug), idempotent: false }); return true;
}

async function staticFile(pathname, response) { const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, ""); let file = path.resolve(root, relative); let details = file.startsWith(`${root}${path.sep}`) ? await stat(file).catch(() => null) : null; if (!details?.isFile()) { file = path.join(root, "index.html"); details = await stat(file); } response.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream", "Content-Length": details.size }); createReadStream(file).pipe(response); }
const server = createServer(async (request, response) => { const url = new URL(request.url, "http://127.0.0.1"); if (url.pathname === "/builder/api/auth" && url.searchParams.get("action") === "me") return json(response, 200, { authenticated: true, builderUser: { id: "pages-browser", full_name: "Pages Browser", role: "developer", status: "active" } }); if (url.pathname === "/builder/api/preview-authorization" && request.method === "POST") { previewAuthorizationRequests += 1; return json(response, 200, { token: `v2.eA.${"a".repeat(43)}`, expiresAt: "2099-01-01T00:00:00.000Z" }); } if (url.pathname.startsWith("/test-upload/") && request.method === "PUT") { uploads.set(url.pathname.split("/").at(-1), await requestBody(request)); response.writeHead(200); response.end(); return; } if (url.pathname.startsWith("/test-uploaded/")) { const bytes = uploads.get(url.pathname.split("/").at(-1)); if (!bytes) return json(response, 404, {}); response.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length }); response.end(bytes); return; } if (await pagesApi(request, response, url)) return; await staticFile(url.pathname, response); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`;

function group(page, title) { return page.locator(".component-pages-groups section", { has: page.getByRole("heading", { name: new RegExp(`^${title}\\b`) }) }); }
function pageRow(page, unitTitle, rowName) { return group(page, unitTitle).locator(`[data-page-row="${rowName}"]`); }
async function assertPageGroupsReady(page, expected) { const groups = page.locator(".component-pages-groups"); await groups.waitFor(); assert.equal(await groups.locator("section").count(), expected); }
async function addFiles(page, unitTitle, files) { const chooser = page.waitForEvent("filechooser"); await group(page, unitTitle).getByRole("button", { name: "Add pages" }).click(); await (await chooser).setFiles(files); await page.locator(".component-pages-progress").waitFor({ state: "hidden" }); }
async function assertUnitLayout(page, componentSlug, unitNumber, expectedLabels = null, expectedWeights = null, expectNoRowScroll = true) {
  const expectedImageHeight = componentPageLayoutPolicy(componentSlug).imageHeight;
  const ordered = state[componentSlug].pages.filter((item) => item.unitNumber === unitNumber);
  const expected = splitUnitPageRows(ordered);
  const unit = group(page, `Unit ${unitNumber}`);
  if (ordered.length) await unit.locator(`[data-page-id="${ordered[0].id}"]`).waitFor();
  const rows = unit.locator("[data-page-row]");
  const rowNames = expected.bottom.length ? ["top", "bottom"] : ["top"];
  assert.equal(await rows.count(), rowNames.length);
  assert.equal(await unit.getAttribute("data-page-unit"), `${componentSlug}-unit-${unitNumber}`);

  const actualIds = [];
  const actualLabels = [];
  const actualWeights = [];
  for (const rowName of rowNames) {
    const row = pageRow(page, `Unit ${unitNumber}`, rowName);
    const cards = row.locator(".component-page-card");
    const ids = await cards.evaluateAll((items) => items.map((item) => item.dataset.pageId));
    const labels = await cards.evaluateAll((items) => items.map((item) => item.dataset.printedLabel));
    const weights = (await cards.evaluateAll((items) => items.map((item) => Number(item.dataset.pageWeight)))).reduce((sum, weight) => sum + weight, 0);
    actualIds.push(ids); actualLabels.push(labels); actualWeights.push(weights);
    const geometry = await row.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    if (expectNoRowScroll) assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `Unit ${unitNumber} ${rowName} unexpectedly scrolls at 1440px`);
    const cardGeometry = await cards.evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); const imageButton = item.querySelector(".component-page-image"); const image = imageButton?.querySelector("img"); const actions = item.querySelector(".component-page-actions"); return { y: box.y, cardOverflow: item.scrollWidth - item.clientWidth, actionsOverflow: actions ? actions.scrollWidth - actions.clientWidth : 0, imageHeight: imageButton?.getBoundingClientRect().height, objectFit: image ? getComputedStyle(image).objectFit : "" }; }));
    assert.ok(cardGeometry.every(({ y }) => Math.abs(y - cardGeometry[0].y) < 1), `Unit ${unitNumber} ${rowName} wrapped visually`);
    assert.ok(cardGeometry.every(({ cardOverflow, actionsOverflow }) => cardOverflow <= 1 && actionsOverflow <= 1), `Unit ${unitNumber} ${rowName} card content overflowed`);
    assert.ok(cardGeometry.every(({ imageHeight, objectFit }) => Math.abs(imageHeight - expectedImageHeight) <= 1 && objectFit === "contain"), `Unit ${unitNumber} ${rowName} image fitting changed`);
  }

  const expectedIds = [expected.top.map((item) => item.id), expected.bottom.map((item) => item.id)].slice(0, rowNames.length);
  assert.deepEqual(actualIds, expectedIds);
  assert.deepEqual(actualIds.flat(), ordered.map((item) => item.id));
  assert.equal(new Set(actualIds.flat()).size, ordered.length);
  if (expectedLabels) assert.deepEqual(actualLabels, expectedLabels);
  if (expectedWeights) assert.deepEqual(actualWeights, expectedWeights);
  return { ids: actualIds, labels: actualLabels, weights: actualWeights };
}
async function capture(page, name, locator = null) {
  if (!process.env.PAGE_LIBRARY_SCREENSHOT_DIR) return;
  await mkdir(process.env.PAGE_LIBRARY_SCREENSHOT_DIR, { recursive: true });
  await (locator || page).screenshot({ path: path.join(process.env.PAGE_LIBRARY_SCREENSHOT_DIR, `${name}.png`), ...(locator ? {} : { fullPage: true }) });
}

let browser;
try {
  browser = await chromium.launch(localPlaywrightLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("https://hhplms-viewer.netlify.app/**", async (route) => { const url = new URL(route.request().url()); reviewIntents.push(Object.fromEntries(url.searchParams)); await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><h1>Canonical Viewer fixture</h1>" }); });

  await page.goto(`${origin}/#/books/ultimate-b2/components/ultimate-b2-workbook/pages`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Page library" }).waitFor();
  await assertPageGroupsReady(page, 11);
  for (let number = 1; number <= 10; number += 1) await group(page, `Unit ${number}`).waitFor();
  const workbookRows = await assertUnitLayout(page, "ultimate-b2-workbook", 7, [["70-71", "72-73", "74-75"], ["76", "77", "78-79"]], [6, 4]);
  const workbookImageHeight = await pageRow(page, "Unit 7", "top").locator(".component-page-image").first().evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(Math.abs(workbookImageHeight - 150) <= 1);
  await capture(page, "workbook-unit-7", group(page, "Unit 7"));

  const firstWorkbookFixtureId = workbookUnit7[0].id;
  await page.locator(`[data-page-id="${firstWorkbookFixtureId}"]`).getByTitle("Move later in this Unit").click();
  await page.waitForFunction((id) => document.querySelector('[data-page-unit="ultimate-b2-workbook-unit-7"] [data-page-row="top"] .component-page-card')?.dataset.pageId !== id, firstWorkbookFixtureId);
  const reorderedRows = await assertUnitLayout(page, "ultimate-b2-workbook", 7);
  assert.deepEqual(reorderedRows.ids.flat().slice(0, 2), [workbookUnit7[1].id, firstWorkbookFixtureId]);
  await page.locator(`[data-page-id="${firstWorkbookFixtureId}"]`).getByTitle("Move earlier in this Unit").click();
  await page.waitForFunction((id) => document.querySelector('[data-page-unit="ultimate-b2-workbook-unit-7"] [data-page-row="top"] .component-page-card')?.dataset.pageId === id, firstWorkbookFixtureId);
  assert.deepEqual((await assertUnitLayout(page, "ultimate-b2-workbook", 7)).ids, workbookRows.ids);

  await group(page, "Unassigned").locator(".component-page-card-copy strong", { hasText: "Legacy unassigned" }).waitFor();
  assert.equal(await group(page, "Unassigned").locator("[data-page-row]").count(), 0);
  await group(page, "Unassigned").getByTitle("Edit metadata").click();
  await page.getByLabel("Unit").selectOption({ label: "Unit 1" });
  await page.getByRole("button", { name: "Save metadata" }).click();
  await group(page, "Unit 1").locator(".component-page-card-copy strong", { hasText: "Legacy unassigned" }).waitFor();
  await addFiles(page, "Unit 1", [{ name: "Workbook A.png", mimeType: "image/png", buffer: imageA }, { name: "Workbook B.png", mimeType: "image/png", buffer: imageB }]);
  assert.deepEqual(await group(page, "Unit 1").locator(".component-page-card-copy strong").allTextContents(), ["Legacy unassigned", "Workbook A", "Workbook B"]);
  const newlyPersisted = group(page, "Unit 1").locator(".component-page-card", { hasText: "Workbook B" });
  const newlyPersistedId = await newlyPersisted.getAttribute("data-page-id");
  assert.ok(newlyPersistedId);
  await newlyPersisted.getByRole("button", { name: "Preview Workbook B" }).click();
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.frameLocator(".unified-builder-review-dialog iframe").getByRole("heading", { name: "Canonical Viewer fixture" }).waitFor();
  assert.deepEqual({ componentSlug: reviewIntents.at(-1).componentSlug, view: reviewIntents.at(-1).view, pageId: reviewIntents.at(-1).pageId }, { componentSlug: "ultimate-b2-workbook", view: "library", pageId: undefined });
  await page.getByRole("button", { name: "Close Review" }).click();

  const workbookA = group(page, "Unit 1").locator(".component-page-card", { hasText: "Workbook A" });
  const stableId = await workbookA.getAttribute("data-page-id");
  await workbookA.getByTitle("Edit metadata").click();
  await page.getByLabel("Unit").selectOption({ label: "Unit 2" });
  await page.getByLabel("Label").fill("Workbook opening page");
  await page.getByLabel("Printed page or spread").fill("2");
  await page.getByRole("button", { name: "Save metadata" }).click();
  await group(page, "Unit 2").locator(".component-page-card-copy strong", { hasText: "Workbook opening page" }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await group(page, "Unit 2").locator(".component-page-card-copy strong", { hasText: "Workbook opening page" }).waitFor();
  assert.equal(await group(page, "Unit 2").locator(".component-page-card").getAttribute("data-page-id"), stableId);
  assert.deepEqual((await assertUnitLayout(page, "ultimate-b2-workbook", 7)).ids, workbookRows.ids);
  const replacement = page.waitForEvent("filechooser");
  await group(page, "Unit 2").getByTitle("Replace page image").click();
  await (await replacement).setFiles({ name: "replacement.png", mimeType: "image/png", buffer: imageB });
  await page.locator(".component-pages-progress").waitFor({ state: "hidden" });
  const workbookB = group(page, "Unit 1").locator(".component-page-card", { hasText: "Workbook B" });
  await workbookB.getByTitle("Delete page").click();
  await page.locator(".builder-modal").getByRole("button", { name: "Delete page" }).click();
  await workbookB.waitFor({ state: "detached" });
  const workbookDeleted = page.locator(".component-deleted-pages");
  await workbookDeleted.locator("summary").click();
  await workbookDeleted.getByText(/2 activities preserved/).waitFor();
  await workbookDeleted.getByRole("button", { name: "Restore page" }).click();
  await group(page, "Unit 1").locator(".component-page-card", { hasText: "Workbook B" }).waitFor();
  await group(page, "Unit 1").locator(".component-page-card", { hasText: "Workbook B" }).getByTitle("Delete page").click();
  await page.locator(".builder-modal").getByRole("button", { name: "Delete page" }).click();
  await workbookDeleted.locator("summary").click();
  await workbookDeleted.getByRole("button", { name: "Delete completely" }).click();
  const purgeModal = page.locator(".builder-modal");
  await purgeModal.getByText("This page cannot be restored after this action.", { exact: true }).waitFor();
  await purgeModal.getByText(/Activities will remain Unassigned, and historical releases are unaffected\./).waitFor();
  await purgeModal.getByRole("button", { name: "Delete completely" }).click();
  await workbookDeleted.waitFor({ state: "detached" });
  assert.equal(state["ultimate-b2-workbook"].pages.some((item) => item.id === newlyPersistedId), false);
  assert.equal(state["ultimate-b2-workbook"].deletedPages.some((item) => item.id === newlyPersistedId), false);

  await page.goto(`${origin}/#/books/ultimate-b2/components/ultimate-b2-grammar-book/pages`, { waitUntil: "domcontentloaded" });
  await page.getByText("Grammar Book · Pages").waitFor();
  await assertPageGroupsReady(page, 11);
  const grammarRows = await assertUnitLayout(page, "ultimate-b2-grammar-book", 4, [["40", "41-42"], ["43"]], [3, 1]);
  const grammarImageHeight = await pageRow(page, "Unit 4", "top").locator(".component-page-image").first().evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(Math.abs(grammarImageHeight - 150) <= 1);
  await capture(page, "grammar-book-unit-4", group(page, "Unit 4"));
  await addFiles(page, "Unit 10", [{ name: "Grammar A.png", mimeType: "image/png", buffer: imageA }, { name: "Grammar B.png", mimeType: "image/png", buffer: imageB }]);
  assert.deepEqual(await group(page, "Unit 10").locator(".component-page-card-copy strong").allTextContents(), ["Grammar A", "Grammar B"]);
  await assertUnitLayout(page, "ultimate-b2-grammar-book", 10);
  await page.reload({ waitUntil: "domcontentloaded" });
  await group(page, "Unit 10").locator(".component-page-card").first().waitFor();
  assert.equal(await group(page, "Unit 10").locator(".component-page-card").count(), 2);
  assert.deepEqual((await assertUnitLayout(page, "ultimate-b2-grammar-book", 4)).ids, grammarRows.ids);

  await page.goto(`${origin}/#/books/ultimate-b2/components/ultimate-b2-students-book/pages`, { waitUntil: "domcontentloaded" });
  const unit1Rows = await assertUnitLayout(page, "ultimate-b2-students-book", 1, [["5", "6-7", "8-9", "10-11"], ["12", "13", "14-15", "16", "17", "18"]], [7, 7]);
  const unit2Rows = await assertUnitLayout(page, "ultimate-b2-students-book", 2, [["19", "20-21", "22-23", "24-25", "26"], ["27", "28-29", "30", "31", "32", "33", "34"]], [8, 8]);
  const studentImageHeight = await pageRow(page, "Unit 1", "top").locator(".component-page-image").first().evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(Math.abs(studentImageHeight - 180) <= 1);
  assert.ok(studentImageHeight > workbookImageHeight && studentImageHeight > grammarImageHeight);
  for (let number = 3; number <= 10; number += 1) await assertUnitLayout(page, "ultimate-b2-students-book", number);
  await capture(page, "students-book-unit-1", group(page, "Unit 1"));
  await capture(page, "students-book-unit-2", group(page, "Unit 2"));
  await capture(page, "students-book-page-library");
  const canonicalUnit10Ids = state["ultimate-b2-students-book"].pages.filter((item) => item.unitNumber === 10).map((item) => item.id);
  await addFiles(page, "Unit 10", [{ name: "Students managed Unit 10.png", mimeType: "image/png", buffer: imageA }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await group(page, "Unit 10").getByText("Students managed Unit 10", { exact: true }).waitFor();
  const currentUnit10 = state["ultimate-b2-students-book"].pages.filter((item) => item.unitNumber === 10);
  assert.deepEqual(currentUnit10.filter((item) => item.origin === "canonical").map((item) => item.id), canonicalUnit10Ids);
  assert.equal(currentUnit10.filter((item) => item.origin === "managed").length, 1);
  await assertUnitLayout(page, "ultimate-b2-students-book", 10);

  const baseline = canonicalStudentsBookPages[0];
  const studentCard = page.locator(`.component-page-card[data-page-id="${baseline.id}"]`);
  assert.equal(await studentCard.getAttribute("data-source"), "repository-baseline");
  await studentCard.getByTitle("Edit metadata").click();
  await page.getByLabel("Label").fill("Student opening page");
  await page.getByLabel("Printed page or spread").fill("5 revised");
  await page.getByRole("button", { name: "Save metadata" }).click();
  await studentCard.locator(".component-page-card-copy strong", { hasText: "Student opening page" }).waitFor();
  assert.equal(await studentCard.getAttribute("data-source"), "metadata-override");
  await studentCard.getByTitle("Move later in this Unit").click();
  await page.waitForFunction((id) => document.querySelector('[data-page-unit="ultimate-b2-students-book-unit-1"] [data-page-row="top"] .component-page-card')?.dataset.pageId !== id, baseline.id);
  await studentCard.getByTitle("Move earlier in this Unit").click();
  await page.waitForFunction((id) => document.querySelector('[data-page-unit="ultimate-b2-students-book-unit-1"] [data-page-row="top"] .component-page-card')?.dataset.pageId === id, baseline.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await studentCard.locator(".component-page-card-copy strong", { hasText: "Student opening page" }).waitFor();
  const studentReplace = page.waitForEvent("filechooser");
  await studentCard.getByTitle("Replace page image").click();
  await (await studentReplace).setFiles({ name: "student-replacement.png", mimeType: "image/png", buffer: imageA });
  await page.locator(`.component-page-card[data-page-id="${baseline.id}"][data-source="override"]`).waitFor();
  await studentCard.getByTitle("Restore canonical image").click();
  await page.locator(`.component-page-card[data-page-id="${baseline.id}"][data-source="metadata-override"]`).waitFor();
  await studentCard.locator(".component-page-card-copy strong", { hasText: "Student opening page" }).waitFor();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.frameLocator(".unified-builder-review-dialog iframe").getByRole("heading", { name: "Canonical Viewer fixture" }).waitFor();
  await page.getByRole("button", { name: "Close Review" }).click();
  const authorizationCountBeforeFailures = previewAuthorizationRequests;
  const revisionBeforeFailures = state["ultimate-b2-students-book"].revision;
  const errorCountBeforeFailures = errors.length;
  for (const failure of [
    { code: "revision_conflict", status: 409, message: /page library revision changed/i, conflict: true },
    { code: "hotspot_revision_conflict", status: 409, message: /hotspot revision changed/i, conflict: true },
    { code: "unsupported_page_reference", status: 409, message: /reference that cannot be removed safely/i, conflict: false },
    { code: "page_lifecycle_schema_not_ready", status: 503, message: /temporarily unavailable while the lifecycle service is being prepared/i, conflict: false },
  ]) {
    nextMutationFailure = failure;
    await studentCard.getByTitle("Delete page").click();
    await page.locator(".builder-modal").getByRole("button", { name: "Delete page" }).click();
    const alert = page.getByRole("alert");
    await alert.waitFor();
    assert.match(await alert.innerText(), failure.message);
    assert.equal(await alert.getByRole("button", { name: "Reload latest" }).count(), failure.conflict ? 1 : 0);
    assert.equal(/library changed elsewhere/i.test(await alert.innerText()), failure.conflict);
    assert.equal(await page.locator(`.component-page-card[data-page-id="${baseline.id}"]`).count(), 1);
    assert.equal(state["ultimate-b2-students-book"].revision, revisionBeforeFailures);
    assert.equal(previewAuthorizationRequests, authorizationCountBeforeFailures);
  }
  const expectedFailureDiagnostics = errors.splice(errorCountBeforeFailures);
  assert.equal(expectedFailureDiagnostics.length, 4);
  assert.equal(expectedFailureDiagnostics.every((message) => /^Failed to load resource: the server responded with a status of (?:409|503) /.test(message)), true);

  await page.locator(`.component-page-card[data-page-id="${baseline.id}"]`).getByTitle("Delete page").click();
  const deleteModal = page.locator(".builder-modal");
  await deleteModal.getByText("Activities and their assets will be preserved.", { exact: false }).waitFor();
  await deleteModal.getByText("Restoring the page later will not recreate its hotspots.", { exact: true }).waitFor();
  await deleteModal.getByRole("button", { name: "Delete page" }).click();
  await page.locator(`.component-page-card[data-page-id="${baseline.id}"]`).waitFor({ state: "detached" });
  assert.equal(previewAuthorizationRequests, authorizationCountBeforeFailures);
  const reviewRefresh = page.waitForResponse((response) => response.url().includes("/builder/api/preview-authorization") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await reviewRefresh;
  await page.getByRole("button", { name: "Close Review" }).click();
  assert.equal(previewAuthorizationRequests, authorizationCountBeforeFailures + 1);
  const deletedPages = page.locator(".component-deleted-pages");
  await deletedPages.locator("summary").click();
  await deletedPages.getByText(baseline.id, { exact: true }).waitFor();
  assert.match(await deletedPages.innerText(), /2 hotspots removed/);
  assert.match(await deletedPages.innerText(), /3 activities preserved/);
  await deletedPages.getByRole("button", { name: "Restore page" }).click();
  await page.locator(`.component-page-card[data-page-id="${baseline.id}"][data-source="metadata-override"]`).waitFor();
  await studentCard.locator(".component-page-card-copy strong", { hasText: "Student opening page" }).waitFor();
  assert.equal(state["ultimate-b2-students-book"].hotspotRevision, 1);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.deepEqual((await assertUnitLayout(page, "ultimate-b2-students-book", 1)).ids, unit1Rows.ids);
  assert.deepEqual((await assertUnitLayout(page, "ultimate-b2-students-book", 2)).ids, unit2Rows.ids);

  await page.setViewportSize({ width: 760, height: 900 });
  const narrowUnit2 = await assertUnitLayout(page, "ultimate-b2-students-book", 2, unit2Rows.labels, unit2Rows.weights, false);
  assert.deepEqual(narrowUnit2.ids, unit2Rows.ids);
  assert.ok(await pageRow(page, "Unit 2", "bottom").evaluate((element) => element.scrollWidth > element.clientWidth));
  await capture(page, "students-book-narrow-unit-2", group(page, "Unit 2"));
  await page.setViewportSize({ width: 1440, height: 900 });

  assert.equal(state["ultimate-b2-workbook"].pages.some((item) => item.id === baseline.id), false);
  assert.equal(state["ultimate-b2-grammar-book"].pages.some((item) => item.id === baseline.id), false);
  assert.deepEqual(errors, []);
  process.stdout.write("Deterministic two-row Workbook, Grammar, and Students Pages browser acceptance passed.\n");
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
