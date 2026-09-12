import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { chromium } from "@playwright/test";
import { createBuilderTeacherUiAssetsHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import {
  createEmptyHostedTeacherUiDocument,
  normalizeHostedTeacherUiDocument,
  projectHostedTeacherUiPreview,
} from "../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import {
  invalidHostedTeacherUiPngFixture,
} from "../../tests/fixtures/hosted-teacher-ui-assets.js";
import { studentsBookCurrentPageEnvelope } from "./students-book-current-browser-fixtures.mjs";
import { localPlaywrightLaunchOptions } from "../android-teacher/playwright-launch-options.mjs";

const builderRoot = path.resolve("dist-netlify/ultimate-b2-builder");
const viewerRoot = path.resolve("dist-netlify/ultimate-b2-interactive");
const actorId = "10000000-0000-4000-8000-000000000007";
const identity = Object.freeze({ bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", resource: "ui-controller", schemaVersion: "1.0" });
const contentPath = "/builder/api/content/books/ultimate-b2/components/ultimate-b2-students-book/ui-controller";
const previewPath = "/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/ui-controller";
const hotspotPreviewPath = "/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/hotspots";
const pageCatalogPreviewPath = "/preview/pages/books/ultimate-b2/components/ultimate-b2-students-book";
const hotspots = JSON.parse(await readFile("src/data/ultimate-b2/authoring/studentsBookHotspots.json", "utf8"));
const hostedTeacherUiPngFixture = Object.freeze({ name: "valid-ui.png", mimeType: "image/png", buffer: await readFile("src/assets/books/ultimate-b2/legacy-classroom-ui/controls/teacher-tools/annotation-container-low.png") });
const mime = { ".css": "text/css", ".gaf": "application/x-gaf", ".html": "text/html", ".jpg": "image/jpeg", ".js": "text/javascript", ".json": "application/json", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };

let origin = "";
let saved = null;
let forceConflict = false;
const sessions = new Map();
const mutations = new Map();
const requestedUiAssets = [];
const requestedPreviewPaths = [];

function json(response, statusCode, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, { "Cache-Control": "no-store", "Content-Length": body.length, "Content-Type": "application/json", ...headers });
  response.end(body);
}

async function waitForViewerBackground(page, expectedHash) {
  const deadline = Date.now() + 15_000;
  let lastBackground = "";
  while (Date.now() < deadline) {
    const backgroundImage = await page
      .frameLocator(".unified-builder-review-dialog iframe")
      .locator(".teacher-fixed-stage-host")
      .evaluate((node) => node.style.backgroundImage)
      .catch(() => "");
    lastBackground = backgroundImage || lastBackground;
    if (backgroundImage.includes(expectedHash)) return;
    await page.waitForTimeout(50);
  }
  const frameSrc = await page.locator(".unified-builder-review-dialog iframe").getAttribute("src").catch(() => "");
  const frameText = await page.frameLocator(".unified-builder-review-dialog iframe").locator("body").innerText().catch(() => "");
  throw new Error(`saved background did not reach Viewer (src=${frameSrc}, background=${lastBackground}, assets=${requestedUiAssets.join(",")}, preview=${requestedPreviewPaths.join(",")}, text=${frameText.slice(0, 500)})`);
}

async function bytes(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function staticResponse(root, pathname, response) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  let file = path.resolve(root, relative);
  let details = file.startsWith(`${root}${path.sep}`) ? await stat(file).catch(() => null) : null;
  if (!details?.isFile()) { file = path.join(root, "index.html"); details = await stat(file); }
  response.writeHead(200, { "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store", "Content-Length": details.size, "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" });
  createReadStream(file).pipe(response);
}

class BrowserMemoryStorage {
  objects = new Map();
  uploadTokens = new Map();
  key(profile, objectKey) { return `${profile}:${objectKey}`; }
  async signedPutUrl(input) { const token = randomUUID(); this.uploadTokens.set(token, input); return { url: `${origin}/object-upload/${token}`, headers: { "Content-Type": input.contentType }, expiresIn: input.ttlSeconds }; }
  async head({ profile, objectKey }) { const item = this.objects.get(this.key(profile, objectKey)); if (!item) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }); return { byteSize: item.body.length, contentType: item.contentType, checksumSha256: item.checksumSha256 || null }; }
  async download({ profile, objectKey }) { return Buffer.from(this.objects.get(this.key(profile, objectKey)).body); }
  async upload(input) { const key = this.key(input.profile, input.objectKey); if (!this.objects.has(key)) this.objects.set(key, { body: Buffer.from(input.body), contentType: input.contentType, checksumSha256: input.checksumSha256 }); return { ...(await this.head(input)), reused: this.objects.has(key) }; }
  async delete({ profile, objectKey }) { this.objects.delete(this.key(profile, objectKey)); }
  publicUrl(objectKey) { return `${origin}/public-object/${encodeURIComponent(objectKey)}`; }
}
const storage = new BrowserMemoryStorage();

