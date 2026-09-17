import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";
export async function runNativeMarkerCandidateRegressions(browser, base, output) {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = [], measures = [];
 page.on("pageerror", (error) => errors.push(error.message));
 await page.route("**/builder/api/**/fonts", (route) => route.fulfill({ json: { fonts: [] } }));
 try {
  await page.goto(`${base}tests/fixtures/native-runtime-regressions/marker-candidate.html`);
  await page.waitForFunction(() => Boolean(globalThis.markerFixture));
  const first = page.getByRole("button", { name: "Correct target", exact: true });
  const wrong = page.getByRole("button", { name: "Wrong no graphic", exact: true });
  await page.getByRole("button", { name: "Marker 1: graphic" }).click(); await first.click();
  await page.getByRole("button", { name: "Marker 2: outline" }).click(); await wrong.click();
  await expect(page.locator(".native-mark-words-graphic")).toHaveCount(2); // mark plus palette preview
  await expect(wrong).toHaveAttribute("aria-pressed", "true");
  const before = await page.evaluate(() => structuredClone(markerFixture.responses));
  await wrong.click(); await page.getByRole("button", { name: "Marker 3: underline" }).click(); await wrong.click();
  assert.equal(await page.evaluate(() => { const group = markerFixture.pair.publicDocument.parts[0].interaction.presentation.panels[0]; return markerFixture.responses.markers[group.id][group.hotspots[0].targetId]; }), Object.values(before.markers)[0][Object.keys(Object.values(before.markers)[0])[0]]);
  await page.evaluate(() => markerFixture.setMode("review")); await expect(first).toBeDisabled();
  await page.evaluate(() => markerFixture.setMode("teacher")); await wrong.click(); await expect(wrong).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Reveal all", exact: true }).click(); await expect(wrong).toHaveAttribute("aria-pressed", "false"); await expect(first).toHaveAttribute("aria-pressed", "true");
  const originalPair = await page.evaluate(() => structuredClone(markerFixture.pair));
  for (const height of [291, 582, 800]) for (const scale of [1, .65]) {
   await page.evaluate(({ originalPair, height }) => { const pair = structuredClone(originalPair); const panel = pair.publicDocument.parts[0].interaction.presentation.panels[0]; panel.sourceHeight = height; for (const hotspot of panel.hotspots) for (const key of ["area", "markArea"]) { hotspot[key].y *= height / 582; hotspot[key].height *= height / 582; } for (const hotspot of pair.publicDocument.audioTextHotspots.hotspots) hotspot.activityArea.y *= height / 582; markerFixture.setPair(pair); }, { originalPair, height });
   await page.evaluate((scale) => { markerFixture.setScale(scale); markerFixture.setMode("student"); }, scale);
   for (let index = 1; index <= 3; index++) {
    const button = page.getByRole("button", { name: `Excerpt ${index}`, exact: true }); await button.click();
    await expect(page.locator("[data-hotspot-anchored]")).toHaveCount(1);
    await expect(page.locator(".native-audio-text-focus-highlight")).toHaveCount(3);
    const geometry = await button.evaluate((node) => { const b = node.getBoundingClientRect(), v = node.closest(".native-readable-text-activity-view").getBoundingClientRect(); return { y: b.y, bottom: b.bottom, top: v.top, viewportBottom: v.bottom }; });
    measures.push({ height, scale, index, ...geometry }); assert.ok(geometry.y >= geometry.top - 1 && geometry.bottom <= geometry.viewportBottom + 1, JSON.stringify(measures));
    const beforeWheel = await page.locator("[data-hotspot-anchored]").getAttribute("style"); await button.hover(); await page.mouse.wheel(0, 500); await page.waitForTimeout(50); assert.equal(await page.locator("[data-hotspot-anchored]").getAttribute("style"), beforeWheel);
    const excerpt = page.locator(".native-audio-text-focus-scroll"); await excerpt.hover(); await page.mouse.wheel(0, 300); await expect.poll(() => excerpt.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    if (index === 3) await page.screenshot({ path: `${output}/marker-focus-${height}-${scale}.png` });
    await button.click(); await expect(page.locator("[data-hotspot-anchored]")).toHaveCount(0);
   }
  }
  await page.evaluate((pair) => { markerFixture.setPair(pair); markerFixture.setMode("hotspot-editor"); }, originalPair);
  await page.getByRole("button", { name: "Select inner highlight 2", exact: true }).first().click();
  const originalHighlights = await page.evaluate(() => structuredClone(markerFixture.pair.publicDocument.audioTextHotspots.hotspots[0].readableHighlights));
  await page.getByRole("group", { name: "Inner colored highlight selected", exact: true }).press("ArrowRight");
  await page.getByRole("button", { name: "Redraw inner highlight", exact: true }).click();
  const canvas = page.locator(".native-audio-hotspot-focus-editor"); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .45, box.y + box.height * .3); await page.mouse.up();
  const redrawn = await page.evaluate(() => markerFixture.pair.publicDocument.audioTextHotspots.hotspots[0].readableHighlights);
  assert.deepEqual(redrawn[0], originalHighlights[0]); assert.deepEqual(redrawn[2], originalHighlights[2]); assert.equal(redrawn[1].id, originalHighlights[1].id); assert.notDeepEqual(redrawn[1].area, originalHighlights[1].area);
  await page.getByRole("button", { name: "Redraw inner highlight", exact: true }).click();
  await page.getByRole("button", { name: "Delete inner highlight", exact: true }).click();
  await expect(canvas).not.toHaveClass(/is-drawing/);
  assert.equal(await page.evaluate(() => markerFixture.pair.publicDocument.audioTextHotspots.hotspots[0].readableHighlights.length), 2);
  await page.getByRole("button", { name: "Add inner highlight", exact: true }).click();
  await page.getByLabel("Hotspot diameter").fill("16");
  assert.equal(await page.evaluate(() => markerFixture.pair.publicDocument.audioTextHotspots.hotspots[0].activityArea.width), 16);
  await page.evaluate(() => { markerFixture.setPair(JSON.parse(JSON.stringify(markerFixture.pair))); markerFixture.setMode("student"); });
  const smallButton = page.getByRole("button", { name: "Excerpt 1", exact: true });
  await smallButton.click(); await expect(page.locator(".native-audio-text-focus-highlight")).toHaveCount(3);
  const smallActive = await smallButton.boundingBox(); const smallStage = await page.locator("[data-hotspot-anchored]").boundingBox(); assert.ok(Math.abs(smallActive.width / smallStage.width * 1024 - 16) < .1, JSON.stringify({ smallActive, smallStage }));
  await smallButton.hover(); await page.mouse.down(); const smallPressed = await smallButton.boundingBox(); assert.ok(Math.abs(smallActive.width - smallPressed.width) < .1); await page.mouse.move(1400, 950); await page.mouse.up();
  const touchPrevented = await smallButton.evaluate((node) => !node.dispatchEvent(new Event("touchmove", { bubbles: true, cancelable: true }))); assert.equal(touchPrevented, true);
  await page.keyboard.press("Escape"); await expect(page.locator("[data-hotspot-anchored]")).toHaveCount(0);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/marker-candidate-measurements.json`, JSON.stringify(measures, null, 2));
 } finally { await page.close(); }
}
