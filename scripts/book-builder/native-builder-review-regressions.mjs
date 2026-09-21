import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { createServer } from "../../tests/_vite-test-server.mjs";
import { dndTeacherStateObserver } from "./dnd-teacher-state-observer.mjs";
import { outlinePair } from "../../tests/fixtures/native-builder-options.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";

export async function runNativeBuilderReviewRegressions(browser, output) {
  await mkdir(output, { recursive: true });
  const observer = { name: "mark-parent-read-only-observer", enforce: "pre", transform(source, id) {
    if (!id.replaceAll("\\", "/").endsWith("/NativeMarkWordsEditor.jsx")) return;
    const anchor = "const { publicDocument: publicDraft, teacherDocument: teacherDraft } = pair;";
    assert.equal(source.split(anchor).length, 2);
    return { code: source.replace(anchor, `${anchor} globalThis.markParentPair = structuredClone(pair);`), map: null };
  } };
  const server = await createServer({ configFile: false, plugins: [observer, dndTeacherStateObserver(), react()], optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/builder-options.html", "tests/fixtures/native-runtime-regressions/marker-candidate.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const base = server.resolvedUrls.local[0], results = [];
  async function scenario(name, run) {
    console.log(`Starting ${name}`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => { globalThis.dndTeacherProbe = { reports: [] }; });
    try { await run(page); assert.deepEqual(errors, []); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); console.log(name, error.message); await page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true, timeout: 10000 }).catch(() => {}); }
    finally { await page.close(); }
  }
  try {
    for (const method of ["click", "pointer", "keyboard"]) await scenario(`R1-${method}`, async (page) => {
      await page.goto(`${base}tests/fixtures/native-runtime-regressions/builder-options.html`);
      await page.evaluate(() => optionsFixture.setMode("teacher"));
      const target = page.locator("[data-drag-drop-target-id]").first();
      await target.click();
      const answer = await target.locator("[data-drag-drop-target-text]").textContent();
      const bank = page.locator(".native-drag-drop-bank [data-drag-drop-word-id]");
      await expect(bank).toHaveCount(3);
      const bankIds = await bank.evaluateAll((nodes) => nodes.map((node) => node.dataset.dragDropWordId));
      if (method === "pointer") {
        const a = await bank.first().boundingBox(), b = await target.boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
      } else if (method === "keyboard") { await bank.first().focus(); await page.keyboard.press("Enter"); await target.focus(); await page.keyboard.press("Space"); }
      else { await bank.first().click(); await target.click(); }
      await expect(page.locator(".native-drag-drop-status")).toHaveText("Target 1 is full.");
      await expect(target.locator("[data-drag-drop-target-text]")).toHaveText(answer);
      await expect(target).toHaveAttribute("data-occupied", "true"); await expect(target).toHaveAttribute("data-full", "true");
      await expect(target).toHaveAttribute("aria-label", /1 of 1 places used/);
      assert.deepEqual(await bank.evaluateAll((nodes) => nodes.map((node) => node.dataset.dragDropWordId)), bankIds);
      assert.deepEqual(await page.evaluate(() => dndTeacherProbe.responses), {});
      assert.ok(await page.evaluate(() => dndTeacherProbe.reports.every((report) => !Object.keys(report.responses).length)));
      await page.evaluate(() => optionsFixture.command("show-next")); await expect(page.locator("[data-revealed]")).toHaveCount(2);
      await page.evaluate(() => optionsFixture.command("show-all")); await expect(page.locator("[data-revealed]")).toHaveCount(4);
      await page.evaluate(() => optionsFixture.command("reset-activity")); await expect(bank).toHaveCount(4);
      await expect(page.locator("[data-occupied]")).toHaveCount(0);
    });
    for (const mode of ["all-required", "reusable"]) await scenario(`R1-${mode}-manual-before-reveal`, async (page) => {
      await page.goto(`${base}tests/fixtures/native-runtime-regressions/builder-options.html`);
      await page.evaluate((mode) => {
        const pair = structuredClone(optionsFixture.pair), interaction = pair.publicDocument.parts[0].interaction;
        interaction.panels[0].dropTargets = interaction.panels[0].dropTargets.slice(0, 1);
        pair.teacherDocument.parts[0].solution.mappings = pair.teacherDocument.parts[0].solution.mappings.slice(0, 1);
        if (mode === "all-required") {
          interaction.panels[0].dropTargets[0].answerMode = "all"; interaction.panels[0].dropTargets[0].capacity = 2;
          pair.teacherDocument.parts[0].solution.mappings[0].wordIds = interaction.words.slice(0, 2).map((word) => word.id);
        } else interaction.words.forEach((word) => { word.reusable = true; });
        optionsFixture.setPair(pair); optionsFixture.setMode("teacher");
      }, mode);
      const target = page.locator("[data-drag-drop-target-id]").first(), bank = page.locator(".native-drag-drop-bank [data-drag-drop-word-id]");
      await bank.filter({ hasText: "apple" }).click(); await target.click();
      await expect.poll(() => page.evaluate(() => Object.keys(dndTeacherProbe.responses || {}).length)).toBe(1);
      const manual = await page.evaluate(() => structuredClone(dndTeacherProbe.responses));
      await page.evaluate(() => optionsFixture.command("show-all"));
      await expect(target.locator("[data-drag-drop-target-text]")).toHaveCount(mode === "all-required" ? 2 : 1);
      await bank.filter({ hasText: "orange" }).click(); await target.click();
      await expect(page.locator(".native-drag-drop-status")).toHaveText("Target 1 is full.");
      assert.deepEqual(await page.evaluate(() => dndTeacherProbe.responses), manual);
      await expect(bank).toHaveCount(mode === "all-required" ? 2 : 4);
      await expect(target).toHaveAttribute("data-full", "true");
      await page.evaluate(() => optionsFixture.command("reset-activity")); await expect(bank).toHaveCount(4);
      await expect(target.locator("[data-drag-drop-target-text]")).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => dndTeacherProbe.responses)).toEqual({});
    });
    async function parent(page, legacy) {
      let stored = outlinePair(), saves = 0;
      const list = stored.publicDocument.parts[0].interaction.presentation.markerPresets;
      const last = list.find((preset) => preset.kind === legacy);
      stored.publicDocument.parts[0].interaction.presentation.markerPresets = [...list.filter((preset) => preset !== last), last];
      await page.route("**/builder/api/**", async (route) => {
        const url = new URL(route.request().url()).pathname;
        if (url.endsWith("/fonts")) return route.fulfill({ json: { fonts: [] } });
        if (url.includes("/native-activity-public/")) return route.fulfill({ json: { document: stored.publicDocument, revision: 1 + saves } });
        if (url.includes("/native-activity-teacher/")) return route.fulfill({ json: { document: stored.teacherDocument, revision: 1 + saves } });
        if (url.endsWith("/preview")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="582"><rect width="1024" height="582" fill="#e4eff9"/></svg>' });
        if (url.endsWith("/save")) {
          const input = route.request().postDataJSON(), options = { activityId: input.publicDocument.activityId, kind: "mark-the-words" };
          const publicDocument = normalizeNativeRuntimePublicDocument(input.publicDocument, options);
          const teacherDocument = normalizeNativeRuntimeTeacherDocument(input.teacherDocument, { ...options, publicDocument });
          stored = { publicDocument, teacherDocument }; saves++;
          return route.fulfill({ json: { ...stored, publicRevision: 1 + saves, teacherRevision: 1 + saves } });
        }
        return route.fulfill({ status: 404, json: {} });
      });
      await page.goto(`${base}tests/fixtures/native-runtime-regressions/marker-candidate.html?parent-editor`);
      await expect(page.getByLabel("Drawing marker type", { exact: true })).toBeVisible();
      const read = () => page.evaluate(() => structuredClone(markParentPair));
      const save = async () => { const before = saves; await page.getByRole("button", { name: "Save Draft", exact: true }).click(); await expect.poll(() => saves).toBe(before + 1); };
      return { read, save, stored: () => structuredClone(stored) };
    }
    for (const legacy of ["underline", "graphic"]) await scenario(`R2-${legacy}`, async (page) => {
      const owner = await parent(page, legacy), initial = owner.stored();
      await page.getByRole("textbox", { name: "Activity title", exact: true }).fill("Reopened grouped palette"); await owner.save(); await page.reload();
      await expect(page.getByLabel("Drawing marker type", { exact: true })).toHaveValue("outline");
      await page.getByRole("button", { name: "Draw target", exact: true }).click();
      const canvas = page.locator(".native-mark-words-canvas"); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * .1, box.y + box.height * .2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .25, box.y + box.height * .3); await page.mouse.up();
      await expect(page.getByRole("button", { name: "Word hotspot 4", exact: true })).toHaveCount(1);
      await owner.save(); await page.reload();
      await expect(page.getByRole("button", { name: "Word hotspot 4", exact: true })).toHaveCount(1);
      const final = await owner.read();
      for (const [id, color] of Object.entries(initial.teacherDocument.parts[0].solution.answers[0].categories)) assert.equal(final.teacherDocument.parts[0].solution.answers[0].categories[id], color);
      assert.deepEqual(final.publicDocument.parts[0].interaction.presentation.markerPresets, initial.publicDocument.parts[0].interaction.presentation.markerPresets);
      await page.screenshot({ path: `${output}/R2-${legacy}.png`, fullPage: true });
    });
    for (const legacy of ["underline", "graphic"]) await scenario(`R2-inherited-${legacy}`, async (page) => {
      await page.route("**/builder/api/**/fonts", (route) => route.fulfill({ json: { fonts: [] } }));
      await page.goto(`${base}tests/fixtures/native-runtime-regressions/marker-candidate.html?inherited-marker=${legacy}`);
      await page.evaluate((pair) => { markerFixture.setPair(pair); markerFixture.setMode("editor"); }, outlinePair());
      await page.getByRole("button", { name: "Draw target", exact: true }).click();
      const canvas = page.locator(".native-mark-words-canvas"); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * .1, box.y + box.height * .2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .25, box.y + box.height * .3); await page.mouse.up();
      await expect(page.getByRole("button", { name: "Word hotspot 4", exact: true })).toHaveCount(1);
      const pair = await page.evaluate(() => markerFixture.pair), before = outlinePair();
      for (const [id, color] of Object.entries(before.teacherDocument.parts[0].solution.answers[0].categories)) assert.equal(pair.teacherDocument.parts[0].solution.answers[0].categories[id], color);
    });
    await scenario("R3-confirmation", async (page) => {
      const owner = await parent(page, "underline"), before = await owner.read();
      const checkbox = page.getByRole("checkbox", { name: /Grade outline categories/ });
      let dialogs = 0;
      page.once("dialog", async (dialog) => { dialogs++; assert.match(dialog.message(), /discard|remove|delete/i); await dialog.dismiss(); });
      await checkbox.click(); await expect(checkbox).toBeChecked(); assert.equal(dialogs, 1); assert.deepEqual(await owner.read(), before);
      await page.reload(); await expect(checkbox).toBeChecked(); assert.deepEqual(await owner.read(), before);
      page.once("dialog", (dialog) => dialog.accept()); await checkbox.uncheck(); await owner.save(); await page.reload();
      await expect(checkbox).not.toBeChecked();
      assert.equal((await owner.read()).teacherDocument.parts[0].solution.answers[0].categories, undefined);
      await checkbox.check(); await owner.save(); await page.reload(); await expect(checkbox).toBeChecked();
      const final = await owner.read(); assert.deepEqual(new Set(Object.values(final.teacherDocument.parts[0].solution.answers[0].categories)), new Set(["#0055cc"]));
      assert.deepEqual(final.teacherDocument.parts[0].solution.answers[0].correctTargetIds, before.teacherDocument.parts[0].solution.answers[0].correctTargetIds);
      assert.ok(final.publicDocument.parts[0].interaction.presentation.panels[0].hotspots.every((hotspot) => !hotspot.marker));
    });
  } finally { await server.close(); }
  await writeFile(`${output}/review-results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  assert.ok(results.every((result) => result.pass), "Review regressions must all pass");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ headless: true });
  try { await runNativeBuilderReviewRegressions(browser, process.env.NATIVE_REVIEW_OUTPUT || "test-results/native-builder-review"); }
  finally { await browser.close(); }
}
