import assert from "node:assert/strict";
import sharp from "sharp";
import { expect } from "@playwright/test";
export async function exerciseVisualTargetAuthoring(page, { screenshotRoot, savedPair, title }) {
 await page.getByRole("button", { name: "Add Activity", exact: true }).click();
 await page.getByRole("radio", { name: /Mark the Words/ }).check(); await page.getByLabel(/Initial title/).fill(title);
 await page.getByRole("button", { name: "Create activity", exact: true }).click();
 const editor = page.locator(".native-mark-words-editor"); await editor.waitFor();
 await expect(editor.getByRole("tab", { name: "Content", exact: true })).toHaveCount(0);
 const background = await sharp({ create: { width: 600, height: 200, channels: 3, background: "#cde4ed" } }).png().toBuffer();
 const graphic = await sharp({ create: { width: 120, height: 3, channels: 4, background: "#be2030" } }).png().toBuffer();
 const graphicB = await sharp({ create: { width: 120, height: 3, channels: 4, background: "#209030" } }).png().toBuffer();
 const draw = async (indices) => {
  await editor.getByRole("button", { name: "Draw target", exact: true }).click(); const stage = editor.locator(".native-mark-words-canvas"); await stage.scrollIntoViewIfNeeded(); const box = await stage.boundingBox();
  for (const index of indices) { const x = box.x + (20 + index * 170) / 600 * box.width, y = box.y + 60 / 200 * box.height; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 120 / 600 * box.width, y + 35 / 200 * box.height, { steps: 4 }); await page.mouse.up(); }
  await editor.getByRole("button", { name: "Finish drawing", exact: true }).click();
 };
 for (let panel = 0; panel < 2; panel++) {
  await editor.getByRole("button", { name: "Add panel", exact: true }).click();
  await editor.getByLabel("Upload background", { exact: true }).setInputFiles({ name: `words-background-${panel}.png`, mimeType: "image/png", buffer: background });
  await editor.locator(".native-mark-words-canvas > img").waitFor();
  await editor.getByLabel("New target answer", { exact: true }).selectOption("correct");
  await editor.getByLabel("Drawing marker upload graphic", { exact: true }).setInputFiles({ name: "words-marker-a.png", mimeType: "image/png", buffer: graphic });
  await expect(editor.getByLabel("Drawing marker graphic", { exact: true })).not.toHaveValue("");
  await expect(editor.getByLabel("Drawing marker height", { exact: true })).toHaveValue("3");
  await draw([0]);
  if (!panel) {
   await editor.getByLabel("New target answer", { exact: true }).selectOption("incorrect");
   await editor.getByLabel("Drawing marker upload graphic", { exact: true }).setInputFiles({ name: "words-marker-b.png", mimeType: "image/png", buffer: graphicB });
   await expect(editor.getByLabel("Drawing marker graphic", { exact: true })).not.toHaveValue("");
   await draw([1, 2]); await expect(editor.locator(".native-mark-words-authoring-hit")).toHaveCount(3);
   await expect(editor.getByLabel("Target label", { exact: true })).toHaveValue("Target 3"); await editor.getByLabel("Selected marker type", { exact: true }).selectOption("outline");
   await editor.getByLabel("Selected marker color", { exact: true }).fill("#1122cc"); await editor.getByLabel("Selected marker thickness", { exact: true }).fill("4");
  }
 }
 await editor.getByRole("button", { name: "Save Draft", exact: true }).click(); await editor.getByText("Draft saved.", { exact: true }).waitFor();
 const pair = savedPair?.(title);
 if (pair) {
  const value = pair.publicDocument.parts[0].interaction; assert.equal(value.presentation.kind, "visual-target"); assert.equal(value.items, undefined); assert.equal(value.targets.length, 4); assert.deepEqual(value.presentation.panels.map((panel) => [panel.sourceWidth, panel.sourceHeight]), [[600, 200], [600, 200]]);
  assert.deepEqual(pair.teacherDocument.parts[0].solution.answers.map((answer) => answer.correctTargetIds.length), [1, 1]);
  const [first, second, third] = value.presentation.panels[0].hotspots;
  assert.notEqual(first.graphicAssetSlot, second.graphicAssetSlot); assert.equal(third.marker.kind, "outline"); assert.equal(third.marker.thickness, 4);
  assert.equal(first.markArea.height, 3); assert.equal(first.markArea.y, first.area.y + first.area.height - 3);
  assert.ok(value.presentation.markerPresets.length >= 3); assert.doesNotMatch(JSON.stringify(pair.publicDocument), /correctTargetIds|correctWordIds|isCorrect/);
 }
 await page.screenshot({ path: `${screenshotRoot}/visual-target-authoring.png`, fullPage: true }); return pair?.publicDocument.activityId || null;
}
