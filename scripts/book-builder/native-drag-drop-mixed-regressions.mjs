import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { createServer } from "../../tests/_vite-test-server.mjs";
import { dndId } from "../../tests/fixtures/native-runtime-regressions/drag-drop-improvements-data.js";
import { assertDragDropContained, captureDragDropTarget, verifyDragDropContainment } from "./native-drag-drop-containment.mjs";

export async function runMixedDragDropRegressions(browser, baseUrl, output) {
  const images = {};
  for (const [slot, width, height] of [["background", 1024, 582], ["overlay", 150, 100], ["item", 120, 60], ["readable", 1000, 1800]]) {
    images[slot] = await sharp({ create: { width, height, channels: 3, background: "#278244" } }).png().toBuffer();
  }
  const evidence = [];
  // Predefined stability check: all three independent cold contexts must pass.
  for (let cold = 0; cold < 3; cold++) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/dnd-fixture/*", (route) => route.fulfill({ contentType: "image/png", body: images[new URL(route.request().url()).pathname.split("/").pop()] }));
    try {
      for (const fontFamily of ["Arial", "Verdana"]) for (const layoutMode of ["standard", "text"]) for (const scale of [1, .65]) {
        const label = `mixed-${cold}-${fontFamily}-${layoutMode}-${scale}`;
        await page.goto(`${baseUrl}tests/fixtures/native-runtime-regressions/drag-drop-improvements.html`);
        const word = (n) => page.locator(`[data-drag-drop-word-id="${dndId("word", n)}"]`);
        const target = (n) => page.locator(`[data-drag-drop-target-id="${dndId("target", n)}"]`);
        await expect(word(1).locator("img")).toBeVisible();
        await page.evaluate(({ layoutMode, scale, fontFamily }) => {
          dnd.setScale(scale); dnd.setPair((pair) => {
            const next = structuredClone(pair); next.publicDocument.parts[0].interaction.layoutMode = layoutMode;
            next.publicDocument.parts[0].interaction.presentation.placedAnswerStyle.fontFamily = fontFamily;
            return next;
          });
        }, { layoutMode, scale, fontFamily });
        await expect(page.locator(".native-drag-drop")).toHaveAttribute("data-layout-mode", layoutMode);
        await expect(page.locator("#root > div")).toHaveCSS("transform", `matrix(${scale}, 0, 0, ${scale}, 0, 0)`);
        const before = await page.evaluate(() => JSON.stringify(dnd.pair));
        const place = async (n, destination = 1) => { await word(n).click(); await expect(word(n)).toHaveAttribute("aria-pressed", "true"); await target(destination).click({ position: { x: 3, y: 3 } }); };
        const check = async (state, destination = 1) => {
          const snapshot = await verifyDragDropContainment(target(destination), output, `${label}-${state}`);
          evidence.push({ label, state, outer: snapshot.outer, violations: snapshot.violations, fit: snapshot.fit });
        };
        await place(1); await expect(target(1).locator("img")).toHaveCount(1); await check("image-only");
        await place(2); await expect(target(1).locator("[data-drag-drop-target-text]")).toHaveCount(2); await check("student");
        assert.deepEqual(await page.evaluate(() => dnd.responses), { [dndId("target", 1)]: [dndId("word", 1), dndId("word", 2)] });
        await expect(word(1)).toHaveCount(1); await expect(word(2)).toHaveCount(0);
        if (cold === 0 && fontFamily === "Verdana" && layoutMode === "standard" && scale === 1) {
          const text = target(1).locator("[data-drag-drop-target-text]:not([data-image-item])");
          await text.evaluate((el) => { el.style.transform = "translateX(260px)"; });
          const overflow = await target(1).evaluate(captureDragDropTarget);
          await writeFile(`${output}/mixed-deliberate-overflow.json`, JSON.stringify(overflow, null, 2));
          await page.screenshot({ path: `${output}/mixed-deliberate-overflow.png`, fullPage: true });
          assert.throws(() => assertDragDropContained(overflow), { name: "AssertionError" });
          await text.evaluate((el) => el.style.removeProperty("transform")); await check("restored-oracle");
        }
        await target(1).getByRole("button", { name: /^Remove Longer|^Remove A,/ }).click();
        await check("removed-text"); await place(2); await check("reinserted-text");
        await page.getByRole("button", { name: "Next", exact: true }).click(); await place(1, 2); await check("next-image", 2);
        await page.getByRole("button", { name: "Previous", exact: true }).click(); await check("returned");
        await place(3, 3); await expect(target(3).locator(".native-drag-drop-target-items")).toHaveAttribute("data-fit-status", "fit"); await check("text-only", 3);
        const responses = await page.evaluate(() => structuredClone(dnd.responses));
        await page.evaluate(() => dnd.setReadOnly(true)); await expect(word(1)).toBeDisabled(); await check("read-only");
        await page.evaluate(() => dnd.setTeacher(true)); await target(1).click(); await expect(target(1)).toHaveAttribute("data-revealed", "true"); await check("teacher");
        assert.deepEqual(await page.evaluate(() => dnd.responses), responses);
        assert.equal(await page.evaluate(() => JSON.stringify(dnd.pair)), before, "Responses and reveal must not mutate serialized authored documents or target geometry");
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      await writeFile(`${output}/mixed-context-${cold}-failure.json`, JSON.stringify({ errors, url: page.url(), body: await page.locator("body").innerText() }, null, 2));
      await page.screenshot({ path: `${output}/mixed-context-${cold}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  await writeFile(`${output}/mixed-summary.json`, JSON.stringify({ coldContexts: 3, cases: 24, evidence }, null, 2));
  console.log("Mixed image/text containment: 3 cold contexts, 24 font/layout/scale cases; Student, review, Teacher, reusable, removal/navigation and overflowing-oracle control passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.env.NATIVE_REGRESSION_OUTPUT || "test-results/native-mixed-containment";
  await mkdir(output, { recursive: true });
  const server = await createServer({ configFile: false, plugins: [react()], optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/drag-drop-improvements.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen(); const browser = await chromium.launch({ headless: true });
  try { await runMixedDragDropRegressions(browser, server.resolvedUrls.local[0], output); }
  finally { await browser.close(); await server.close(); }
}
