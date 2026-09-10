import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "../../tests/_vite-test-server.mjs";
import react from "@vitejs/plugin-react";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { childId, presentationPair } from "../../tests/fixtures/native-runtime-regressions/presentation-documents.js";

// Only the data providers and unused legacy branches are substituted. The embedded
// fitter, hosted native runner, Teacher surface and shared presentation are real.
export function localProviders() {
  const modules = {
    "virtual:ultimate-b2-multiple-choice-presentation": "export default null;",
    "virtual:ultimate-b2-hosted-open-response-drafts": "export const useHostedOpenResponseDraft = () => null; export const useHostedOpenResponseImport = () => ({});",
    "virtual:component-publication": "export const usePublishedComponentRelease = () => ({kind:'unavailable'});",
    "virtual:hosted-native-drafts": "export const hostedNativeDraftTeacherAssetUrl = () => { throw Error('Unexpected protected answer request'); }; export const hostedNativeDraftAssetUrl = (_, id) => globalThis.nativePresentationFixture.assetUrl(id); export const useHostedNativeDraftActivity = () => { const fixture = globalThis.nativePresentationFixture; return fixture.choiceState ||= {kind:'ready',entry:{kind:'single-choice',document:fixture.choice.publicDocument},teacher:{kind:'ready',entry:{document:fixture.choice.teacherDocument}}}; };",
  };
  return { name: "isolated-native-presentation-providers", enforce: "pre",
    resolveId(id) {
      if (modules[id]) return `\0fixture:${id}`;
      if (id.endsWith("/NormalizedStudentsBookActivity.jsx")) return "\0fixture:legacy";
      if (id.endsWith("/PublishedNativeTeacherActivityRunner.jsx")) return "\0fixture:published";
      if (id.endsWith("/studentsBookCatalog.js")) return "\0fixture:catalog";
      if (id.endsWith("/TeacherOfflineActivityVideoOverlay.jsx")) return "\0fixture:video";
      return null;
    },
    load(id) {
      if (!id.startsWith("\0fixture:")) return null;
      const key = id.slice(9);
      if (modules[key]) return modules[key];
      if (key === "catalog") return "export const findStudentsBookImplementation = () => null;";
      if (key === "legacy") return "export const NormalizedStudentsBookActivity = () => {throw Error('Unexpected legacy branch')};";
      if (key === "published") return "export const PublishedNativeTeacherActivityRunner = () => {throw Error('Unexpected published branch')};";
      return "export default function UnusedVideo(){return null;}";
    },
  };
}

