import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "../../tests/_vite-test-server.mjs";
import react from "@vitejs/plugin-react";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { localProviders } from "./native-presentation-regressions.mjs";
import { historicalCombinedIdentity, historicalCombinedRelease } from "../../tests/fixtures/historical-combined.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";

function syntheticAudio() {
  const rate = 8000, samples = rate * 2, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI / 20) * 1000), 44 + i * 2);
  return bytes;
}

// Executed by test:lms-native-drag-drop-layout through native-runtime-regressions.
// Actual normalizers, embedded fitter, surfaces and authoring editor; synthetic I/O.
export async function runHistoricalFocusRegressions(browser, output) {
  const server = await createServer({ configFile: false, plugins: [localProviders(), react()], define: { __HHPLMS_BUILD_PROFILE__: JSON.stringify("ultimate-b2-interactive-review") }, optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/presentation.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [], evidence = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const release = historicalCombinedRelease(), id = historicalCombinedIdentity.activityId;
  const identity = { activityId: id, kind: "single-choice" };
  const golden = { publicDocument: release.public_projection.nativeActivities[id].document, teacherDocument: release.teacher_projection.nativeActivities[id].document };
  const original = JSON.stringify(golden);
  const png = await sharp({ create: { width: 1000, height: 1800, channels: 3, background: "#e5e8dd" } }).png().toBuffer();
  const audio = syntheticAudio();
  const audioId = golden.publicDocument.assets.find((asset) => asset.slot === "choice-audio").assetId;
  let stored = structuredClone(golden), revision = 1, saves = 0;
  await page.route("**/native-fixture-assets/*", (route) => route.fulfill({ contentType: route.request().url().endsWith(audioId) ? "audio/wav" : "image/png", body: route.request().url().endsWith(audioId) ? audio : png }));
  await page.route("**/builder/api/**", (route) => {
    const url = route.request().url();
    if (url.endsWith("/fonts")) return route.fulfill({ json: { fonts: [] } });
    if (url.endsWith("/save")) {
      const input = route.request().postDataJSON();
      assert.equal(input.expectedPublicRevision, revision); assert.equal(input.expectedTeacherRevision, revision);
      const publicDocument = normalizeNativeRuntimePublicDocument(input.publicDocument, identity);
      stored = { publicDocument, teacherDocument: normalizeNativeRuntimeTeacherDocument(input.teacherDocument, { ...identity, publicDocument }) };
      revision += 1; saves += 1;
      return route.fulfill({ json: { ...stored, publicRevision: revision, teacherRevision: revision } });
    }
    return route.fulfill({ json: { document: url.includes("native-activity-teacher") ? stored.teacherDocument : stored.publicDocument, revision } });
  });
  const open = async (pair, mode, scale) => {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/presentation.html`);
    await page.waitForFunction(() => Boolean(globalThis.nativePresentationFixture?.setMode));
    await page.evaluate(({ pair, mode, scale }) => { Object.assign(nativePresentationFixture.choice, pair); delete nativePresentationFixture.choiceState; nativePresentationFixture.setScale(scale); nativePresentationFixture.setMode(mode); nativePresentationFixture.commits = []; }, { pair, mode, scale });
  };
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 640, height: 900 }]) {
      await page.setViewportSize(viewport);
      for (const variant of [{ name: "historical-fixed", height: 284.18, expected: "fixed-aspect" }, { name: "historical-natural-reading", height: 800, noAudio: true, expected: "natural-width" }, { name: "explicit-natural", height: 284.18, mode: "natural-width", expected: "natural-width" }, { name: "explicit-fixed", height: 800, mode: "fixed-aspect", expected: "fixed-aspect" }]) {
        const pair = structuredClone(golden);
        const hotspot = pair.publicDocument.audioTextHotspots.hotspots[0];
        hotspot.readableFocusArea.height = variant.height;
        if (variant.mode) hotspot.focusLayout = variant.mode;
        if (variant.noAudio) hotspot.audioAssetSlot = "";
        pair.publicDocument = normalizeNativeRuntimePublicDocument(pair.publicDocument, identity);
        const before = JSON.stringify(pair);
        await open(pair, "choice", viewport.width < 800 ? .55 : 1);
        const button = page.getByRole("button", { name: hotspot.label, exact: true });
        for (let iteration = 0; iteration < 3; iteration += 1) {
          await (viewport.width < 800 ? button.tap() : button.click());
          await expect(page.locator(".native-audio-text-focus")).toHaveAttribute("data-focus-layout", variant.expected);
          if (variant.noAudio) await expect(page.locator(".native-audio-text-focus audio")).toHaveCount(0);
          else await expect.poll(() => page.locator(".native-audio-text-focus audio").evaluate((node) => { globalThis.historicalFocusAudio = node; return !node.paused && node.currentTime > 0; })).toBe(true);
          assert.equal(await page.locator(".native-audio-text-focus-scroll").count(), variant.expected === "natural-width" ? 1 : 0);
          await page.keyboard.press("Escape");
          await expect(page.locator(".native-audio-text-focus")).toHaveCount(0);
          if (!variant.noAudio) assert.equal(await page.evaluate(() => historicalFocusAudio.paused), true);
        }
        const metrics = await page.evaluate(() => ({ commits: nativePresentationFixture.commits.length, pair: JSON.stringify(nativePresentationFixture.choice), focusVisible: Boolean(document.querySelector(".native-audio-text-focus")) }));
        assert.equal(metrics.pair, before); assert.ok(metrics.commits < 90, JSON.stringify(metrics)); assert.equal(metrics.focusVisible, false);
        evidence.push({ viewport, variant: variant.name, commits: metrics.commits });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(stored, "choice-editor", 1);
    await page.getByRole("tab", { name: "Readable Text", exact: true }).click();
    const checkbox = page.getByRole("checkbox", { name: "Keep aspect ratio" });
    await expect(checkbox).toBeChecked();
    for (const mode of ["natural-width", "fixed-aspect"]) {
      await checkbox.setChecked(mode === "fixed-aspect");
      await page.getByRole("button", { name: "Save Draft", exact: true }).click();
      await expect.poll(() => stored.publicDocument.audioTextHotspots.hotspots[0].focusLayout).toBe(mode);
      await open(stored, "choice-editor", 1);
      await page.getByRole("tab", { name: "Readable Text", exact: true }).click();
      await expect(checkbox).toBeChecked({ checked: mode === "fixed-aspect" });
    }
    await page.getByRole("button", { name: "Add readable-text hotspot", exact: true }).click();
    await page.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect.poll(() => stored.publicDocument.audioTextHotspots.hotspots.length).toBe(3);
    assert.equal(stored.publicDocument.audioTextHotspots.hotspots[2].focusLayout, "natural-width");
    assert.equal(stored.publicDocument.audioTextHotspots.hotspots[2].audioAssetSlot, "");
    assert.equal(saves, 3); assert.deepEqual(stored.teacherDocument, golden.teacherDocument);
    assert.equal(JSON.stringify(golden), original); assert.deepEqual(errors, []);
    console.log("Historical focus layout desktop/touch, immutable input, audio cleanup and explicit authoring save/reload passed.");
  } finally {
    await writeFile(`${output}/historical-focus-measurements.json`, JSON.stringify({ evidence, saves, errors }, null, 2));
    await context.close(); await server.close();
  }
}
