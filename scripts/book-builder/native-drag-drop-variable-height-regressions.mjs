import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { dragDropImprovementsPair, dndId } from "../../tests/fixtures/native-runtime-regressions/drag-drop-improvements-data.js";

export async function runDndVariableHeightRegressions(browser, baseUrl, output, { runtimes = ["direct"] } = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = []; const measurements = [];
  await page.addInitScript(() => {
    globalThis.dndResizeCallbacks = 0;
    const Observer = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class extends Observer { constructor(callback) { super((...args) => { globalThis.dndResizeCallbacks++; callback(...args); }); } };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  let height = 582;
  await page.route("**/dnd-fixture/*", async (route) => {
    const slot = new URL(route.request().url()).pathname.split("/").pop();
    const dimensions = slot === "background" ? [1024, height] : slot === "readable" ? [1000, 1800] : [120, 60];
    return route.fulfill({ contentType: "image/png", body: await sharp({ create: { width: dimensions[0], height: dimensions[1], channels: 3, background: slot === "readable" ? "#fff3ce" : "#d5eaff" } }).png().toBuffer() });
  });
  const target = () => page.locator(`[data-drag-drop-target-id="${dndId("target", 3)}"]`);
  const word = () => page.locator(`[data-drag-drop-word-id="${dndId("word", 3)}"]`);
  const marker = () => page.getByRole("button", { name: "Open excerpt 1", exact: true });
  const measure = async (mode) => {
    const callbacks = await page.evaluate(() => new Promise((resolve) => {
      const samples = [];
      const frame = () => { samples.push(globalThis.dndResizeCallbacks); if (samples.length === 8) resolve(samples); else requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    }));
    assert.equal(callbacks.at(-1), callbacks.at(-3), `${mode}: ResizeObserver must settle`);
    const value = await page.locator(".native-drag-drop-stage").evaluate((stage) => {
      const rect = (el) => el.getBoundingClientRect().toJSON();
      const panel = dnd.pair.publicDocument.parts[0].interaction.panels[0];
      const stageBox = rect(stage); const css = getComputedStyle(stage);
      const scale = stageBox.width / stage.offsetWidth;
      const origin = { x: stageBox.x + parseFloat(css.borderLeftWidth) * scale, y: stageBox.y + parseFloat(css.borderTopWidth) * scale };
      const logical = { width: stage.clientWidth, height: stage.clientHeight };
      const regions = [...stage.querySelectorAll(".native-drag-drop-artwork, [data-drag-drop-target-id], .native-audio-text-hotspot")].map((node) => {
        const area = node.matches(".native-drag-drop-artwork") ? panel.images[[...stage.querySelectorAll(".native-drag-drop-artwork")].indexOf(node)].area
          : node.dataset.dragDropTargetId ? panel.dropTargets.find((t) => t.id === node.dataset.dragDropTargetId).area : dnd.pair.publicDocument.audioTextHotspots.hotspots[0].activityArea;
        return { box: rect(node), expected: { x: origin.x + area.x / panel.surface.width * logical.width * scale, y: origin.y + area.y / panel.surface.height * logical.height * scale, width: area.width / panel.surface.width * logical.width * scale, height: area.height / panel.surface.height * logical.height * scale } };
      });
      return { anchored: stage.hasAttribute("data-hotspot-anchored"), active: stage.querySelector('.native-audio-text-hotspot[aria-pressed="true"]') ? rect(stage.querySelector('.native-audio-text-hotspot[aria-pressed="true"]')) : null, viewport: rect(stage.closest(".native-readable-text-activity-view") || stage.parentElement), stage: stageBox, slot: rect(stage.parentElement), bank: rect(stage.querySelector(".native-drag-drop-bank")), surface: panel.surface, regions };
    });
    measurements.push({ mode, ...value });
    assert.ok(Math.abs(value.stage.width / value.stage.height - value.surface.width / value.surface.height) < .02, JSON.stringify(value));
    assert.ok(Math.abs(value.stage.width / value.surface.width - value.stage.height / value.surface.height) < .001, `${mode}: uniform source scaling`);
    if (value.anchored) {
      assert.ok(value.active && value.active.y >= value.viewport.y - 1 && value.active.bottom <= value.viewport.bottom + 1, `${mode}: active hotspot remains visible`);
      assert.ok(value.stage.width >= value.slot.width - 2, `${mode}: preserve full-width crop`);
    } else for (const outer of [value.slot]) assert.ok(value.stage.x >= outer.x - 1 && value.stage.y >= outer.y - 1 && value.stage.right <= outer.right + 1 && value.stage.bottom <= outer.bottom + 1);
    assert.ok(value.bank.height > 0 && value.bank.bottom <= value.stage.bottom + 1);
    for (const region of value.regions) for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(region.box[key] - region.expected[key]) < 1.2, `${mode} ${key}: ${JSON.stringify(region)}`);
  };
  try {
    for (const runtime of runtimes) for (height of [291, 312, 582]) for (const teacher of [false, true]) {
      await page.goto(`${baseUrl}tests/fixtures/native-runtime-regressions/${runtime === "direct" ? "drag-drop-improvements.html" : `drag-drop-renderers.html?runtime=${runtime}`}`);
      const pair = dragDropImprovementsPair();
      for (const panel of pair.publicDocument.parts[0].interaction.panels) {
        panel.surface.height = height;
        for (const entry of [...panel.images, ...panel.dropTargets]) { entry.area.y = Math.round(entry.area.y * height / 582); entry.area.height = Math.round(entry.area.height * height / 582); }
      }
      for (const hotspot of pair.publicDocument.audioTextHotspots.hotspots) hotspot.activityArea.y = Math.round(hotspot.activityArea.y * height / 582);
      await page.evaluate(({ pair, teacher }) => { dnd.setPair(pair); dnd.setTeacher(teacher); }, { pair, teacher });
      await expect(page.locator(".native-drag-drop-stage")).toHaveAttribute("data-surface-height", String(height));
      for (const viewport of [{ width: 1400, height: 950, scale: 1 }, { width: 680, height: 850, scale: 1 }, { width: 1400, height: 950, scale: .65 }]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.evaluate((scale) => dnd.setScale(scale), viewport.scale);
        await expect(page.locator("#root > div")).toHaveCSS("transform", `matrix(${viewport.scale}, 0, 0, ${viewport.scale}, 0, 0)`);
        await measure(`${height}/${teacher}/${viewport.width}/${viewport.scale}/normal`);
        await marker().click(); await expect(page.locator(".native-audio-text-focus")).toBeVisible();
        await measure(`${height}/${teacher}/${viewport.width}/${viewport.scale}/split`);
        await marker().click(); await expect(page.locator(".native-audio-text-focus")).toHaveCount(0);
        if (teacher) { await target().click(); await expect(target()).toHaveAttribute("data-revealed", "true"); }
        else {
          await word().click(); await target().click();
          await expect(target()).toHaveAttribute("data-occupied", "true");
        }
        await marker().click(); await page.keyboard.press("Escape"); await expect(page.locator(".native-audio-text-focus")).toHaveCount(0);
        await expect(target()).toHaveAttribute(teacher ? "data-revealed" : "data-occupied", "true");
        await measure(`${height}/${teacher}/${viewport.width}/${viewport.scale}/returned`);
        if (!teacher) {
          await target().getByRole("button", { name: /^Remove/ }).click();
          // Return to the full activity before dragging to targets outside the locked crop.
          const source = await word().boundingBox(); const destination = await target().boundingBox();
          await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
          await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 8 }); await page.mouse.up();
          await expect(target()).toHaveAttribute("data-occupied", "true");
          await target().getByRole("button", { name: /^Remove/ }).click(); await page.keyboard.press("Escape");
        }
      }
      await page.setViewportSize({ width: 1400, height: 950 }); await page.evaluate(() => dnd.setScale(1));
      await page.screenshot({ path: `${output}/dnd-${runtime}-${height}-${teacher ? "teacher" : "student"}-normal.png` });
      await marker().click(); await page.screenshot({ path: `${output}/dnd-${runtime}-${height}-${teacher ? "teacher" : "student"}-split.png` });
    }
    assert.deepEqual(errors, []);
    await writeFile(`${output}/dnd-variable-height-${runtimes.join("-")}-measurements.json`, JSON.stringify(measurements, null, 2));
  } finally { await page.close(); }
}