export async function runNativePresentationRegressions(browser, output) {
  const server = await createServer({ configFile: false, plugins: [localProviders(), react()], define: { __HHPLMS_BUILD_PROFILE__: JSON.stringify("ultimate-b2-interactive-review") }, optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/presentation.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; const measurements = [];
  await page.addInitScript(() => {
    const metrics = globalThis.presentationDiagnostics = { resizeCallbacks: 0, longTasks: [], media: [], clicks: [] };
    const Observer = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class extends Observer { constructor(callback) { super((...args) => { metrics.resizeCallbacks++; callback(...args); }); } };
    new PerformanceObserver((list) => metrics.longTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: "longtask", buffered: true });
    for (const event of ["loadstart", "loadeddata", "canplay", "playing", "pause", "emptied"]) document.addEventListener(event, (value) => { if (value.target.closest?.(".native-audio-text-focus")) metrics.media.push({ event, at: performance.now(), readyState: value.target.readyState }); }, true);
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".native-audio-text-hotspot")) return;
      const entry = { click: performance.now(), resizeStart: metrics.resizeCallbacks };
      metrics.clicks.push(entry);
      requestAnimationFrame(() => requestAnimationFrame(() => { entry.paintedAt = performance.now(); entry.highlightVisible = Boolean(document.querySelector(".native-audio-text-focus-highlight")); }));
    }, true);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="8192"><rect width="4096" height="8192" fill="#e4e8df"/>${Array.from({ length: 80 }, (_, index) => `<text x="100" y="${100 + index * 100}" font-size="48">Local passage line ${index + 1}: repeated highlight and scroll regression.</text>`).join("")}</svg>`)).png().toBuffer();
  const artwork = await sharp({ create: { width: 1024, height: 2400, channels: 3, background: "#e4e8df" } }).png().toBuffer();
  const choiceArtwork = await sharp({ create: { width: 1024, height: 582, channels: 3, background: "#e4e8df" } }).png().toBuffer();
  const audio = await readFile("src/assets/books/ultimate-b2/teacher-offline-media/unit-1-television-dialogue.mp3");
  const font = Buffer.from((await readFile("tests/fixtures/fonts/Ahem.ttf.base64", "utf8")).trim(), "base64");
  let stored = presentationPair(); let revisions = { publicRevision: 1, teacherRevision: 1 }; let saves = 0;
  await page.route("**/native-fixture-assets/*", (route) => {
    const id = route.request().url().slice(-12);
    return route.fulfill({ contentType: id === "000000000004" ? "font/ttf" : id === "000000000003" ? "audio/mpeg" : "image/png", body: id === "000000000004" ? font : id === "000000000003" ? audio : id === "000000000001" ? artwork : id === "000000000011" ? choiceArtwork : image });
  });
  await page.route("**/builder/api/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/fonts")) return route.fulfill({ json: { fonts: [] } });
    if (url.endsWith("/save")) {
      const input = route.request().postDataJSON();
      assert.equal(input.expectedPublicRevision, revisions.publicRevision); assert.equal(input.expectedTeacherRevision, revisions.teacherRevision);
      assert.match(input.clientMutationId, /^[0-9a-f-]{36}$/);
      stored = { publicDocument: input.publicDocument, teacherDocument: input.teacherDocument }; saves++;
      revisions = { publicRevision: revisions.publicRevision + 1, teacherRevision: revisions.teacherRevision + 1 };
      return route.fulfill({ json: { ...stored, ...revisions } });
    }
    const teacher = url.includes("native-activity-teacher");
    return route.fulfill({ json: { document: teacher ? stored.teacherDocument : stored.publicDocument, revision: teacher ? revisions.teacherRevision : revisions.publicRevision } });
  });
  try {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/presentation.html`);
    await page.locator(".native-drag-drop-phrase").first().waitFor();
    const word = (number) => page.locator(`[data-drag-drop-word-id="${childId("word", number)}"]`);
    const target = (number) => page.locator(`[data-drag-drop-target-id="${childId("target", number)}"]`);
    const geometry = () => page.locator(".native-drag-drop").evaluate((root) => {
      const rect = (selector) => { const r = root.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { bank: root.querySelector(".native-drag-drop-bank").offsetHeight, stage: rect(".native-drag-drop-stage"), target: rect(".native-drag-drop-target"), artwork: rect(".native-drag-drop-artwork"), rows: getComputedStyle(root.querySelector(".native-drag-drop-visual-region")).gridTemplateRows };
    });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 800, height: 600 }, { width: 640, height: 900 }]) {
      await page.setViewportSize(viewport);
      for (const scale of [.5, .65, .9, 1].filter((value) => 1024 * value + 16 <= viewport.width)) {
        await page.evaluate((value) => { nativePresentationFixture.setScale(value); nativePresentationFixture.reset(); }, scale);
        await expect.poll(async () => (await page.locator("[data-fixture-stage]").boundingBox()).width).toBeCloseTo(1024 * scale, 1);
        await expect(word(2)).toBeVisible();
        await expect.poll(async () => (await geometry()).bank).toBe(180);
        const initial = await geometry();
        assert.equal(await word(1).locator("span").last().textContent(), "A. An authored answer");
        assert.equal(await word(1).locator(".native-drag-drop-short-label").count(), 1);
        await word(1).click(); await target(1).click({ position: { x: 4, y: 4 } }); await target(2).click({ position: { x: 4, y: 4 } });
        await expect(target(1).locator("[data-drag-drop-target-text]")).toHaveCount(1);
        await expect(target(2).locator("[data-drag-drop-target-text]")).toHaveCount(1);
        await expect(word(1)).toBeVisible();
        await word(2).click(); await target(1).click({ position: { x: 4, y: 4 } }); await expect(word(2)).toHaveCount(0);
        await expect.poll(async () => (await geometry()).bank).toBeLessThan(180);
        const partial = await geometry();
        await expect.poll(() => page.locator(".native-drag-drop-bank").evaluate((bank) => {
          const audio = bank.closest("[data-native-media-scope]").querySelector(".native-supplemental-audio-anchor").getBoundingClientRect();
          return [...bank.querySelectorAll(".native-drag-drop-word")].filter((word) => {
            const r = word.getBoundingClientRect();
            return r.left < audio.right && r.right > audio.left && r.top < audio.bottom && r.bottom > audio.top;
          }).map((word) => word.dataset.dragDropWordId);
        })).toEqual([]);
        if (scale === 1) await page.screenshot({ path: `${output}/text-bank-partial.png` });
        assert.deepEqual(partial.stage, initial.stage); assert.deepEqual(partial.target, initial.target); assert.deepEqual(partial.artwork, initial.artwork);
        assert.notEqual(partial.rows, initial.rows);
        await target(1).getByRole("button", { name: /Remove A,/ }).click();
        await expect(target(2).locator("[data-drag-drop-target-text]")).toHaveText("A");
        await target(1).getByRole("button", { name: /Remove B,/ }).click();
        await expect.poll(async () => (await geometry()).bank).toBe(180);
        const status = await page.locator(".native-drag-drop-status").evaluate((node) => { const css = getComputedStyle(node); return { position: css.position, width: node.offsetWidth, height: node.offsetHeight, clip: css.clipPath, live: node.getAttribute("aria-live"), hidden: node.getAttribute("aria-hidden") }; });
        assert.deepEqual(status, { position: "absolute", width: 1, height: 1, clip: "inset(50%)", live: "polite", hidden: null });
        const scrollbar = page.getByRole("scrollbar", { name: "Text Drag & Drop vertical scroll" });
        await scrollbar.focus(); await page.keyboard.press("End");
        const pane = page.locator(".native-drag-drop-workspace");
        await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
        await page.keyboard.press("Home"); await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBe(0);
        const controlBox = await scrollbar.boundingBox(); const stageBox = await page.locator("[data-fixture-stage]").boundingBox();
        assert.ok(controlBox.x > stageBox.x + stageBox.width - 36 * scale && controlBox.y > stageBox.y + stageBox.height - 120 * scale);
        assert.ok(controlBox.x + controlBox.width < stageBox.x + stageBox.width && controlBox.y + controlBox.height < stageBox.y + stageBox.height);
        const hit = await scrollbar.evaluate((node) => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }); assert.ok(hit);
        const thumb = await scrollbar.locator("span").boundingBox();
        await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2); await page.mouse.down();
        await page.mouse.move(thumb.x + thumb.width / 2, controlBox.y + controlBox.height, { steps: 4 }); await page.mouse.up();
        await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
        await scrollbar.focus(); await page.keyboard.press("Home");
        await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBe(0);
        await pane.hover();
        await page.mouse.wheel(0, 400);
        await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
        await scrollbar.focus(); await page.keyboard.press("Home");
        measurements.push({ kind: "bank-scroll", viewport, scale, initial, partial, status });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { nativePresentationFixture.setScale(1); nativePresentationFixture.setMode("teacher"); });
    await target(1).click({ position: { x: 4, y: 4 } });
    await expect(target(1).locator("[data-drag-drop-target-text]")).toHaveText(["A", "B"]);
    await expect(word(1)).toBeVisible(); await expect(word(2)).toHaveCount(0);
    await page.evaluate(() => nativePresentationFixture.command("show-next"));
    await expect(target(2).locator("[data-drag-drop-target-text]")).toHaveText("A");
    await page.evaluate(() => nativePresentationFixture.command("show-all"));
    await expect(target(3).locator("[data-drag-drop-target-text]")).toHaveText("C");
    await page.evaluate(() => nativePresentationFixture.reset());
    await expect(word(2)).toBeVisible(); await expect(target(1).locator("[data-drag-drop-target-text]")).toHaveCount(0);
    await page.evaluate(() => nativePresentationFixture.setMode("student"));
    await page.evaluate(() => { nativePresentationFixture.setScale(1); nativePresentationFixture.setConsumable(); });
    await expect(word(1)).toBeVisible();
    // Real pointer drag, touch-like pointer capture, and keyboard placement.
    const source = await word(1).locator("[data-drag-drop-drag-handle]").boundingBox(); const destination = await target(1).boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
    await page.mouse.move(destination.x + 5, destination.y + 5, { steps: 6 });
    await expect(page.locator("[data-drag-drop-drag-preview]")).toHaveText("A");
    await page.mouse.up(); await expect(word(1)).toHaveCount(0);
    const touchSource = await word(2).boundingBox(); const touchTarget = await target(2).boundingBox();
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchSource.x + 10, y: touchSource.y + 10 }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchTarget.x + 5, y: touchTarget.y + 5 }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await touch.detach();
    await expect(word(2)).toHaveCount(0);
    await word(3).focus(); await page.keyboard.press("Enter"); await target(3).focus(); await page.keyboard.press("Enter");
    await expect.poll(async () => (await geometry()).bank).toBe(0);
    await page.keyboard.press("Delete"); await expect(word(3)).toBeVisible();
    await expect.poll(async () => (await geometry()).bank).toBeGreaterThan(0);
    await expect.poll(() => page.locator(".native-drag-drop-bank-items").evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
    await page.evaluate(() => nativePresentationFixture.reset());
    await expect.poll(async () => (await geometry()).bank).toBe(180);
    await page.evaluate(async () => { await document.fonts.ready; document.fonts.dispatchEvent(new Event("loadingdone")); });
    await expect.poll(async () => (await geometry()).bank).toBe(180);
    await word(1).click(); await target(1).click({ position: { x: 4, y: 4 } });
    const beforeFont = await geometry();
    await page.evaluate(() => nativePresentationFixture.loadFont());
    await expect(page.locator(".native-drag-drop-bank")).toHaveAttribute("data-font-status", "loaded");
    const afterFont = await geometry();
    assert.deepEqual(afterFont.stage, beforeFont.stage); assert.ok(afterFont.bank > 0 && afterFont.bank <= 180);
    await expect(page.locator(".native-drag-drop-bank-items")).toHaveAttribute("data-fit-status", "fit");
    await page.evaluate(() => { nativePresentationFixture.setScale(1); nativePresentationFixture.setMode("editor"); });
    await page.getByLabel("Activity title", { exact: true }).fill("Saved supporting assets");
    const before = structuredClone(stored);
    await page.getByRole("button", { name: /Save/ }).last().click();
    await expect.poll(() => saves).toBe(1);
    assert.deepEqual(stored.publicDocument.assets, before.publicDocument.assets);
    assert.deepEqual(stored.publicDocument.parts, before.publicDocument.parts);
    assert.deepEqual(stored.teacherDocument, before.teacherDocument);
    await page.evaluate(() => nativePresentationFixture.rerender());
    await expect(page.getByLabel("Activity title", { exact: true })).toHaveValue("Saved supporting assets");
    await page.getByLabel("Activity title", { exact: true }).fill("Unsaved reuse validation");
    await page.getByRole("checkbox", { name: "Reusable item" }).first().click();
    await expect(page.getByRole("checkbox", { name: "Reusable item" }).first()).toBeChecked();
    await expect(page.getByRole("alert")).toHaveText("Remove this item's repeated correct mappings before turning reuse off.");
    await page.getByRole("radio", { name: "Standard drag-and-drop" }).check();
    await page.getByRole("radio", { name: "Text drag-and-drop" }).check();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Reusable item" }).first()).toBeChecked();
    stored.teacherDocument.parts[0].solution.mappings = [];
    await page.evaluate(() => nativePresentationFixture.rerender());
    await expect(page.getByLabel("Activity title", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Save/ }).last()).toBeDisabled();
    stored.publicDocument.readableText.assetSlot = "missing";
    await page.evaluate(() => nativePresentationFixture.rerender());
    await expect(page.getByRole("alert")).toContainText(/managed|reference/i);
    stored.publicDocument.readableText.assetSlot = "readable";
    await page.getByRole("button", { name: "Reload draft" }).click();
    await expect(page.getByLabel("Activity title", { exact: true })).toBeVisible();
    await page.evaluate(() => { nativePresentationFixture.setMode("choice"); nativePresentationFixture.commits = []; });
    await page.getByRole("button", { name: "Focus 1", exact: true }).waitFor();
    for (const scale of [.65, .9, 1]) {
      await page.evaluate((value) => nativePresentationFixture.setScale(value), scale);
      for (let iteration = 0; iteration < 6; iteration++) {
        const name = `Focus ${iteration % 2 + 1}`;
        await page.evaluate(() => { nativePresentationFixture.clickStart = performance.now(); nativePresentationFixture.commitStart = nativePresentationFixture.commits.length; });
        await page.getByRole("button", { name, exact: true }).click();
        await expect(page.getByRole("region", { name: `Focused readable text: ${name}` })).toBeVisible();
        const visible = await page.evaluate(() => performance.now() - nativePresentationFixture.clickStart);
        await page.getByRole("scrollbar", { name: "Focused readable text vertical scroll" }).focus(); await page.keyboard.press("End");
        const metric = await page.evaluate(() => ({ kind: "hotspot", visibleMs: 0, usableMs: performance.now() - nativePresentationFixture.clickStart, commits: nativePresentationFixture.commits.length - nativePresentationFixture.commitStart, fit: document.querySelector(".teacher-offline-embedded-activity").dataset.fitScale, scroll: document.querySelector(".native-audio-text-focus-scroll").scrollTop, resources: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("native-fixture-assets")).map((entry) => ({ duration: entry.duration, bytes: entry.transferSize, type: entry.initiatorType })) }));
        measurements.push({ ...metric, visibleMs: visible, scale, iteration });
        assert.ok(metric.scroll > 0); assert.ok(metric.commits < 30, JSON.stringify(metric));
        const rail = await page.getByRole("scrollbar", { name: "Focused readable text vertical scroll" }).boundingBox();
        if (scale === 1 && iteration === 0) await page.screenshot({ path: `${output}/choice-focused-scroll.png` });
        const host = await page.locator(".native-readable-text-presentation").boundingBox();
        assert.ok(rail.y > host.y + host.height - 120 * scale && rail.x > host.x + host.width - 36 * scale);
        if (iteration % 2) { await expect.poll(() => page.locator(".native-audio-text-focus audio").evaluate((node) => { globalThis.lastFocusAudio = node; return !node.paused && node.currentTime > 0; })).toBe(true); }
        await page.keyboard.press("Escape"); await expect(page.locator(".native-audio-text-focus")).toHaveCount(0);
        if (iteration % 2) assert.equal(await page.evaluate(() => lastFocusAudio.paused), true);
      }
    }
    await page.getByRole("button", { name: "Focus 1", exact: true }).click();
    await page.getByRole("button", { name: "Focus 2", exact: true }).click();
    await expect(page.getByRole("region", { name: "Focused readable text: Focus 2" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Focused readable text: Focus 1" })).toHaveCount(0);
    await page.getByRole("button", { name: "Focus 2", exact: true }).click();
    await expect(page.locator(".native-audio-text-focus")).toHaveCount(0);
    await page.getByRole("button", { name: "Choose: First", exact: true }).click();
    await expect(page.getByRole("button", { name: "Choose: First", exact: true })).toHaveAttribute("data-answer-state", "correct");
    await page.evaluate(() => nativePresentationFixture.command("toggle-text"));
    await page.getByRole("scrollbar", { name: "Readable text vertical scroll", exact: true }).focus(); await page.keyboard.press("End");
    await expect.poll(() => page.locator(".native-readable-text-scroll").evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
    await page.evaluate(() => nativePresentationFixture.command("toggle-text"));
    await expect(page.getByRole("button", { name: "Choose: First", exact: true })).toBeVisible();
    const diagnostics = await page.evaluate(() => presentationDiagnostics);
    measurements.push({ kind: "diagnostics", ...diagnostics });
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/native-presentation.png` });
    await page.setContent(`<iframe title="Native presentation iframe" style="border:0;width:1100px;height:650px" src="${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/presentation.html"></iframe>`);
    const frame = page.frameLocator("iframe");
    const frameScroll = frame.getByRole("scrollbar", { name: "Text Drag & Drop vertical scroll" });
    await frameScroll.focus(); await frameScroll.press("End");
    await expect.poll(() => frame.locator(".native-drag-drop-workspace").evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
    assert.equal(await frameScroll.evaluate((node) => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
    assert.deepEqual(errors, []);
    console.log("Native presentation/editor/reusable browser regressions passed.");
  } catch (error) {
    await page.screenshot({ path: `${output}/presentation-failure.png` });
    throw error;
  } finally {
    await writeFile(`${output}/presentation-measurements.json`, JSON.stringify({ measurements, errors }, null, 2));
    await page.close(); await server.close();
  }
}