const resource = Object.freeze({
  ...identity,
  baseline: createEmptyHostedTeacherUiDocument,
  validate: normalizeHostedTeacherUiDocument,
});

const uiHandler = createBuilderTeacherUiAssetsHandler({
  getDatabase: () => ({}),
  authorize: async () => ({ builderUser: { id: actorId, role: "developer", status: "active" } }),
  resolveResource: async () => resource,
  loadDocument: async () => saved,
  saveDocument: async (_sql, input) => {
    if (forceConflict) {
      forceConflict = false;
      saved = { revision: (saved?.revision || 0) + 1, document: saved?.document || createEmptyHostedTeacherUiDocument() };
      return { outcome: "revision_conflict", currentRevision: saved.revision };
    }
    if ((saved?.revision || 0) !== input.expectedRevision) return { outcome: "revision_conflict", currentRevision: saved?.revision || 0 };
    const prior = mutations.get(input.clientMutationId);
    if (prior) return prior;
    saved = { revision: input.expectedRevision + 1, document: normalizeHostedTeacherUiDocument(input.document) };
    const result = { outcome: "saved", revision: saved.revision, currentRevision: saved.revision, document: saved.document };
    mutations.set(input.clientMutationId, result);
    return result;
  },
  storage: () => storage,
  prepare: async (_sql, input) => {
    if ((saved?.revision || 0) !== input.expectedRevision) return { outcome: "revision_conflict", currentRevision: saved?.revision || 0 };
    const session = { ...input, state: "prepared" };
    sessions.set(input.uploadId, session);
    return { outcome: "prepared", uploadId: input.uploadId, currentRevision: input.expectedRevision, state: session.state, fileDescriptors: input.fileDescriptors };
  },
  claim: async (_sql, input) => {
    const session = sessions.get(input.uploadId);
    if (!session || session.builderUserId !== input.builderUserId) return { outcome: "session_not_found" };
    if ((saved?.revision || 0) !== input.expectedRevision) return { outcome: "revision_conflict", currentRevision: saved?.revision || 0 };
    session.state = "finalizing";
    return { outcome: "claimed", state: session.state, currentRevision: input.expectedRevision, fileDescriptors: session.fileDescriptors };
  },
  loadUploadScope: async (_sql, input) => {
    const session = sessions.get(input.uploadId);
    return session?.builderUserId === input.builderUserId ? { bookSlug: session.bookSlug, componentSlug: session.componentSlug } : null;
  },
  complete: async (_sql, input) => { const session = sessions.get(input.uploadId); session.state = "validated"; session.validatedAssets = input.validatedAssets; },
  fail: async (_sql, input) => { const session = sessions.get(input.uploadId); if (session) session.state = "failed"; },
  loadCandidates: async (_sql, input) => input.uploadIds.map((id) => sessions.get(id)).filter((session) => session?.builderUserId === input.builderUserId && ["validated", "saved"].includes(session.state)).map((session) => ({ id: session.uploadId, validatedAssets: session.validatedAssets })),
  markSaved: async (_sql, input) => { for (const id of input.uploadIds) { const session = sessions.get(id); if (session) session.state = "saved"; } },
  logger: { error() {} },
});

