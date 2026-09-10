import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";
import sharp from "sharp";
import { createServer } from "../../tests/_vite-test-server.mjs";

import { createBookBuilderStudioFixture } from "../../tests/helpers/book-builder-studio-fixture.mjs";
import { bookBuilderReviewStudioPlugin } from "./review-studio-api.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const screenshotRoot = path.join(repositoryRoot, "test-results", "teacher-project-authoring");
const authoringViewports = [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }];

function wavFixture() {
  const wav = Buffer.alloc(46); wav.write("RIFF", 0); wav.writeUInt32LE(38, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(8_000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36); wav.writeUInt32LE(2, 40); wav[44] = 128; wav[45] = 128; return wav;
}

async function startStudio(workspace) {
  const server = await createServer({ root: repositoryRoot, configFile: path.join(repositoryRoot, "vite.config.js"), appType: "mpa", logLevel: "error", plugins: [bookBuilderReviewStudioPlugin({ workspace, writeEnabled: true })], server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await server.listen(); return { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` };
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  assert.equal(dimensions.width <= dimensions.viewport + 1, true, JSON.stringify(dimensions));
}

function intersects(left, right) {
  return left.x < right.x + right.width - 1 && left.x + left.width > right.x + 1 && left.y < right.y + right.height - 1 && left.y + left.height > right.y + 1;
}

async function assertNoOverlap(locator, label) {
  const boxes = (await locator.evaluateAll((nodes) => nodes.filter((node) => { const style = getComputedStyle(node); return style.display !== "none" && style.visibility !== "hidden"; }).map((node) => { const box = node.getBoundingClientRect(); return { text: node.textContent?.trim() || node.getAttribute("aria-label") || node.tagName, x: box.x, y: box.y, width: box.width, height: box.height }; }))).filter((box) => box.width && box.height);
  for (let left = 0; left < boxes.length; left += 1) for (let right = left + 1; right < boxes.length; right += 1) assert.equal(intersects(boxes[left], boxes[right]), false, `${label}: ${JSON.stringify([boxes[left], boxes[right]])}`);
}

async function relativeBox(locator, root) {
  const [box, rootBox] = await Promise.all([locator.boundingBox(), root.boundingBox()]);
  assert.ok(box && rootBox, "Expected visible elements for geometry comparison");
  return { x: box.x - rootBox.x, y: box.y - rootBox.y, width: box.width, height: box.height };
}

async function chooseExistingImage(page, field, filename) {
  await field.getByRole("button", { name: /^(?:Choose from library|Change)$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Page Image Library" });
  await dialog.getByRole("option", { name: new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  await dialog.waitFor({ state: "detached" });
  await field.getByText(filename, { exact: true }).waitFor();
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(screenshotRoot, `${name}.png`), fullPage: false });
}

async function run() {
  const fixture = await createBookBuilderStudioFixture();
  const studio = await startStudio(fixture.workspace);
  let browser;
  await fs.rm(screenshotRoot, { recursive: true, force: true }); await fs.mkdir(screenshotRoot, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const networkBodies = [];
    page.on("response", async (response) => { if (response.url().includes("/__hhplms/book-builder/") && String(response.headers()["content-type"] || "").includes("application/json")) try { networkBodies.push(await response.text()); } catch { /* navigation may cancel */ } });
    await page.goto(`${studio.origin}/builder.html`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByRole("heading", { name: "Teacher APK Projects", exact: true }).waitFor();
    await page.getByLabel("Project name").fill("Ultimate B3"); await page.getByLabel("Project slug / ID").fill("ultimate-b3"); await page.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("heading", { name: "Overview" }).waitFor();
    assert.equal(await page.locator(".teacher-project-navigation").count(), 0); assert.equal(await page.getByRole("tablist", { name: "Teacher Project sections" }).getByRole("tab").count(), 9); assert.equal(await page.locator(".teacher-project-preview-panel").count(), 0);
    await page.locator("#teacher-tab-overview").focus(); await page.keyboard.press("ArrowRight"); assert.equal(await page.locator("#teacher-tab-pages").getAttribute("aria-selected"), "true"); await page.keyboard.press("ArrowLeft"); assert.equal(await page.locator("#teacher-tab-overview").getAttribute("aria-selected"), "true");
    await capture(page, "overview-preview-closed-1440x900");

    await page.getByRole("button", { name: "Import Assets" }).first().click(); await page.getByRole("heading", { name: "Import assets" }).waitFor();
    const background = await sharp({ create: { width: 32, height: 18, channels: 4, background: "#184c68" } }).png().toBuffer();
    const alternate = await sharp({ create: { width: 32, height: 18, channels: 4, background: "#663355" } }).webp().toBuffer();
    const normal = await sharp({ create: { width: 20, height: 8, channels: 4, background: "#275d84" } }).png().toBuffer();
    const active = await sharp({ create: { width: 20, height: 8, channels: 4, background: "#f1bf24" } }).png().toBuffer();
    await page.locator(".teacher-import-pickers input[type=file]").nth(1).setInputFiles([
      { name: "background.png", mimeType: "image/png", buffer: background }, { name: "menu-bg.webp", mimeType: "image/webp", buffer: alternate },
      { name: "unit-01-normal.png", mimeType: "image/png", buffer: normal }, { name: "unit-01-active.png", mimeType: "image/png", buffer: active }, { name: "button.wav", mimeType: "audio/wav", buffer: wavFixture() },
    ]);
    await page.getByText("need review").waitFor(); await page.getByLabel("Candidate for Shell · Background").selectOption({ label: "background.png" });
    await page.getByRole("button", { name: "Apply mappings" }).click(); await page.getByText(/unique assets imported/).waitFor(); await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByText("Unsaved", { exact: true }).waitFor();
    await page.locator("#teacher-tab-units").click(); await page.getByText("unit-01-normal.png").waitFor();
    await page.locator("#teacher-tab-assets").click(); await page.locator(".teacher-sound-bulk select").first().selectOption({ label: "button.wav" }); await page.getByRole("button", { name: "Apply sound" }).click();
    await page.locator(".teacher-project-editor-header").getByRole("button", { name: "Save", exact: true }).click(); await page.getByText(/Saved revision/).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: "Overview" }).waitFor(); await page.locator("#teacher-tab-units").click();
    assert.notEqual(await page.locator(".teacher-project-control-row").filter({ hasText: "Unit 1" }).first().locator("select").inputValue(), "");
    await page.locator("#teacher-tab-pages").click(); await page.getByRole("heading", { name: "Units & Pages" }).waitFor();
    assert.equal(await page.locator(".teacher-pages-units").count(), 0); assert.equal(await page.getByRole("tablist", { name: "Students Book Units" }).getByRole("tab").count(), 10);
    await page.locator("#teacher-unit-tab-unit-1").focus(); await page.keyboard.press("ArrowRight"); await page.getByText("Unit 2 has no pages yet").waitFor(); await page.keyboard.press("ArrowLeft"); await page.getByText("Unit 1 has no pages yet").waitFor();
    await capture(page, "pages-empty-1440x900");

    const page5 = await sharp({ create: { width: 70, height: 100, channels: 4, background: "#1d7195" } }).png().toBuffer();
    const spread67 = await sharp({ create: { width: 140, height: 80, channels: 4, background: "#77318c" } }).png().toBuffer();
    const page17 = await sharp({ create: { width: 64, height: 92, channels: 4, background: "#147b65" } }).png().toBuffer();
    const page18 = await sharp({ create: { width: 70, height: 96, channels: 4, background: "#ad5a26" } }).png().toBuffer();
    const fieldUpload = await sharp({ create: { width: 80, height: 100, channels: 4, background: "#475f9c" } }).png().toBuffer();
    await page.getByLabel("Import page images").setInputFiles([
      { name: "page-18.png", mimeType: "image/png", buffer: page18 }, { name: "reading-6-7.png", mimeType: "image/png", buffer: spread67 },
      { name: "page-5.png", mimeType: "image/png", buffer: page5 }, { name: "page-17.png", mimeType: "image/png", buffer: page17 },
    ]);
    await page.locator(".teacher-page-import-message").waitFor(); assert.match(await page.locator(".teacher-page-import-message").textContent(), /4 page images imported in natural filename order/);

    const libraryTrigger = page.getByRole("button", { name: "Page Image Library" });
    await libraryTrigger.click(); const library = page.getByRole("dialog", { name: "Page Image Library" }); await library.waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute("placeholder") === "Filter by filename"); await capture(page, "page-image-library-1440x900"); await page.keyboard.press("Escape"); await library.waitFor({ state: "detached" }); await page.waitForFunction((node) => document.activeElement === node, await libraryTrigger.elementHandle());

    const addEntry = page.getByRole("button", { name: "Add Page / Spread" });
    await addEntry.click(); await addEntry.click(); await addEntry.click();
    let entries = page.locator(".teacher-page-entry"); assert.equal(await entries.count(), 3); assert.equal(await entries.locator(".teacher-page-entry-editor").count(), 3);
    await entries.nth(0).getByLabel("Page label").fill("5");
    const firstField = entries.nth(0).locator(".teacher-page-image-field"); await firstField.getByLabel("Upload new page image").setInputFiles({ name: "field-upload.png", mimeType: "image/png", buffer: fieldUpload }); await firstField.getByText("field-upload.png", { exact: true }).waitFor(); await chooseExistingImage(page, firstField, "page-5.png");
    await entries.nth(1).getByLabel("Page label").fill("6-7"); await entries.nth(1).getByLabel(/Section title/).fill("Reading"); await entries.nth(1).getByLabel("Double page").check(); await entries.nth(1).getByLabel("One spread image").check(); await chooseExistingImage(page, entries.nth(1).locator(".teacher-page-image-field"), "reading-6-7.png");
    await entries.nth(2).getByLabel("Page label").fill("17-18"); await entries.nth(2).getByLabel(/Section title/).fill("Practice 1"); await entries.nth(2).getByLabel("Double page").check(); await entries.nth(2).getByLabel("Two page images").check();
    await chooseExistingImage(page, entries.nth(2).locator(".teacher-page-image-field").nth(0), "page-17.png"); await chooseExistingImage(page, entries.nth(2).locator(".teacher-page-image-field").nth(1), "page-18.png");
    const hiddenFileStyle = await page.getByLabel("Upload new left page").evaluate((node) => { const style = getComputedStyle(node); const box = node.getBoundingClientRect(); return { width: box.width, height: box.height, clip: style.clipPath }; }); assert.ok(hiddenFileStyle.width <= 1 && hiddenFileStyle.height <= 1 && hiddenFileStyle.clip.includes("50%"), JSON.stringify(hiddenFileStyle));

    await capture(page, "double-pair-expanded-1440x900"); await entries.nth(0).locator(".teacher-page-entry-toggle").click(); await entries.nth(2).locator(".teacher-page-entry-toggle").click(); await capture(page, "double-wide-expanded-1440x900"); await entries.nth(0).locator(".teacher-page-entry-toggle").click(); await entries.nth(2).locator(".teacher-page-entry-toggle").click();
    await entries.nth(2).locator(".teacher-page-entry-toggle").click(); assert.equal(await entries.nth(2).locator(".teacher-page-entry-editor").count(), 0); await expectText(entries.nth(2), ["Practice 1", "17-18", "Double · Two page images", "Complete"]); await entries.nth(2).locator(".teacher-page-entry-toggle").click();
    const practiceId = await entries.nth(2).getAttribute("data-entry-id"); await entries.nth(2).getByRole("button", { name: "Move entry 3 up" }).click(); await page.locator(`[data-entry-id="${practiceId}"]`).getByRole("button", { name: "Move entry 2 down" }).click();
    assert.deepEqual(await page.locator(".teacher-page-entry input[placeholder='e.g. 6-7']").evaluateAll((nodes) => nodes.map((node) => node.value)), ["5", "6-7", "17-18"]);
    const authoredIds = await page.locator(".teacher-page-entry").evaluateAll((nodes) => nodes.map((node) => node.dataset.entryId));

    for (const [id, heading] of [["overview", "Overview"], ["shell", "Shell & Animation"], ["chrome", "Window Controls"], ["units", "Units"], ["editions", "Book Editions"], ["toolbar", "Teacher Toolbar"], ["assets", "Sounds & Assets"], ["build", "Build & Run"], ["pages", "Units & Pages"]]) { await page.locator(`#teacher-tab-${id}`).click(); await page.getByRole("heading", { name: heading, exact: true }).waitFor(); }
    await expectText(page.locator(`[data-entry-id="${practiceId}"]`), ["Practice 1", "17-18"]); for (const toggle of await page.locator(".teacher-page-entry-toggle").all()) await toggle.click(); assert.equal(await page.locator(`[data-entry-id="${practiceId}"]`).getByLabel(/Section title/).inputValue(), "Practice 1");
    await page.getByRole("tab", { name: /^Unit 2 / }).click(); await page.getByText("Unit 2 has no pages yet").waitFor(); await page.getByRole("tab", { name: /^Unit 1 / }).click();

    for (const viewport of authoringViewports) {
      await page.setViewportSize(viewport); await assertNoOverflow(page);
      await assertNoOverlap(page.locator(".teacher-pages-workspace-actions > .studio-button"), `workspace actions ${viewport.width}x${viewport.height}`);
      await assertNoOverlap(page.locator(".teacher-project-editor-actions > .studio-button"), `project actions ${viewport.width}x${viewport.height}`);
      await assertNoOverlap(page.locator(".teacher-page-entry").first().locator(".teacher-page-entry-order > button"), `entry actions ${viewport.width}x${viewport.height}`);
      await assertNoOverlap(page.locator(".teacher-page-entry").first().locator(".teacher-page-metadata-fields input"), `metadata controls ${viewport.width}x${viewport.height}`);
      await assertNoOverlap(page.locator(".teacher-page-entry").first().locator(".teacher-page-image-actions > .studio-button"), `image actions ${viewport.width}x${viewport.height}`);
      const [workspaceBox, editorBox] = await Promise.all([page.locator(".teacher-project-workspace").boundingBox(), page.locator(".teacher-project-editor").boundingBox()]); assert.ok(workspaceBox.width >= editorBox.width - 2, JSON.stringify({ viewport, workspaceBox, editorBox }));
    }
    await page.setViewportSize({ width: 1920, height: 1080 }); await capture(page, "pages-authored-preview-closed-1920x1080");
    await page.setViewportSize({ width: 1280, height: 800 }); await capture(page, "pages-authored-preview-closed-1280x800");

    await page.locator(".teacher-page-entry-toggle").first().click();
    await page.locator(".teacher-project-editor-header").getByRole("button", { name: "Save", exact: true }).click(); await page.getByText(/Saved revision/).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: "Overview" }).waitFor(); await page.locator("#teacher-tab-pages").click();
    entries = page.locator(".teacher-page-entry"); assert.deepEqual(await entries.evaluateAll((nodes) => nodes.map((node) => node.dataset.entryId)), authoredIds); assert.equal(await entries.locator(".teacher-page-entry-editor").count(), 0); assert.deepEqual(await entries.locator(".teacher-page-entry-toggle small").evaluateAll((nodes) => nodes.map((node) => node.textContent)), ["pg 5 · Single page", "pg 6-7 · Double · One spread image", "pg 17-18 · Double · Two page images"]);

    await page.setViewportSize({ width: 1920, height: 1080 }); const previewToggle = page.getByRole("button", { name: "Preview", exact: true }); await previewToggle.click(); await page.locator(".teacher-project-preview-stage").waitFor();
    for (const id of ["16:10", "ultrawide", "16:9"]) { await page.getByRole("button", { name: id, exact: true }).click(); assert.equal(await page.locator(".teacher-project-preview-host").getAttribute("data-preview-viewport"), id); }
    const [splitWorkspace, splitPreview] = await Promise.all([page.locator(".teacher-project-workspace").boundingBox(), page.locator(".teacher-project-preview-panel").boundingBox()]); assert.ok(splitWorkspace.width >= 760 && splitPreview.width >= 560 && !intersects(splitWorkspace, splitPreview), JSON.stringify({ splitWorkspace, splitPreview })); await capture(page, "preview-open-1920x1080");
    await page.setViewportSize({ width: 1280, height: 800 }); await assertNoOverflow(page); const [stackedWorkspace, stackedPreview] = await Promise.all([page.locator(".teacher-project-workspace").boundingBox(), page.locator(".teacher-project-preview-panel").boundingBox()]); assert.ok(stackedWorkspace.width >= 1200 && stackedPreview.width >= 1200 && !intersects(stackedWorkspace, stackedPreview), JSON.stringify({ stackedWorkspace, stackedPreview }));
    await page.setViewportSize({ width: 1440, height: 900 }); await page.getByRole("button", { name: "Expand preview" }).click(); assert.equal(await page.locator(".teacher-project-workspace").isVisible(), false); assert.ok((await page.locator(".teacher-project-preview-panel").boundingBox()).width > 1300); await page.getByRole("button", { name: "Restore preview" }).click();

    const preview = page.locator(".teacher-project-preview-stage"); await preview.getByRole("button", { name: "Unit 1", exact: true }).click(); await preview.locator(".teacher-project-overview-card").first().waitFor(); assert.equal(await preview.locator(".teacher-project-overview-card").count(), 3);
    const overviewNav = await relativeBox(preview.locator(".teacher-book-navigation"), preview); const overviewToolbar = await relativeBox(preview.locator(".classroom-teaching-toolbar"), preview);
    await preview.locator(".teacher-project-overview-card").nth(0).click(); await preview.locator("[data-entry-id]").waitFor(); assert.equal(await preview.locator("[data-entry-id]").getAttribute("data-layout"), "single-page");
    await preview.getByRole("button", { name: "Next page" }).click(); assert.equal(await preview.locator("[data-entry-id]").getAttribute("data-layout"), "double-wide"); await preview.getByRole("button", { name: "Next page" }).click(); assert.equal(await preview.locator("[data-entry-id]").getAttribute("data-layout"), "double-pair"); assert.equal(await preview.locator(".teacher-project-page-composite img").count(), 2); assert.equal(await preview.getByRole("button", { name: "Next page" }).isDisabled(), true);
    const pageNav = await relativeBox(preview.locator(".teacher-book-navigation"), preview); const pageToolbar = await relativeBox(preview.locator(".classroom-teaching-toolbar"), preview); for (const key of ["x", "y", "width", "height"]) assert.equal(Math.abs(overviewNav[key] - pageNav[key]) <= .5, true, `${key}: ${overviewNav[key]} vs ${pageNav[key]}`); for (const key of ["x", "y", "width", "height"]) assert.equal(Math.abs(overviewToolbar[key] - pageToolbar[key]) <= .5, true, `toolbar ${key}`);
    const pageStage = preview.locator("[data-entry-id]"); await pageStage.dispatchEvent("wheel", { deltaY: -100 }); assert.equal(await pageStage.getAttribute("data-zoom"), "1.20"); await preview.getByRole("button", { name: "Previous page" }).click(); await preview.getByRole("button", { name: "Back" }).click(); await preview.getByRole("button", { name: "Home" }).click(); await preview.getByRole("button", { name: "Unit 1", exact: true }).waitFor();
    await page.getByRole("button", { name: "Hide Preview" }).click(); assert.equal(await page.locator(".teacher-project-preview-panel").count(), 0); assert.equal(await entries.nth(1).locator(".teacher-page-entry-toggle").textContent().then((text) => text.includes("Reading")), true);

    await page.getByRole("link", { name: "Back" }).click(); await page.getByRole("heading", { name: "Teacher APK Projects", exact: true }).waitFor();
    const b3 = page.locator(".studio-project-card").filter({ hasText: "Ultimate B3" }); await b3.getByRole("button", { name: "Duplicate" }).click(); await page.getByLabel("New project name").fill("Ultimate B4"); await page.getByLabel("New project slug / ID").fill("ultimate-b4"); await page.getByRole("button", { name: "Create duplicate" }).click();
    await page.getByText(/ultimate-b4 · Revision 1/).waitFor(); await page.locator("#teacher-tab-units").click(); await page.getByRole("heading", { name: "Units", exact: true }).waitFor(); assert.notEqual(await page.locator(".teacher-project-control-row").filter({ hasText: "Unit 1" }).first().locator("select").inputValue(), "");
    await page.locator("#teacher-tab-assets").click(); await page.getByRole("button", { name: "Preview", exact: true }).click(); const unitQa = page.locator(".teacher-qa-list article").filter({ hasText: "Unit 1" }).first(); await unitQa.locator("button").first().click(); await page.locator(".teacher-project-qa-focus").waitFor(); await unitQa.getByRole("button", { name: "Simulate active" }).click(); await page.locator(".teacher-project-qa-active").waitFor();
    for (const viewport of authoringViewports) { await page.setViewportSize(viewport); await assertNoOverflow(page); }

    const b3Manifest = JSON.parse(await fs.readFile(path.join(fixture.workspace, "teacher-projects", "ultimate-b3", "teacher-project.json"), "utf8")); const b4Manifest = JSON.parse(await fs.readFile(path.join(fixture.workspace, "teacher-projects", "ultimate-b4", "teacher-project.json"), "utf8"));
    assert.equal(b4Manifest.revision, 1); assert.deepEqual(b4Manifest.shell, b3Manifest.shell); assert.deepEqual(b4Manifest.content, b3Manifest.content); assert.deepEqual(Object.keys(b4Manifest.assets).sort(), Object.keys(b3Manifest.assets).sort()); assert.doesNotMatch(JSON.stringify([b3Manifest, b4Manifest, ...networkBodies]), /[A-Za-z]:\\(?:Users|AppData)|\/(?:Users|home)\//i); assert.deepEqual(await fs.readdir(path.join(fixture.workspace, "teacher-projects", "ultimate-b4", "exports")), []); await assert.rejects(() => fs.access(path.join(fixture.workspace, "teacher-projects", "ultimate-b4", ".build")));
    process.stdout.write(`${JSON.stringify({ status: "teacher-project-authoring-ux-safe", flows: 59, authoringViewports: authoringViewports.length, screenshots: 8, sourceRevision: b3Manifest.revision, duplicateRevision: b4Manifest.revision, pageEntries: b3Manifest.content.studentsBook.units[0].entries.length }, null, 2)}\n`);
  } finally { await browser?.close(); await studio.server.close(); await fixture.cleanup(); }
}

async function expectText(locator, values) {
  const text = await locator.textContent(); for (const value of values) assert.ok(text.includes(value), `${value} missing from ${text}`);
}

run().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
