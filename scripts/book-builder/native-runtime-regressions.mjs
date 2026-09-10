import { runNativeMultiPartRegressions } from "./native-multi-part-regressions.mjs";
import { runHistoricalFocusRegressions } from "./native-historical-focus-regressions.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "../../tests/_vite-test-server.mjs";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { runNativePresentationRegressions } from "./native-presentation-regressions.mjs";
import { runNativeDragImageRegressions } from "./native-drag-image-regressions.mjs";

const output = process.env.NATIVE_REGRESSION_OUTPUT || "test-results/native-runtime-regressions";
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, plugins: [react()], optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/index.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: true });
const evidence = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/index.html`);
  await page.locator("[data-drag-drop-word-id]").waitFor();
  for (const scale of [.65, .9, 1]) {
    await page.evaluate((value) => fixture.setScale(value), scale);
    const source = page.locator("[data-drag-drop-word-id]");
    await source.evaluate((element) => { element.style.whiteSpace = "pre-wrap"; element.style.width = "250px"; });
    const snapshot = (locator) => locator.evaluate((element) => {
      const box = element.getBoundingClientRect(); const css = getComputedStyle(element);
      const range = document.createRange(); range.selectNodeContents(element);
      return { width: box.width, height: box.height, fontSize: css.fontSize, logicalWidth: element.offsetWidth, textRects: [...range.getClientRects()].map((rect) => ({ width: rect.width, height: rect.height })), transform: css.transform };
    });
    const before = await snapshot(source); const box = await source.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 55, box.y - 15);
    const preview = page.locator("[data-drag-drop-drag-preview]"); await preview.waitFor();
    const during = await snapshot(preview); evidence.push({ kind: "drag", scale, before, during });
    await page.screenshot({ path: `${output}/drag-${scale}.png` });
    await page.mouse.up(); await preview.waitFor({ state: "detached" });
  }
  await page.evaluate(() => fixture.setKind("listening"));
  await page.getByRole("button", { name: "Play Listening audio" }).click();
  const surface = page.locator(".native-oldschool-listening");
  const audio = surface.locator("audio");
  await expect.poll(() => audio.evaluate((node) => !node.paused && node.currentTime > 0)).toBe(true);
  for (const index of [2, 3, 4, 6, 8]) {
    await audio.evaluate((node, time) => { node.currentTime = time; }, index * 1.5 + .1);
    await surface.locator(`[data-cue-id="cue-${index}"].native-oldschool-listening-highlight`).waitFor();
    for (let tick = 0; tick < 8; tick++) { await page.evaluate(() => fixture.rerender()); await page.waitForTimeout(35); }
    const metrics = await surface.evaluate((root) => { const pane = root.querySelector(".native-oldschool-listening-page-viewport"); const highlight = root.querySelector(".native-oldschool-listening-highlight"); const p = pane.getBoundingClientRect(); const h = highlight.getBoundingClientRect(); return { top: pane.scrollTop, cue: highlight.dataset.cueId, visible: h.top >= p.top && h.bottom <= p.bottom }; });
    evidence.push({ kind: "listening", index, ...metrics });
    await page.screenshot({ path: `${output}/listening-${index}.png` });
  }
  await audio.evaluate((node) => node.pause());
  const pane = surface.locator(".native-oldschool-listening-page-viewport");
  await pane.evaluate((node) => { node.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -600 })); node.scrollTop = 1400; });
  for (let tick = 0; tick < 12; tick++) { await page.evaluate(() => fixture.rerender()); await page.waitForTimeout(35); }
  const manualTop = await pane.evaluate((node) => node.scrollTop);
  evidence.push({ kind: "manual-scroll", manualTop });
  await writeFile(`${output}/measurements.json`, JSON.stringify(evidence, null, 2));
  assert.ok(Math.abs(manualTop - 1400) < 2, `Manual scroll fought by follow: ${manualTop}`);
  await page.evaluate(() => fixture.setScrollTarget(8, 0));
  await surface.getByLabel("Listening audio position").fill("12100");
  await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await surface.getByLabel("Listening audio position").fill("4600");
  await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(900);
  await page.evaluate(() => { fixture.setKind("audio"); fixture.setScale(.65); });
  await page.getByRole("button", { name: "Open supplemental audio Reference" }).click();
  const reference = page.getByRole("region", { name: "Supplemental audio Reference" });
  const referenceBox = await reference.boundingBox(); const hostBox = await page.locator(".teacher-offline-page-stage").boundingBox();
  assert.ok(Math.abs(referenceBox.height - hostBox.height) < 1 && Math.abs(referenceBox.width - hostBox.width) < 1);
  await reference.getByRole("scrollbar").focus(); await page.keyboard.press("End");
  assert.ok(await reference.locator(".native-readable-text-scroll").evaluate((node) => node.scrollTop > 1000));
  await page.keyboard.press("Escape"); await reference.waitFor({ state: "detached" });
  await page.evaluate(() => fixture.setKind("typography"));
  await page.locator(".native-or-answer-layer").click();
  const lines = page.locator(".native-or-answer-line");
  await expect(lines).toHaveCount(3);
  assert.deepEqual(await lines.allTextContents(), ["A", "", "B"]);
  assert.equal(await page.locator(".native-or-answer-layer").getAttribute("data-effective-font-size"), "100");
  await writeFile(`${output}/measurements.json`, JSON.stringify(evidence, null, 2));
  for (const entry of evidence.filter((item) => item.kind === "drag")) {
    assert.ok(Math.abs(entry.before.width - entry.during.width) < 1, JSON.stringify(entry));
    assert.equal(entry.before.textRects.length, entry.during.textRects.length, JSON.stringify(entry));
    entry.before.textRects.forEach((rect, index) => assert.ok(Math.abs(rect.height - entry.during.textRects[index].height) < 1 && Math.abs(rect.width - entry.during.textRects[index].width) < 1, JSON.stringify(entry)));
  }
  for (const entry of evidence.filter((item) => item.kind === "listening")) assert.ok(entry.visible && entry.top > 0, JSON.stringify(entry));
  await runNativePresentationRegressions(browser, output);
  await runHistoricalFocusRegressions(browser, output);
  await runNativeDragImageRegressions(browser, server.resolvedUrls.local[0], output);
  await runNativeMultiPartRegressions(browser, server.resolvedUrls.local[0], output);
  console.log("Native runtime browser regressions passed.");
} finally { await browser.close(); await server.close(); }
