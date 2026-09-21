import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sharedTextPair } from "../../tests/fixtures/native-builder-options.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";
export async function runNativeBuilderOptionsRegressions(browser, base, output) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/builder/api/**/fonts", (route) => route.fulfill({ json: { fonts: [] } }));
  try {
    await page.goto(`${base}tests/fixtures/native-runtime-regressions/builder-options.html`);
    await page.waitForFunction(() => Boolean(globalThis.optionsFixture));
    await page.evaluate(() => optionsFixture.setMode("teacher"));
    const targets = page.locator("[data-drag-drop-target-id]");
    await page.locator('[data-drag-drop-word-id]').filter({ hasText: "apple" }).click(); await targets.first().click();
    await expect(targets.first()).toContainText("Apple");
    await page.evaluate(() => optionsFixture.command("show-all"));
    await expect(page.locator("[data-drag-drop-target-text]")).toHaveCount(4);
    const revealed = await page.locator("[data-drag-drop-target-text]").allTextContents();
    assert.equal(new Set(revealed.map((text) => text.toLowerCase())).size, 4);
    await page.screenshot({ path: `${output}/options-alternatives-teacher.png` });
    await page.evaluate(() => { optionsFixture.command("reset-activity"); });
    await expect(page.locator("[data-drag-drop-target-text]")).toHaveCount(0);
    await targets.first().click(); await expect(targets.first().locator("[data-drag-drop-target-text]")).toHaveCount(1);
    await page.evaluate(() => { optionsFixture.setMode("student"); });
    await page.locator('[data-drag-drop-word-id]').filter({ hasText: "apple" }).click(); await targets.first().click();
    await expect(targets.first()).toContainText("apple");
    await page.evaluate(() => optionsFixture.reload()); await expect(targets.first()).toContainText("apple");
    await page.evaluate(() => { optionsFixture.load("mark"); optionsFixture.setMode("student"); });
    const palette = page.getByRole("group", { name: "Marker palette" });
    await expect(palette.getByRole("button")).toHaveCount(3);
    const first = page.getByRole("button", { name: "Correct target", exact: true });
    await palette.getByRole("button").nth(0).click(); await first.click();
    await palette.getByRole("button").nth(1).click(); await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    assert.equal(await page.evaluate(() => Object.values(optionsFixture.responses).filter(Array.isArray).flat().length), 1);
    await page.evaluate(() => optionsFixture.reload()); await expect(first).toHaveAttribute("aria-pressed", "true");
    await first.click(); // Reload resets the active palette, so this changes color.
    await first.click(); await expect(first).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => { optionsFixture.setMode("teacher"); });
    await expect(page.locator('[data-mode="teacher"] .native-mark-words-hit')).toHaveCount(3);
    await page.evaluate(() => optionsFixture.command("show-all"));
    await expect(page.locator(".native-mark-words-hit[aria-pressed=true]")).toHaveCount(2);
    assert.deepEqual((await page.locator('.native-mark-words-stage [data-marker-kind="outline"] rect').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("stroke")))).sort(), ["#0055cc", "#dd7700"]);
    await page.screenshot({ path: `${output}/options-outline-teacher.png` });
    await page.evaluate(() => { optionsFixture.load("multi"); optionsFixture.setMode("student"); });
    for (const scale of [1, .65]) {
      await page.evaluate((value) => optionsFixture.setScale(value), scale);
      const workspaces = page.locator("[data-shared-text] .native-drag-drop-workspace");
      await expect(workspaces).toHaveCount(2);
      const scrollbars = page.getByRole("scrollbar", { name: "Text Drag & Drop vertical scroll", exact: true });
      await expect(scrollbars).toHaveCount(2);
      assert.notEqual(await scrollbars.nth(0).getAttribute("aria-controls"), await scrollbars.nth(1).getAttribute("aria-controls"));
      for (let i = 0; i < 2; i++) {
        const viewport = workspaces.nth(i);
        await viewport.focus(); await page.keyboard.press("Home");
        await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(0);
        const before = await viewport.locator(".native-drag-drop-stage").boundingBox();
        const bankBefore = await page.locator('[data-section-kind="drag-drop"]').nth(i).locator('.native-drag-drop-bank').boundingBox();
        const otherBefore = await page.locator('[data-section-kind="single-choice"]').boundingBox();
        await viewport.focus(); await page.keyboard.press("End");
        await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
        const image = await viewport.locator("img").boundingBox(), stage = await viewport.locator(".native-drag-drop-stage").boundingBox();
        assert.ok(stage.y < before.y); assert.ok(Math.abs(stage.y - image.y) < 1);
        assert.deepEqual(await page.locator('[data-section-kind="single-choice"]').boundingBox(), otherBefore);
        assert.deepEqual(await page.locator('[data-section-kind="drag-drop"]').nth(i).locator('.native-drag-drop-bank').boundingBox(), bankBefore);
        const section = page.locator('[data-section-kind="drag-drop"]').nth(i);
        await section.locator('[data-drag-drop-word-id]').click();
        await section.locator('[data-drag-drop-target-id]').click();
        await expect(section.locator('[data-drag-drop-target-text]')).toHaveText("A");
      }
      await page.screenshot({ path: `${output}/options-shared-text-${scale}.png` });
      await page.evaluate(() => optionsFixture.command("reset-activity"));
      await expect(page.locator('[data-drag-drop-target-text]')).toHaveCount(0);
    }
    await page.evaluate(() => { optionsFixture.setMode("teacher"); });
    await page.evaluate(() => optionsFixture.command("show-all"));
    await expect(page.locator('[data-drag-drop-target-text]')).toHaveCount(2);
    await page.evaluate(() => optionsFixture.command("reset-activity"));
    await expect(page.locator('[data-drag-drop-target-text]')).toHaveCount(0);
    let savedPair = sharedTextPair(), saved = 0;
    await page.route("**/builder/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/fonts")) return route.fulfill({ json: { fonts: [] } });
      if (pathname.includes("/native-activity-public/")) return route.fulfill({ json: { document: savedPair.publicDocument, revision: 1 + saved } });
      if (pathname.includes("/native-activity-teacher/")) return route.fulfill({ json: { document: savedPair.teacherDocument, revision: 1 + saved } });
      if (pathname.endsWith("/preview")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="582"><rect width="1024" height="582" fill="#dfedf8"/></svg>' });
      if (pathname.endsWith("/save")) {
        const input = route.request().postDataJSON(), options = { activityId: input.publicDocument.activityId, kind: "multi-part" };
        const publicDocument = normalizeNativeRuntimePublicDocument(input.publicDocument, options);
        const teacherDocument = normalizeNativeRuntimeTeacherDocument(input.teacherDocument, { ...options, publicDocument });
        savedPair = { publicDocument, teacherDocument }; saved++;
        return route.fulfill({ json: { ...savedPair, publicRevision: 1 + saved, teacherRevision: 1 + saved } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto(`${base}tests/fixtures/native-runtime-regressions/shared-five.html?parent-editor`);
    const editor = page.locator(".native-multi-part-editor");
    await editor.getByRole("button", { name: "Section 1", exact: true }).click();
    const child = editor.locator(".native-drag-drop-editor:visible");
    await child.getByRole("radio", { name: "Standard drag-and-drop", exact: true }).check();
    await child.getByRole("radio", { name: "Text drag-and-drop", exact: true }).check();
    const region = editor.getByRole("group", { name: "Scrolling text image region (parent source coordinates)", exact: true });
    await region.getByLabel("Quick Height", { exact: true }).fill("290");
    await region.getByLabel("Quick Y", { exact: true }).fill("150");
    await child.getByRole("tab", { name: "Layout", exact: true }).click();
    await child.getByRole("button", { name: /1\. Place tick/ }).click();
    await expect(child.getByLabel("Target answer mode", { exact: true })).toHaveValue("any");
    await child.getByLabel("Target answer mode", { exact: true }).selectOption("all");
    await child.getByLabel("Target answer mode", { exact: true }).selectOption("any");
    await child.getByRole("checkbox", { name: /Sentence start/ }).uncheck();
    await editor.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect.poll(() => saved).toBe(1);
    const savedSection = savedPair.publicDocument.parts[0].interaction.sections[0];
    assert.equal(savedSection.interaction.layoutMode, "text"); assert.equal(savedSection.interaction.panels[0].dropTargets[0].sentenceStart, false);
    assert.deepEqual(savedSection.textRegion, { x: 0, y: 150, width: 500, height: 290 });
    await page.reload(); await editor.getByRole("button", { name: "Section 1", exact: true }).click();
    await expect(child.getByRole("radio", { name: "Text drag-and-drop", exact: true })).toBeChecked();
    await page.screenshot({ path: `${output}/options-builder-shared-text.png` });
    await page.goto(`${base}tests/fixtures/native-runtime-regressions/marker-candidate.html`);
    await page.waitForFunction(() => Boolean(globalThis.markerFixture));
    await page.evaluate(() => markerFixture.setMode("editor"));
    await page.getByLabel("Drawing marker type", { exact: true }).selectOption("outline");
    await page.getByRole("checkbox", { name: /Grade outline categories by color/ }).check();
    await page.getByLabel("Drawing marker color", { exact: true }).fill("#0055cc");
    await page.getByRole("button", { name: "Word hotspot 1", exact: true }).click();
    await page.getByLabel("Selected marker color", { exact: true }).fill("#0055cc");
    const presetCount = await page.evaluate(() => markerFixture.pair.publicDocument.parts[0].interaction.presentation.markerPresets.length);
    await page.getByLabel("Selected marker thickness", { exact: true }).fill("7");
    await expect(page.getByLabel("Selected marker thickness", { exact: true })).toHaveValue("7");
    assert.equal(await page.evaluate(() => markerFixture.pair.publicDocument.parts[0].interaction.presentation.markerPresets.length), presetCount);
    const groupedPair = await page.evaluate(() => JSON.parse(JSON.stringify(markerFixture.pair)));
    const groupedPublic = normalizeNativeRuntimePublicDocument(groupedPair.publicDocument, { activityId: groupedPair.publicDocument.activityId, kind: "mark-the-words" });
    normalizeNativeRuntimeTeacherDocument(groupedPair.teacherDocument, { activityId: groupedPublic.activityId, kind: "mark-the-words", publicDocument: groupedPublic });
    assert.equal(Object.values(groupedPair.teacherDocument.parts[0].solution.answers[0].categories)[0], "#0055cc");
    assert.doesNotMatch(JSON.stringify(groupedPublic.parts[0].interaction.presentation.panels), /"marker":|#0055cc/);
    await page.screenshot({ path: `${output}/options-builder-outline.png` });
    assert.deepEqual(errors, []);
  } catch (error) { await page.screenshot({ path: `${output}/options-failure.png` }); console.error(await page.locator("body").innerText(), errors); throw error; }
  finally { await page.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createServer } = await import("../../tests/_vite-test-server.mjs");
  const { default: react } = await import("@vitejs/plugin-react");
  const { chromium } = await import("@playwright/test");
  const { mkdir } = await import("node:fs/promises");
  const output = "test-results/native-builder-options";
  await mkdir(output, { recursive: true });
  const server = await createServer({ configFile: false, plugins: [react()], optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/builder-options.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  try { await runNativeBuilderOptionsRegressions(browser, server.resolvedUrls.local[0], output); console.log("Native Builder options browser acceptance passed."); }
  finally { await browser.close(); await server.close(); }
}
