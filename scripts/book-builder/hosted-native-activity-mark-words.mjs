import { exerciseVisualTargetAuthoring } from "./hosted-visual-target-authoring.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { assertAhemRendering } from "./hosted-native-activity-authoring-helpers.mjs";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";

export async function exerciseMarkWordsAuthoring(page, { screenshotRoot, savedPair = null, title = "Browser Mark the Words", visual = true }) {
  if (visual) await exerciseVisualTargetAuthoring(page, { screenshotRoot, savedPair, title });
  await page.getByRole("button", { name: "Add Activity", exact: true }).click();
  await page.getByRole("radio", { name: /Mark the Words/ }).check(); await page.getByLabel(/Initial title/).fill(title);
  await page.getByRole("button", { name: "Create activity", exact: true }).click();
  const editor = page.locator(".native-mark-words-editor"); await editor.waitFor();
  await expect(editor.getByRole("button", { name: "Save Draft", exact: true })).toBeDisabled();
  await editor.getByRole("tab", { name: "Content", exact: true }).click();
  await editor.getByText("Bulk generate from text", { exact: true }).click();
  await editor.getByLabel("Paste numbered Mark the Words content").fill("1. I *watch* watch.\n2. They *work* now.");
  await editor.getByRole("button", { name: "Generate content", exact: true }).click();
  await editor.getByRole("tab", { name: "Answer Key", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Passage 1, word 2: watch", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editor.getByRole("button", { name: "Passage 1, word 3: watch", exact: true })).toHaveAttribute("aria-pressed", "false");
  await editor.getByRole("tab", { name: "Local Preview", exact: true }).click();
  const word = editor.getByRole("button", { name: "Passage 1, word 2: watch", exact: true });
  const repeated = editor.getByRole("button", { name: "Passage 1, word 3: watch", exact: true });
  await expect(word).toHaveAttribute("aria-pressed", "false");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }]) {
    await page.setViewportSize(viewport); await word.scrollIntoViewIfNeeded(); const before = await word.boundingBox();
    await word.click(); await expect(word).toHaveAttribute("aria-pressed", "true"); await expect(repeated).toHaveAttribute("aria-pressed", "false");
    const after = await word.boundingBox(); for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(before[key] - after[key]) < .1, `Selection changed ${key}`);
    await word.press("Space"); await expect(word).toHaveAttribute("aria-pressed", "false");
    await page.screenshot({ path: path.join(screenshotRoot, `mark-words-text-${viewport.width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  if (visual) {
    await exerciseCommonMedia(editor);
    await editor.getByRole("tab", { name: "Visual", exact: true }).click();
    await editor.locator('input[accept*="font/ttf"]').setInputFiles({ name: "Ahem.ttf", mimeType: "font/ttf", buffer: Buffer.from((await readFile("tests/fixtures/fonts/Ahem.ttf.base64", "utf8")).trim(), "base64") });
    await expect(editor.getByLabel("Passage font")).not.toHaveValue("");
    await editor.getByRole("tab", { name: "Local Preview", exact: true }).click();
    await assertAhemRendering(word, "Mark the Words managed passage font");
    await editor.getByRole("tab", { name: "Visual", exact: true }).click();
    await editor.getByLabel("Passage font").selectOption("");
    await editor.getByLabel("Presentation", { exact: true }).selectOption("image-hotspot");
    for (const [panelIndex, words] of [["I", "watch", "watch."], ["They", "work", "now."]].entries()) {
      await editor.getByRole("button", { name: "Add panel", exact: true }).click();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="white"/>${words.map((text, index) => `<text x="${20 + index * 170}" y="70" font-size="28" font-family="Arial">${text}</text>`).join("")}</svg>`;
      await editor.getByLabel("Upload background", { exact: true }).setInputFiles({ name: `words-panel-${panelIndex}.png`, mimeType: "image/png", buffer: await sharp(Buffer.from(svg)).png().toBuffer() });
      await editor.locator(".native-mark-words-canvas > img").waitFor();
      await editor.getByRole("button", { name: "Draw next word hotspot", exact: true }).click();
      const canvas = editor.locator(".native-mark-words-canvas"); await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox(); assert.ok(box);
      for (let index = 0; index < words.length; index += 1) {
        await page.mouse.move(box.x + (15 + index * 170) / 600 * box.width, box.y + 35 / 200 * box.height); await page.mouse.down();
        await page.mouse.move(box.x + (140 + index * 170) / 600 * box.width, box.y + 82 / 200 * box.height); await page.mouse.up();
        await expect(canvas.locator(".native-mark-words-authoring-hit")).toHaveCount(index + 1);
      }
      // Drawing stays active so successive hotspots follow authored unmapped order.
      await editor.getByRole("tab", { name: "Content", exact: true }).click();
      await editor.getByRole("tab", { name: "Visual", exact: true }).click();
    }
    await editor.getByRole("button", { name: "Panel 1", exact: true }).click();
    await editor.getByRole("button", { name: "Word hotspot 2", exact: true }).click();
    const clickFrame = editor.getByRole("group", { name: "Click area selected", exact: true });
    const clickLeft = Number(await editor.getByLabel("Quick X", { exact: true }).inputValue());
    await clickFrame.press("ArrowRight"); await expect(editor.getByLabel("Quick X", { exact: true })).toHaveValue(String(clickLeft + 1));
    await clickFrame.press("ArrowLeft");
    await editor.getByLabel("Geometry to edit").selectOption("markArea");
    await editor.getByLabel("Quick Width", { exact: true }).fill("80");
    await editor.getByLabel("Quick Height", { exact: true }).fill("40");
    await editor.getByRole("tab", { name: "Local Preview", exact: true }).click();
    await word.click(); await expect(word).toHaveAttribute("aria-pressed", "true");
    const mark = editor.locator(".native-mark-words-mark[data-selected]");
    const clickBox = await word.boundingBox(); const markBox = await mark.boundingBox(); assert.ok(markBox.width < clickBox.width && markBox.y + markBox.height < clickBox.y + clickBox.height);
    await editor.getByRole("button", { name: "Next", exact: true }).click(); await editor.getByRole("button", { name: "Previous", exact: true }).click(); await expect(word).toHaveAttribute("aria-pressed", "true");
    await editor.getByRole("button", { name: "Read Text", exact: true }).click(); await editor.getByRole("button", { name: "Questions", exact: true }).click(); await expect(word).toHaveAttribute("aria-pressed", "true");
    await editor.getByRole("button", { name: "Video", exact: true }).click(); await editor.getByRole("button", { name: "Questions", exact: true }).click(); await expect(word).toHaveAttribute("aria-pressed", "true");
    for (const width of [1440, 768]) { await page.setViewportSize({ width, height: 900 }); const stage = await editor.locator(".native-mark-words-stage").boundingBox(); assert.ok(stage && Math.abs(stage.width / stage.height - 3) < .02); await page.screenshot({ path: path.join(screenshotRoot, `mark-words-image-${width}.png`), fullPage: true }); }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await editor.getByRole("button", { name: "Save Draft", exact: true }).click(); await editor.getByText("Draft saved.", { exact: true }).waitFor();
  if (savedPair) {
    const pair = savedPair(title); assert.ok(pair);
    normalizeNativeRuntimePublicDocument(pair.publicDocument, { activityId: pair.publicDocument.activityId, kind: "mark-the-words" });
    normalizeNativeRuntimeTeacherDocument(pair.teacherDocument, { activityId: pair.publicDocument.activityId, kind: "mark-the-words", publicDocument: pair.publicDocument });
    assert.doesNotMatch(JSON.stringify(pair.publicDocument), /correctWordIds|\*/);
    return pair.publicDocument.activityId;
  }
  return null;
}

export async function exerciseMarkWordsHostedViewer(page, { activityId, screenshotRoot }) {
  await page.locator('.hosted-builder-tool-tabs a[href$="/hotspots"]').click();
  await page.locator(".editable-hotspot-box").first().click();
  await page.getByLabel("Activity").selectOption(activityId); await page.getByLabel("Label", { exact: true }).fill("Mark Words launch");
  await page.locator(".builder-save-state").getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".builder-save-state").getByText("Saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const viewer = page.frameLocator(".unified-builder-review-dialog iframe");
  const open = async () => { await viewer.getByRole("button", { name: "Mark Words launch", exact: true }).click({ force: true }); await viewer.locator(".native-mark-words").waitFor(); };
  await open();
  const selected = viewer.locator('.native-mark-words-hit[aria-pressed="true"]'); await expect(selected).toHaveCount(0);
  await viewer.getByRole("button", { name: "Show Next", exact: true }).click(); await expect(selected).toHaveCount(1);
  await viewer.getByRole("button", { name: "Show Next", exact: true }).click(); await expect(viewer.locator('.native-mark-words-stage[aria-label="Panel 2"]')).toBeVisible();
  await expect(selected).toHaveCount(1);
  await viewer.getByRole("button", { name: "Previous activity part", exact: true }).click(); await expect(selected).toHaveCount(1);
  await viewer.getByRole("button", { name: "Reload", exact: true }).click(); await expect(selected).toHaveCount(0);
  await viewer.getByRole("button", { name: "Show All", exact: true }).click(); await expect(selected).toHaveCount(1);
  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await viewer.locator(".native-mark-words-stage").evaluate((stage) => {
      const rect = stage.getBoundingClientRect(); const host = stage.closest(".teacher-offline-embedded-activity").getBoundingClientRect();
      return { width: rect.width, height: rect.height, inside: rect.left >= host.left - 1 && rect.right <= host.right + 1 && rect.top >= host.top - 1 && rect.bottom <= host.bottom + 1 };
    });
    assert.ok(geometry.width > 100 && Math.abs(geometry.width / geometry.height - 3) < .02 && geometry.inside, JSON.stringify(geometry));
    await page.screenshot({ path: path.join(screenshotRoot, `mark-words-viewer-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await viewer.getByRole("button", { name: "Reload", exact: true }).click(); await expect(selected).toHaveCount(0);
  const privateRoute = `**/activities/${activityId}/teacher?**`;
  await page.context().route(privateRoute, (route) => route.fulfill({ status: 403, json: { error: "teacher_forbidden" } }));
  try {
    await page.getByRole("button", { name: "Refresh Viewer", exact: true }).click();
    await viewer.getByRole("button", { name: "Mark Words launch", exact: true }).click({ force: true });
    await viewer.getByText("Teacher answers are unavailable.", { exact: true }).waitFor();
    await expect(viewer.locator(".native-mark-words")).toHaveCount(0);
  } finally { await page.context().unroute(privateRoute); }
  await page.getByRole("button", { name: "Close Review", exact: true }).click();
  process.stdout.write("Mark the Words hosted authoring, media, image geometry, Teacher reveal/reset and authorization denial passed.\n");
}

async function exerciseCommonMedia(editor) {
  const save = editor.getByRole("button", { name: "Save Draft", exact: true });
  await editor.getByRole("tab", { name: "Readable Text", exact: true }).click();
  await editor.getByRole("switch", { name: "Readable Text", exact: true }).click();
  await expect(save).toBeDisabled();
  await editor.getByRole("tab", { name: "Content", exact: true }).click(); await expect(save).toBeDisabled();
  await editor.getByRole("tab", { name: "Readable Text", exact: true }).click();
  const buffer = await sharp({ create: { width: 600, height: 900, channels: 3, background: "white" } }).png().toBuffer();
  await editor.locator('.native-readable-text-editor input[type="file"]').setInputFiles({ name: "words-reference.png", mimeType: "image/png", buffer });
  await expect(save).toBeEnabled();
  await editor.getByRole("tab", { name: "Supplemental MP3", exact: true }).click();
  await editor.getByRole("switch", { name: "Supplemental MP3", exact: true }).click(); await expect(save).toBeDisabled();
  await editor.locator('.native-supplemental-audio-editor input[accept*="audio/mpeg"]').setInputFiles({ name: "supplemental.mp3", mimeType: "audio/mpeg", buffer: await readFile("src/assets/books/ultimate-b2/teacher-offline-media/unit-1-television-dialogue.mp3") });
  await expect(save).toBeEnabled();
  await editor.getByRole("tab", { name: "Video", exact: true }).click();
  await editor.getByRole("switch", { name: "Video", exact: true }).click(); await expect(save).toBeDisabled();
  await editor.locator('.native-video-editor input[accept*="video/mp4"]').setInputFiles({ name: "companion.mp4", mimeType: "video/mp4", buffer: await readFile("src/assets/books/ultimate-b2/teacher-offline-media/ultimate-b2-startup-intro.mp4") });
  await expect(editor.locator('.native-video-editor input[accept*=".srt"]')).toBeEnabled();
  await editor.locator('.native-video-editor input[accept*=".srt"]').setInputFiles({ name: "companion.srt", mimeType: "application/x-subrip", buffer: Buffer.from("1\n00:00:00,000 --> 00:00:02,000\nPractice companion.") });
  await expect(save).toBeEnabled();
}
