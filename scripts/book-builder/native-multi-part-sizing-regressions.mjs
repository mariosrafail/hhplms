import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { expect } from "@playwright/test";

export async function runMultiPartSizingRegressions(browser, baseUrl, output, { baseline = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const background = await sharp({ create: { width: 1024, height: 582, channels: 3, background: "#c5e5ef" } }).png().toBuffer();
  await page.route("**/synthetic-shared.png", (route) => route.fulfill({ contentType: "image/png", body: background }));
  const evidence = [];
  const measure = async (name) => {
    const field = page.locator(".native-multi-part-panel--flow:visible .native-complete-sentences-blank input, .native-multi-part-panel--flow:visible .native-complete-sentences-teacher-target");
    await field.waitFor();
    await page.locator(".native-multi-part-panel--flow:visible").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const data = await field.evaluate((node) => {
      const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const ancestors = []; for (let element = node; element && element.id !== "root"; element = element.parentElement) { const css = getComputedStyle(element); ancestors.push({ className: element.className, ...rect(element), clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, overflow: css.overflow, rows: css.gridTemplateRows }); }
      return { hit: hit === node || node.contains(hit), fullyVisible: ancestors.every((ancestor) => !/hidden|clip|auto|scroll/.test(ancestor.overflow) || box.top >= ancestor.y - 1 && box.bottom <= ancestor.bottom + 1), ancestors };
    });
    evidence.push({ name, ...data });
    await page.screenshot({ path: `${output}/sizing-${baseline ? "before" : "after"}-${name}.png` });
    await writeFile(`${output}/sizing-${baseline ? "before" : "after"}.json`, JSON.stringify(evidence, null, 2));
    if (!baseline) {
      assert.ok(data.hit && data.fullyVisible, `${name}: bottom input is clipped or covered: ${JSON.stringify(data)}`);
      if (await field.evaluate((node) => node.tagName === "INPUT")) { await field.fill(name); await expect(field).toHaveValue(name); } else await field.click();
      const stage = data.ancestors.find((entry) => entry.className === "native-complete-sentences-stage");
      assert.ok(Math.abs(stage.width / stage.height - 1024 / 582) < .01, `${name}: distorted source geometry`);
    }
  };
  try {
    await page.goto(`${baseUrl}tests/fixtures/native-runtime-regressions/multi-part-sizing.html`);
    await measure("cold-flow");
    await page.evaluate(() => sizingFixture.setTeacher(true));
    await measure("teacher-cold-flow");
    await page.evaluate(() => sizingFixture.setSplit(true));
    await page.getByRole("button", { name: "Next panel", exact: true }).click();
    await measure("panel-change");
    await page.getByRole("button", { name: "Previous panel", exact: true }).click();
    await page.getByRole("button", { name: "Next panel", exact: true }).click();
    await measure("panel-return");
    await page.setViewportSize({ width: 600, height: 850 }); await measure("responsive");
    await page.getByRole("button", { name: "Fullscreen fixture" }).click(); await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe("sizing-host"); await measure("fullscreen");
    await page.evaluate(() => document.exitFullscreen());
    await page.evaluate(() => sizingFixture.setOpen(false)); await page.evaluate(() => sizingFixture.setOpen(true));
    await page.getByRole("button", { name: "Next panel", exact: true }).click(); await measure("reopen");
  } finally { await page.close(); }
}
