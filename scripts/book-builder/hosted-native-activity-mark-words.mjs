import { exerciseVisualTargetAuthoring } from "./hosted-visual-target-authoring.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { assertAhemRendering } from "./hosted-native-activity-authoring-helpers.mjs";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";

export async function exerciseMarkWordsAuthoring(page, { screenshotRoot, savedPair = null, title = "Browser Mark the Words", visual = true }) {
  return exerciseVisualTargetAuthoring(page, { screenshotRoot, savedPair, title });
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