function builderEnvelope() {
  return { ...identity, revision: saved?.revision || 0, source: saved ? "database" : "repository", document: saved?.document || createEmptyHostedTeacherUiDocument() };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/builder/api/auth" && url.searchParams.get("action") === "me") return json(response, 200, { authenticated: true, builderUser: { id: actorId, full_name: "Task 7 Browser", role: "developer", status: "active" } });
  if (url.pathname === "/builder/api/preview-authorization" && request.method === "POST") return json(response, 200, { token: `v1.eA.${"a".repeat(43)}`, expiresAt: "2099-01-01T00:00:00.000Z" });
  if (url.pathname === contentPath && request.method === "GET") return json(response, 200, builderEnvelope());
  const savedAsset = url.pathname.match(/^\/preview\/ui-assets-v2\/([a-f0-9]{64})\.(png|jpg|webp)$/);
  if (savedAsset && request.method === "GET") {
    const item = [...storage.objects.entries()].find(([key]) => key.startsWith("public:") && key.endsWith(`${savedAsset[1]}.${savedAsset[2]}`))?.[1];
    if (!item) return json(response, 404, { error: "asset_not_found" });
    response.writeHead(200, { "Cache-Control": "public, max-age=31536000, immutable", "Content-Length": item.body.length, "Content-Type": item.contentType }); response.end(item.body); return;
  }
  if (url.pathname === "/test/force-conflict" && request.method === "POST") { forceConflict = true; return json(response, 200, { ok: true }); }
  if (url.pathname.startsWith("/object-upload/") && request.method === "PUT") {
    const token = url.pathname.split("/").at(-1);
    const authorization = storage.uploadTokens.get(token);
    if (!authorization) return json(response, 403, { error: "invalid_upload_token" });
    const body = await bytes(request);
    storage.objects.set(storage.key("private", authorization.objectKey), { body, contentType: request.headers["content-type"] || "application/octet-stream" });
    storage.uploadTokens.delete(token);
    response.writeHead(200).end();
    return;
  }
  if (url.pathname.startsWith("/builder/api/ui-assets/")) {
    const body = await bytes(request);
    const result = await uiHandler({ httpMethod: request.method, path: url.pathname, headers: request.headers, body: body.toString("utf8") });
    response.writeHead(result.statusCode, result.headers || {}); response.end(result.body || "");
    return;
  }
  return staticResponse(builderRoot, url.pathname, response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;

const fixture = (name = hostedTeacherUiPngFixture.name, source = hostedTeacherUiPngFixture) => ({ name, mimeType: source.mimeType, buffer: source.buffer });
const overriddenBindings = ["background.main", "toolbar.mouse.normal", "navigation.home"];
let browser;
try {
  browser = await chromium.launch(localPlaywrightLaunchOptions());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://hhplms-viewer.netlify.app/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/preview/")) requestedPreviewPaths.push(url.pathname);
    if (url.pathname === "/preview/authorization/exchange" && route.request().method() === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ token: `v1.eA.${"b".repeat(43)}`, expiresAt: "2099-01-01T00:00:00.000Z" }) });
    }
    if (url.pathname === hotspotPreviewPath) return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ ...identity, resource: "hotspots", revision: 1, source: "database", document: hotspots }) });
    if (url.pathname === pageCatalogPreviewPath) return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(studentsBookCurrentPageEnvelope(1)) });
    if (url.pathname === previewPath) {
      if (!saved) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ ...identity, revision: saved.revision, source: "database", document: projectHostedTeacherUiPreview(saved.document) }) });
    }
    const assetMatch = url.pathname.match(/^\/preview\/ui-assets(?:-v2)?\/([a-f0-9]{64})\.(png|jpg|webp|mp3|wav|gaf)$/);
    if (assetMatch) {
      requestedUiAssets.push(url.pathname);
      const item = [...storage.objects.entries()].find(([key]) => key.startsWith("public:") && key.endsWith(`${assetMatch[1]}.${assetMatch[2]}`))?.[1];
      return item ? route.fulfill({ status: 200, contentType: item.contentType, headers: { "Cache-Control": "public, max-age=31536000, immutable" }, body: item.body }) : route.fulfill({ status: 404, body: "" });
    }
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    let file = path.resolve(viewerRoot, relative);
    let details = file.startsWith(`${viewerRoot}${path.sep}`) ? await stat(file).catch(() => null) : null;
    if (!details?.isFile()) file = path.join(viewerRoot, "index.html");
    return route.fulfill({ status: 200, contentType: mime[path.extname(file).toLowerCase()] || "application/octet-stream", body: await readFile(file) });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${origin}/#/books/ultimate-b2`, { waitUntil: "domcontentloaded" });
  const packageTools = page.locator(".hosted-builder-package-tools");
  await packageTools.getByRole("heading", { name: "Package tools" }).waitFor();
  assert.deepEqual(await packageTools.locator("h3").allTextContents(), ["Page UI Controller", "Sound Controller"]);
  assert.ok((await packageTools.boundingBox()).y < (await page.locator(".hosted-builder-component-grid").boundingBox()).y);
  assert.equal(await page.locator('[data-unified-review-launcher="true"]').count(), 1);
  assert.equal(await page.locator(".unified-builder-review-dialog iframe").count(), 1);
  await page.goto(`${origin}/#/books/ultimate-b2/components/ultimate-b2-students-book/ui`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.location.hash === "#/books/ultimate-b2/ui");
  const editor = page.locator(".b2-hosted-ui-editor");
  await editor.getByText("Revision 0", { exact: true }).waitFor();
  await editor.getByText("Bound Teacher interface graphics").waitFor();
  assert.equal(await editor.getByRole("button", { name: "Sounds", exact: true }).count(), 0);
  assert.equal(await page.locator(".hosted-viewer-preview iframe").count(), 1);
  await editor.getByRole("button", { name: "Shell / Background", exact: true }).click();
  assert.deepEqual(await editor.locator('[data-binding-id^="background."]').evaluateAll((slots) => slots.map((slot) => slot.dataset.bindingId)), ["background.main", "background.students-book-parts", "background.workbook-parts", "background.grammar-book-parts"]);
  await editor.getByLabel("Page overview captions font family", { exact: true }).selectOption("Georgia");
  const canonicalThumbnail = editor.locator('[data-binding-id="background.main"] img');
  await canonicalThumbnail.waitFor();
  await canonicalThumbnail.evaluate((image) => image.decode());
  assert.ok(await canonicalThumbnail.evaluate((image) => image.naturalWidth > 0), "canonical effective thumbnail is broken");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const frame = () => page.frameLocator(".unified-builder-review-dialog iframe");
  await page.waitForFunction(() => {
    const src = document.querySelector(".unified-builder-review-dialog iframe")?.getAttribute("src");
    return src && src !== "about:blank";
  });
  const initialFrameUrl = new URL(await page.locator(".unified-builder-review-dialog iframe").getAttribute("src"));
  assert.equal(initialFrameUrl.searchParams.get("view"), "library");
  await frame().locator(".teacher-fixed-stage-host").waitFor();
  await page.getByRole("button", { name: "Close Review" }).click();

  const expectedHash = createHash("sha256").update(hostedTeacherUiPngFixture.buffer).digest("hex");
  for (const [section, bindingId] of [["Shell / Background", "background.main"], ["Teacher Toolbar", "toolbar.mouse.normal"], ["Navigation / Window Controls", "navigation.home"], ["Navigation / Window Controls", "navigation.videoWorksheet"]]) {
    await editor.getByRole("button", { name: section, exact: true }).click();
    const slot = editor.locator(`[data-binding-id="${bindingId}"]`);
    await slot.locator('input[type="file"]').setInputFiles(fixture(`${bindingId.replaceAll(".", "-")}.png`));
    await slot.getByText("Unsaved replacement", { exact: true }).waitFor({ timeout: 15_000 }).catch(async () => { throw new Error(`UI candidate did not validate: ${await slot.textContent()}`); });
  }
  assert.equal(saved, null, "validated candidates must remain unsaved");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText("Unsaved changes are not included in Review. Save them first.", { exact: true }).waitFor();
  assert.equal((await frame().locator(".teacher-fixed-stage-host").evaluate((node) => node.style.backgroundImage)).includes(expectedHash), false, "unsaved background reached Viewer");
  await page.getByRole("button", { name: "Close Review" }).click();
  await editor.getByRole("button", { name: "Save UI draft", exact: true }).click();
  await editor.getByText("Revision 1", { exact: true }).waitFor();
  await editor.getByRole("button", { name: "Shell / Background", exact: true }).click();
  await editor.locator('[data-binding-id="background.main"] img').evaluate((image) => image.decode());
  assert.ok(await editor.locator('[data-binding-id="background.main"] img').evaluate((image) => image.naturalWidth > 0), "saved effective thumbnail is broken");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await frame().locator(".teacher-fixed-stage-host").waitFor();
  await waitForViewerBackground(page, expectedHash);
  assert.ok(requestedUiAssets.some((url) => url.includes(expectedHash)), "Viewer did not fetch the immutable saved UI asset");
  await page.getByRole("button", { name: "Close Review" }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".b2-hosted-ui-editor").getByText("Revision 1", { exact: true }).waitFor();
  await page.locator(".b2-hosted-ui-editor").getByRole("button", { name: "Supporting UI", exact: true }).click();
  assert.equal(saved.document.overviewCaptionFontFamily, "Georgia");
  assert.equal(Object.hasOwn(saved.document, "independentPartsBackgrounds"), false, "unrelated UI edits must not opt into independent parts");
  assert.equal(Object.hasOwn(saved.document.assets, "background.workbook-parts"), false);
  assert.equal(Object.hasOwn(saved.document.assets, "background.grammar-book-parts"), false);
  await editor.getByRole("button", { name: "Shell / Background", exact: true }).click();
  assert.equal(await editor.getByLabel("Page overview captions font family", { exact: true }).inputValue(), "Georgia");
  await editor.getByRole("button", { name: "Supporting UI", exact: true }).click();
  const invalidSlot = page.locator('[data-binding-id="control.activity-hotspot"]');
  await invalidSlot.locator('input[type="file"]').setInputFiles(fixture(invalidHostedTeacherUiPngFixture.name, invalidHostedTeacherUiPngFixture));
  const invalidMessage = invalidSlot.locator("em");
  await invalidMessage.waitFor();
  assert.ok((await invalidMessage.textContent()).trim(), "invalid bytes did not produce a visible validation error");
  assert.equal(saved.revision, 1, "invalid bytes changed the saved document");

  await page.locator(".b2-hosted-ui-editor").getByRole("button", { name: "Shell / Background", exact: true }).click();
  const conflictSlot = page.locator('[data-binding-id="background.students-book-parts"]');
  await conflictSlot.locator('input[type="file"]').setInputFiles(fixture("conflict-background.png"));
  await conflictSlot.getByText("Unsaved replacement", { exact: true }).waitFor();
  await page.request.post(`${origin}/test/force-conflict`);
  await page.getByRole("button", { name: "Save UI draft", exact: true }).click();
  await page.getByText("Conflict", { exact: true }).waitFor();
  assert.equal(await conflictSlot.getByText("Unsaved replacement", { exact: true }).count(), 1, "conflict discarded local candidate");
  await page.getByRole("button", { name: "Reload latest and keep local choices", exact: true }).click();
  await page.getByText("Revision 2", { exact: true }).waitFor();
  await conflictSlot.getByRole("button", { name: "Revert to canonical", exact: true }).click();
  await page.locator('[data-binding-id="background.main"]').getByRole("button", { name: "Revert to canonical", exact: true }).click();
  await page.getByRole("button", { name: "Save UI draft", exact: true }).click();
  await page.getByText("Revision 3", { exact: true }).waitFor();
  assert.equal(Boolean(saved.document.assets["background.main"]), false, "canonical revert did not persist");
  assert.equal(Boolean(saved.document.assets["toolbar.mouse.normal"]), true, "unrelated toolbar override was lost");
  assert.equal(Boolean(saved.document.assets["navigation.home"]), true, "unrelated navigation override was lost");
  assert.equal(Boolean(saved.document.assets["navigation.videoWorksheet"]), true, "independent Video Worksheet override was lost");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await frame().locator(".teacher-fixed-stage-host").waitFor();
  assert.equal((await frame().locator(".teacher-fixed-stage-host").evaluate((node) => node.style.backgroundImage)).includes(expectedHash), false, "reverted background remained in Viewer");
  await page.getByRole("button", { name: "Close Review" }).click();
  await page.goto(`${origin}/#/books/ultimate-b2/sounds`, { waitUntil: "domcontentloaded" });
  const soundController = page.locator(".b2-sound-controller");
  await soundController.getByRole("heading", { name: "Sound Controller" }).waitFor();
  assert.deepEqual(await soundController.locator("article").evaluateAll((items) => items.map((item) => item.dataset.bindingId)), ["sound.button", "sound.correct", "sound.incorrect", "sound.page-turn"]);
  assert.equal(await soundController.locator('input[type="file"],button,audio').count(), 0);
  assert.equal(await soundController.getByText("Sound authoring will be added in a later milestone.", { exact: true }).count(), 1);
  assert.equal(await page.locator('[data-unified-review-launcher="true"]').count(), 1);
  assert.equal(await page.locator(".unified-builder-review-dialog iframe").count(), 1);
  process.stdout.write(`Task 7 hosted UI Controller browser acceptance passed at revision ${saved.revision} with ${overriddenBindings.length} runtime categories exercised.\n`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
