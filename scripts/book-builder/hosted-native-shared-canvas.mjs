import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import sharp from "sharp";

export async function authorHostedSharedCanvas(page, editor) {
  const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#e4eef6" } }).png().toBuffer();
  await editor.getByRole("button", { name: "Add shared canvas", exact: true }).click();
  await editor.getByLabel("Shared background", { exact: true }).setInputFiles({ name: "choice-composed-background.png", mimeType: "image/png", buffer: bytes });
  await expect(editor.getByRole("button", { name: "Add Section", exact: true })).toBeEnabled();
  await editor.getByLabel("Section type", { exact: true }).selectOption("drag-drop");
  await editor.getByRole("button", { name: "Add Section", exact: true }).click();
  await editor.getByLabel("Section title", { exact: true }).fill("Shared tick");
  const drag = editor.locator(".native-drag-drop-editor:visible");
  await drag.getByRole("button", { name: "Add word", exact: true }).click();
  await drag.getByLabel("Word 1", { exact: true }).fill("Tick");
  await drag.getByLabel("Reusable item", { exact: true }).check();
  await drag.getByLabel(/Upload image for/).setInputFiles({ name: "choice-shared-tick.png", mimeType: "image/png", buffer: bytes });
  await expect(drag.locator(".native-drag-drop-item-image-controls img")).toBeVisible();
  await drag.getByRole("tab", { name: "Layout", exact: true }).click();
  await expect(drag.getByRole("button", { name: "Add panel", exact: true })).toBeDisabled();
  await expect(drag.getByLabel("Add Background", { exact: true })).toBeDisabled();
  await drag.getByRole("button", { name: "Draw Drop Target", exact: true }).click();
  const stage = drag.locator("[data-studio-stage]"); await stage.scrollIntoViewIfNeeded(); const rect = await stage.boundingBox(); assert.ok(rect);
  await page.mouse.move(rect.x + rect.width * .10, rect.y + rect.height * .12); await page.mouse.down(); await page.mouse.move(rect.x + rect.width * .23, rect.y + rect.height * .20, { steps: 4 }); await page.mouse.up();
  await drag.getByRole("tab", { name: "Answer Key", exact: true }).click();
  await drag.locator(".native-drag-drop-mapping select").selectOption({ index: 1 });
  await editor.getByLabel("Section type", { exact: true }).selectOption("single-choice");
  await editor.getByRole("button", { name: "Add Section", exact: true }).click();
  await editor.getByLabel("Section title", { exact: true }).fill("Shared choice");
  const choice = editor.locator(".native-single-choice-editor:visible");
  await choice.getByRole("button", { name: "Add Question", exact: true }).click();
  await choice.getByLabel("Prompt", { exact: true }).fill("Choose on the shared image");
  await choice.getByLabel("Option 1", { exact: true }).fill("Yes"); await choice.getByLabel("Option 2", { exact: true }).fill("No");
  await choice.getByRole("tab", { name: "Answer Key", exact: true }).click(); await choice.getByRole("checkbox", { name: "Option 1: Yes", exact: true }).check();
  await choice.getByRole("tab", { name: "Visual", exact: true }).click();
  await expect(choice.locator('input[type="file"][accept*="image/png"]')).toBeDisabled();
  for (const x of [360, 540]) {
    await choice.getByRole("button", { name: "New hotspot", exact: true }).click();
    for (const [label, value] of [["X", x], ["Y", 100], ["Width", 120], ["Height", 60]]) await choice.getByLabel(label, { exact: true }).fill(String(value));
  }
}

export async function reviewHostedComposition(page, activityId) {
  await page.locator('.hosted-builder-tool-tabs a[href$="/hotspots"]').click();
  await page.locator(".editable-hotspot-box").first().click();
  await page.getByLabel("Activity").selectOption(activityId);
  await page.getByLabel("Label", { exact: true }).fill("Composition launch");
  await page.locator(".builder-save-state").getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".builder-save-state").getByText("Saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const viewer = page.frameLocator(".unified-builder-review-dialog iframe");
  await expect(viewer.locator(".teacher-offline-page-stage")).toBeVisible({ timeout: 30000 });
  await viewer.getByRole("button", { name: "Composition launch", exact: true }).click({ force: true });
  await expect(viewer.locator(".native-multi-part")).toBeVisible();
  await viewer.getByRole("button", { name: "Next activity part", exact: true }).click();
  const canvas = viewer.locator(".native-multi-part-panel--canvas:visible"); await expect(canvas).toBeVisible();
  await expect(canvas.locator(".native-multi-part-background")).toHaveCount(1);
  await expect(canvas.locator("[data-section-kind=drag-drop]")).toBeVisible();
  await expect(canvas.locator("[data-section-kind=single-choice]")).toBeVisible();
  const geometry = await canvas.evaluate((element) => { const box = element.getBoundingClientRect(); const host = element.closest(".teacher-offline-embedded-activity").getBoundingClientRect(); return { width: box.width, height: box.height, hostWidth: host.width, hostHeight: host.height }; });
  assert.ok(geometry.width <= geometry.hostWidth + 2 && geometry.height <= geometry.hostHeight + 2, JSON.stringify(geometry));
  await page.getByRole("button", { name: "Close Review", exact: true }).click();
  await page.locator('.hosted-builder-tool-tabs a[href$="/activities"]').click();
}
