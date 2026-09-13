import assert from "node:assert/strict";
import sharp from "sharp";
import { expect } from "@playwright/test";

export async function exerciseVisualTargetAuthoring(page, { screenshotRoot, savedPair, title }) {
  await page.getByRole("button", { name: "Add Activity", exact: true }).click();
  await page.getByRole("radio", { name: /Mark the Words/ }).check();
  await page.getByLabel(/Initial title/).fill(`${title} targets`);
  await page.getByRole("button", { name: "Create activity", exact: true }).click();
  const editor = page.locator(".native-mark-words-editor");
  await editor.getByRole("button", { name: "Create image targets without passage" }).click();
  await editor.getByRole("button", { name: "Add panel", exact: true }).click();
  const background = await sharp({ create: { width: 1024, height: 582, channels: 3, background: "#cde4ed" } }).png().toBuffer();
  const graphic = await sharp({ create: { width: 120, height: 3, channels: 4, background: "#be2030" } }).png().toBuffer();
  await editor.getByLabel("Upload background", { exact: true }).setInputFiles({ name: "target-background.png", mimeType: "image/png", buffer: background });
  await editor.locator(".native-mark-words-canvas > img").waitFor();
  await editor.getByRole("button", { name: "Draw target", exact: true }).click();
  const stage = editor.locator(".native-mark-words-canvas"); await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  for (let index = 0; index < 3; index++) {
    const x = box.x + (40 + index * 250) / 1024 * box.width; const y = box.y + 100 / 582 * box.height;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 150 / 1024 * box.width, y + 45 / 582 * box.height, { steps: 4 }); await page.mouse.up();
  }
  await editor.getByRole("button", { name: "Finish drawing", exact: true }).click();
  await expect(editor.locator(".native-mark-words-authoring-hit")).toHaveCount(3);
  await editor.getByRole("button", { name: "Word hotspot 1", exact: true }).click();
  await editor.getByLabel("Target label", { exact: true }).fill("Repeated word");
  await editor.getByLabel("Answer", { exact: true }).selectOption("correct");
  await editor.getByLabel("Upload graphic", { exact: true }).setInputFiles({ name: "underline.png", mimeType: "image/png", buffer: graphic });
  await expect(editor.getByLabel("Selected graphic", { exact: true })).not.toHaveValue("");
  const slot = await editor.getByLabel("Selected graphic", { exact: true }).inputValue();
  await editor.getByRole("button", { name: "Word hotspot 2", exact: true }).click();
  await editor.getByLabel("Target label", { exact: true }).fill("Repeated word");
  await editor.getByLabel("Selected graphic", { exact: true }).selectOption(slot);
  await editor.getByRole("button", { name: "Word hotspot 3", exact: true }).click();
  await expect(editor.getByLabel("Selected graphic", { exact: true })).toHaveValue("");
  await editor.getByRole("button", { name: "Save Draft", exact: true }).click();
  await editor.getByText("Draft saved.", { exact: true }).waitFor();
  if (savedPair) {
    const pair = savedPair(`${title} targets`); assert.ok(pair);
    const value = pair.publicDocument.parts[0].interaction;
    assert.equal(value.schemaVersion, "mark-the-words.visual.v1"); assert.equal(Object.hasOwn(value, "items"), false);
    assert.equal(value.targets.length, 3); assert.equal(new Set(value.targets.map((target) => target.id)).size, 3);
    assert.equal(pair.teacherDocument.parts[0].solution.answers[0].correctTargetIds.length, 1);
    assert.equal(value.presentation.panels[0].hotspots[2].graphicAssetSlot, null);
    assert.equal(pair.publicDocument.assets.length, 2);
    assert.doesNotMatch(JSON.stringify(pair.publicDocument), /correctTargetIds|correctWordIds|isCorrect/);
  }
  await page.screenshot({ path: `${screenshotRoot}/visual-target-authoring.png`, fullPage: true });
}
