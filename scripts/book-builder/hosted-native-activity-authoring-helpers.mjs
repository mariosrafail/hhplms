import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function waitForHostedViewerFrame(iframe) {
  await iframe.waitFor();
  await expect(iframe).toHaveAttribute("src", /^https:\/\/hhplms-viewer\.netlify\.app\//);
}

export async function assertAhemRendering(locator, label) {
  await locator.waitFor();
  const evidence = await locator.evaluate(async (element) => {
    const family = getComputedStyle(element).fontFamily;
    const alias = family.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    await document.fonts.ready;
    const requested = await document.fonts.load(`32px "${alias}"`, "iiiiiiiiii");
    const matchingFaces = [...document.fonts]
      .filter((candidate) => candidate.family.replace(/^['"]|['"]$/g, "") === alias)
      .map((candidate) => ({ family: candidate.family, status: candidate.status, style: candidate.style, weight: candidate.weight }));
    const canvas = document.createElement("canvas"); const context = canvas.getContext("2d");
    context.font = `32px "${alias}"`; const managedWidth = context.measureText("iiiiiiiiii").width;
    context.font = "32px Arial"; const fallbackWidth = context.measureText("iiiiiiiiii").width;
    return { family, alias, documentFontStatus: document.fonts.status, matchingFaceCount: matchingFaces.length, matchingFaces, requestedFaces: requested.length, checked: document.fonts.check(`32px "${alias}"`, "iiiiiiiiii"), managedWidth, fallbackWidth };
  });
  assert.match(evidence.alias, /^hh-native-font-/i, `${label}: ${JSON.stringify(evidence)}`);
  assert.ok(evidence.matchingFaceCount > 0 && evidence.matchingFaces.every((face) => face.status === "loaded"), `${label}: ${JSON.stringify(evidence)}`);
  assert.ok(evidence.requestedFaces > 0 && evidence.checked, `${label}: ${JSON.stringify(evidence)}`);
  assert.ok(evidence.managedWidth > evidence.fallbackWidth * 2, `${label}: Ahem metrics must differ from Arial fallback: ${JSON.stringify(evidence)}`);
  return evidence;
}

export async function logicalFontSize(locator) {
  return locator.evaluate((element) => {
    const surface = element.closest(".native-or-surface");
    return Number.parseFloat(getComputedStyle(element).fontSize) * Number(surface.dataset.surfaceWidth) / surface.getBoundingClientRect().width;
  });
}

export async function verifyReadableTextStartsOffAndBlocksIncompleteSave(page) {
  const previousTab = await page.getByRole("tab", { selected: true }).textContent();
  await page.getByRole("tab", { name: "Readable Text", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Readable Text" });
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  await toggle.click();
  await page.getByText("Upload a readable-text image.", { exact: true }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Save Draft" }).isDisabled(), true);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  await page.getByRole("tab", { name: previousTab.trim(), exact: true }).click();
}

export async function uploadReadableText(page, buffer, name, altText) {
  await page.getByRole("tab", { name: "Readable Text", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Readable Text" });
  if (await toggle.getAttribute("aria-checked") === "false") await toggle.click();
  await page.locator(".native-readable-text-editor input[type=file]").setInputFiles({ name, mimeType: "image/png", buffer });
  await page.locator(".native-readable-text-editor img").waitFor();
  await page.getByText(/^1000 . 1800px$/).waitFor();
  await page.getByLabel("Accessibility label").fill(altText);
}

export function createVideoCompanionUploader(videoMp4, videoSrt) {
  return async function uploadVideoCompanion(page) {
    await page.getByRole("tab", { name: "Video", exact: true }).click();
    const toggle = page.getByRole("switch", { name: "Video" });
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
    await toggle.click();
    await page.getByText("Video companion incomplete", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Save Draft" }).isDisabled(), true);
    await page.locator('.native-video-editor input[type="file"][accept*="video/mp4"]').setInputFiles({ name: "classroom-companion.mp4", mimeType: "video/mp4", buffer: videoMp4 });
    await page.getByText(/classroom-companion\.mp4/).waitFor();
    await page.locator('.native-video-editor input[type="file"][accept*=".srt"]').setInputFiles({ name: "classroom-companion.srt", mimeType: "application/x-subrip", buffer: Buffer.from(videoSrt) });
    await page.getByText("Video companion complete", { exact: true }).waitFor();
    await page.getByText("2 validated subtitle cues", { exact: true }).waitFor();
  };
}
