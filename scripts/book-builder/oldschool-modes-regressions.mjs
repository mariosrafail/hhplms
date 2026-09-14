import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { createServer } from "../../tests/_vite-test-server.mjs";
import { createOldschoolModePair } from "../../tests/fixtures/oldschool-modes.js";
import { projectOldschoolQuestionPair } from "../../src/data/native-activities/nativeOldschoolQuestionBinding.js";

export async function runOldschoolModesRegressions(browser, output) {
  await mkdir(output, { recursive: true });
  const provider = { name: "oldschool-isolated-provider", enforce: "pre", resolveId: (id) => ["virtual:component-publication", "virtual:hosted-native-drafts"].includes(id) ? `\0${id}` : null,
    load: (id) => id === "\0virtual:hosted-native-drafts" ? "export const hostedNativeDraftAssetUrl=(_,id)=>globalThis.oldschoolModes.assetUrl(id); export const hostedNativeDraftTeacherAssetUrl=()=>'';" : id === "\0virtual:component-publication" ? "export const publishedNativeAssetUrl=(_,ref)=>globalThis.oldschoolModes.assetUrl(ref.assetId); export const publishedNativeTeacherAssetUrl=()=>''; export const loadPublishedNativeTeacherDocument=async()=>globalThis.oldschoolModes.pair.teacherDocument;" : null };
  const server = await createServer({ configFile: false, plugins: [provider, react()], optimizeDeps: { entries: ["tests/fixtures/native-runtime-regressions/oldschool-modes.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors = []; const evidence = [];
  const font = Buffer.from((await readFile("tests/fixtures/fonts/Ahem.ttf.base64", "utf8")).trim(), "base64");
  let saved = createOldschoolModePair(); let standalone = false; let saves = 0;
  const asset = async (route) => {
    const id = route.request().url();
    if (id.includes("000000000073")) return route.fulfill({ contentType: "font/ttf", body: font });
    if (id.includes("000000000071") || id.includes("000000000076")) {
      const bytes = Buffer.alloc(44 + 16000 * 8); bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
      return route.fulfill({ contentType: "audio/wav", body: bytes });
    }
    const height = id.includes("000000000072") ? 1509 : id.includes("000000000075") ? 1600 : 582;
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${height}"><rect width="1024" height="${height}" fill="#fff8e6"/><path d="M0 0H1024V${height}H0Z" fill="none" stroke="#207080" stroke-width="8"/><text x="40" y="100" font-size="32">${height === 1600 ? "Independent readable text" : "Synthetic question / listening page"}</text></svg>` });
  };
  await context.route("**/oldschool-mode-assets/**", asset);
  await context.route("**/builder/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/preview")) return asset(route);
    if (path.includes("/fonts")) return route.fulfill({ json: { fonts: [] } });
    if (path.includes("/content/")) {
      const pair = standalone ? projectOldschoolQuestionPair(saved.publicDocument, saved.teacherDocument) : saved;
      return route.fulfill({ json: { revision: 7, document: path.includes("native-activity-teacher") ? pair.teacherDocument : pair.publicDocument } });
    }
    if (path.endsWith("/save")) { const input = route.request().postDataJSON(); saved = { publicDocument: input.publicDocument, teacherDocument: input.teacherDocument }; saves++; return route.fulfill({ json: { ...saved, publicRevision: 8, teacherRevision: 8 } }); }
    throw new Error(`Unexpected isolated Builder request: ${path}`);
  });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/oldschool-modes.html`);
    await page.waitForFunction(() => Boolean(globalThis.oldschoolModes));
    for (const width of [1440, 760]) for (const mode of ["open-response", "single-choice", "drag-drop"]) for (let supporting = 0; supporting < 5; supporting++) {
      await page.setViewportSize({ width, height: 1000 });
      const session = await page.evaluate((config) => oldschoolModes.configure(config), { mode, supporting, path: "student", shell: true });
      await expect(page.locator("main")).toHaveAttribute("data-session", String(session));
      await expect(page.locator(".native-oldschool-listening")).toHaveAttribute("data-panel", "1");
      await expect(page.getByRole("button", { name: "toggle-text", exact: true })).toHaveCount(supporting ? 1 : 0);
      if (mode === "open-response") await page.locator("textarea").fill("Retained response");
      if (mode === "single-choice") await page.getByRole("radio").first().click();
      if (mode === "drag-drop") {
        await page.locator("[data-drag-drop-word-id]").first().click();
        await page.locator("[data-drag-drop-target-id]").first().click();
        await expect(page.locator("[data-drag-drop-target-id]").first()).toHaveAttribute("data-occupied", "true");
        const geometry = await page.evaluate(() => {
          const rect = (selector) => { const node = document.querySelector(selector); const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
          return { bank: rect(".native-drag-drop-bank"), player: rect(".native-oldschool-listening-player-anchor"), stage: rect(".native-oldschool-listening-activity-stage") };
        });
        evidence.push({ width, mode, supporting, geometry });
        await writeFile(`${output}/oldschool-modes-geometry.json`, JSON.stringify(evidence, null, 2));
        await page.screenshot({ path: `${output}/oldschool-drag-drop-geometry.png`, fullPage: true });
        assert(geometry.bank.bottom <= geometry.stage.bottom + 1, "DnD bank must not be clipped by Oldschool stage");
        assert(geometry.bank.bottom <= geometry.player.y || geometry.bank.y >= geometry.player.bottom || geometry.bank.right <= geometry.player.x || geometry.bank.x >= geometry.player.right, "DnD bank must not overlap listening player");
      }
      await page.getByRole("button", { name: "next-panel", exact: true }).click();
      await expect(page.locator(".native-oldschool-listening")).toHaveAttribute("data-panel", "2");
      await page.getByRole("button", { name: "previous-panel", exact: true }).click();
      if (supporting) {
        await page.getByRole("button", { name: "toggle-text", exact: true }).click();
        await expect(page.getByRole("region", { name: "Readable text", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "toggle-text", exact: true }).click();
      }
      if (supporting > 1) {
        await page.getByRole("button", { name: "Read the clue", exact: true }).click();
        await expect(page.locator("[data-audio-focus=true]")).toBeVisible();
        await page.keyboard.press("Escape");
      }
      if (mode === "open-response") await expect(page.locator("textarea")).toHaveValue("Retained response");
      if (mode === "single-choice") await expect(page.getByRole("radio").first()).toBeChecked();
      if (mode === "drag-drop") await expect(page.locator("[data-drag-drop-target-id]").first()).toHaveAttribute("data-occupied", "true");
      if (supporting === 4) { await page.getByRole("button", { name: "Opening", exact: true }).click(); await expect(page.locator(".native-oldschool-listening")).toHaveAttribute("data-panel", "2"); }
      if (supporting === 3) {
        await page.getByRole("button", { name: "Play Listening audio", exact: true }).click();
        await expect(page.locator(".native-oldschool-listening")).toHaveAttribute("data-panel", "2");
        await expect.poll(() => page.locator(".native-oldschool-listening audio").evaluate((audio) => audio.paused)).toBe(false);
        await expect(page.locator('.native-oldschool-listening [data-highlighted="true"]').first()).toBeVisible();
        await page.getByRole("button", { name: "previous-panel", exact: true }).click();
        await page.getByRole("button", { name: "Read the clue", exact: true }).click();
        await expect.poll(() => page.locator(".native-audio-text-focus audio").evaluate((audio) => audio.paused)).toBe(false);
        await expect.poll(() => page.locator(".native-oldschool-listening audio").evaluate((audio) => audio.paused)).toBe(true);
        await page.keyboard.press("Escape");
        evidence.push({ width, mode, playbackHighlightAndArbitration: "PASS" });
      }
      if (supporting === 3) await page.screenshot({ path: `${output}/oldschool-${mode}-${width}.png`, fullPage: true });
    }
    for (const mode of ["open-response", "single-choice", "drag-drop"]) for (const path of ["teacher", "published-teacher", "published-student", "draft-teacher", "draft-student"]) {
      const session = await page.evaluate((config) => oldschoolModes.configure(config), { mode, supporting: 4, path, shell: true });
      await expect(page.locator("main")).toHaveAttribute("data-session", String(session));
      await expect(page.locator(".native-oldschool-listening")).toBeVisible();
      if (!path.endsWith("student")) {
        await page.getByRole("button", { name: "show-all", exact: true }).click();
        await expect.poll(() => page.evaluate(() => oldschoolModes.state?.reveal?.revealed)).toBe(1);
      }
      await page.getByRole("button", { name: "next-panel", exact: true }).click();
      await page.getByRole("button", { name: "previous-panel", exact: true }).click();
      await page.getByRole("button", { name: "Read the clue", exact: true }).click();
      await expect(page.locator("[data-audio-focus=true]")).toBeVisible(); await page.keyboard.press("Escape");
      if (!path.endsWith("student")) {
        assert.equal(await page.evaluate(() => oldschoolModes.state.reveal.revealed), 1);
        await page.getByRole("button", { name: "reset-activity", exact: true }).click();
        await expect.poll(() => page.evaluate(() => oldschoolModes.state?.reveal?.revealed)).toBe(0);
      }
      assert.equal(await page.getByRole("navigation", { name: "Listening panels", exact: true }).count(), 0);
      evidence.push({ path, mode, revealAndHotspots: "PASS" });
    }
    for (const mode of ["open-response", "single-choice", "drag-drop"]) {
      let controlledSession = await page.evaluate((mode) => oldschoolModes.configure({ mode, path: "student", supporting: 4, shell: true, controlled: true, readOnly: false }), mode);
      await expect(page.locator("main")).toHaveAttribute("data-session", String(controlledSession));
      if (mode === "open-response") await page.locator("textarea").fill("Controlled response");
      if (mode === "single-choice") await page.getByRole("radio").first().click();
      if (mode === "drag-drop") { await page.locator("[data-drag-drop-word-id]").first().click(); await page.locator("[data-drag-drop-target-id]").first().click(); }
      const response = await page.evaluate(() => oldschoolModes.responses);
      assert(Object.keys(response).length > 0, "Controlled response callback is delivered");
      await page.getByRole("button", { name: "next-panel", exact: true }).click();
      await page.getByRole("button", { name: "previous-panel", exact: true }).click();
      await page.getByRole("button", { name: "Read the clue", exact: true }).click(); await page.keyboard.press("Escape");
      assert.deepEqual(await page.evaluate(() => oldschoolModes.responses), response);
      if (mode === "open-response") await expect(page.locator("textarea")).toHaveValue("Controlled response");
      if (mode === "single-choice") await expect(page.getByRole("radio").first()).toBeChecked();
      if (mode === "drag-drop") await expect(page.locator("[data-drag-drop-target-id]")).toHaveAttribute("data-occupied", "true");
      controlledSession = await page.evaluate(() => oldschoolModes.configure({ readOnly: true }));
      await expect(page.locator("main")).toHaveAttribute("data-session", String(controlledSession));
      if (mode === "open-response") await expect(page.locator("textarea")).not.toBeEditable();
      if (mode === "single-choice") await expect(page.getByRole("radio").first()).toBeDisabled();
      if (mode === "drag-drop") {
        await page.locator("[data-drag-drop-word-id]").first().click({ force: true });
        await page.locator("[data-drag-drop-target-id]").first().click({ force: true });
        await expect(page.locator("[data-drag-drop-target-id]")).not.toHaveAttribute("data-occupied", "true");
        await expect(page.locator("[data-drag-drop-target-id]")).toHaveAttribute("aria-disabled", "true");
      }
      assert.deepEqual(await page.evaluate(() => oldschoolModes.responses), {});
      evidence.push({ mode, controlledAndReadOnly: "PASS" });
    }
    // Real pointer drag, plus local navigation without an external shell.
    let session = await page.evaluate(() => oldschoolModes.configure({ mode: "drag-drop", path: "student", supporting: 2, shell: false, controlled: false, readOnly: false }));
    await expect(page.locator("main")).toHaveAttribute("data-session", String(session));
    const word = await page.locator("[data-drag-drop-word-id]").first().boundingBox();
    const target = await page.locator("[data-drag-drop-target-id]").first().boundingBox();
    await page.mouse.move(word.x + word.width / 2, word.y + word.height / 2); await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 }); await page.mouse.up();
    await expect(page.locator("[data-drag-drop-target-id]")).toHaveAttribute("data-occupied", "true");
    await page.getByRole("button", { name: "Next", exact: true }).click(); await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(page.locator("[data-drag-drop-target-id]")).toHaveAttribute("data-occupied", "true");
    // The actual standalone and embedded editors render the same toolbar and
    // quick controls above their canvas, using isolated API fixtures.
    for (const path of ["standalone", "builder"]) {
      standalone = path === "standalone"; saved = createOldschoolModePair("open-response", 4);
      session = await page.evaluate((path) => oldschoolModes.configure({ mode: "open-response", path, shell: false }), path);
      await expect(page.locator("main")).toHaveAttribute("data-session", String(session));
      const editor = page.locator(".native-or-editor");
      await page.getByRole("tab", { name: path === "standalone" ? "Layout" : "Visual", exact: true }).click();
      await editor.locator(".native-or-response").first().click();
      await expect(editor.getByLabel("Add Background", { exact: true })).toBeEnabled();
      const geometry = await editor.evaluate((node) => {
        const selectors = [".studio-canvas-toolbar", ".studio-canvas-context-controls", ".studio-canvas-viewport"];
        return Object.fromEntries(selectors.map((selector) => { const element = node.querySelector(selector); if (!element) return [selector, null]; const box = element.getBoundingClientRect(); return [selector, { y: box.y, bottom: box.bottom, width: box.width, height: box.height }]; }));
      });
      assert(geometry[".studio-canvas-context-controls"].bottom <= geometry[".studio-canvas-viewport"].y + 1, "Quick controls must be above the canvas");
      evidence.push({ path, geometry });
      await page.screenshot({ path: `${output}/oldschool-or-${path}-toolbar.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      const desktopGeometry = await editor.evaluate((node) => ({ controlsBottom: node.querySelector(".studio-canvas-context-controls").getBoundingClientRect().bottom, canvasTop: node.querySelector(".studio-canvas-viewport").getBoundingClientRect().y }));
      assert(desktopGeometry.controlsBottom <= desktopGeometry.canvasTop + 1);
      evidence.push({ path, width: 1440, geometry: desktopGeometry });
      await page.screenshot({ path: `${output}/oldschool-or-${path}-toolbar-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 760, height: 1000 });
      if (path === "builder") {
        await expect(editor.getByRole("button", { name: "Delete Panel", exact: true })).toBeDisabled();
        await expect(editor.getByRole("button", { name: "Add Panel", exact: true })).toBeDisabled();
        assert.equal(saves, 0, "Opening a canonical editor never saves implicitly");
        await editor.getByLabel("Quick Y", { exact: true }).fill("190");
        await page.getByRole("button", { name: "Save Draft", exact: true }).click();
        await expect.poll(() => saves).toBe(1);
        assert.equal(saved.publicDocument.parts[0].interaction.questions[0].responseRegion.area.y, 190);
        assert.equal(saved.publicDocument.parts[0].interaction.artwork[0].id.startsWith("art-"), true);
        assert.equal(saved.publicDocument.audioTextHotspots.hotspots[0].panelId, "panel-1");
        assert.equal(saved.publicDocument.parts[0].interaction.cues.length, 3);
        await page.getByRole("tab", { name: "Content", exact: true }).first().click();
        page.once("dialog", (dialog) => dialog.dismiss());
        await page.getByLabel("Panel 1 activity type", { exact: true }).selectOption("drag-drop");
        await expect(page.getByLabel("Panel 1 activity type", { exact: true })).toHaveValue("open-response");
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByLabel("Panel 1 activity type", { exact: true }).selectOption("drag-drop");
        await expect(page.locator(".native-drag-drop-editor")).toBeVisible();
      }
    }
    standalone = false; saved = createOldschoolModePair("drag-drop", 4);
    session = await page.evaluate(() => oldschoolModes.configure({ mode: "drag-drop", path: "builder" }));
    await expect(page.locator("main")).toHaveAttribute("data-session", String(session));
    await page.getByLabel("Randomize", { exact: true }).check();
    await page.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect.poll(() => saves).toBe(2);
    assert.equal(saved.publicDocument.parts[0].interaction.questionInteraction.randomize, true);
    session = await page.evaluate(() => oldschoolModes.configure({ path: "builder" }));
    await expect(page.locator("main")).toHaveAttribute("data-session", String(session));
    await expect(page.getByLabel("Randomize", { exact: true })).toBeChecked();
    await page.getByRole("tab", { name: "Visual", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove panel", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Add Background", { exact: true })).toBeEnabled();
    await page.getByRole("tab", { name: "Readable Text", exact: true }).click();
    await expect(page.getByRole("button", { name: "Place readable-text hotspot on activity" })).toBeVisible();
    await page.screenshot({ path: `${output}/oldschool-dnd-readable-authoring.png`, fullPage: true });
    for (const config of [{ mode: "single-choice", visual: true }, { mode: "drag-drop", layoutMode: "text" }]) {
      session = await page.evaluate((config) => oldschoolModes.configure({ ...config, path: "student", supporting: 4, shell: true }), config);
      await expect(page.locator("main")).toHaveAttribute("data-session", String(session));
      await page.getByRole("button", { name: "Read the clue", exact: true }).click();
      await expect(page.locator("[data-audio-focus=true]")).toBeVisible(); await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Opening", exact: true }).click();
      await expect(page.locator(".native-oldschool-listening")).toHaveAttribute("data-panel", "2");
      await page.getByRole("button", { name: "previous-panel", exact: true }).click();
      await page.screenshot({ path: `${output}/oldschool-${config.mode}-alternate-layout.png`, fullPage: true });
    }
    session = await page.evaluate(() => oldschoolModes.configure({ path: "binding-lifecycle" }));
    await expect(page.locator("main")).toHaveAttribute("data-session", String(session));
    await page.getByRole("button", { name: "Add Question", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Rejected parent canvas resize");
    await page.getByRole("button", { name: "Unmount rejected editor", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    evidence.push({ bindingErrorCleanup: "PASS" });
    assert.deepEqual(errors, []);
    await writeFile(`${output}/oldschool-modes-geometry.json`, JSON.stringify(evidence, null, 2));
    return evidence;
  } catch (error) { await page.screenshot({ path: `${output}/oldschool-failure.png`, fullPage: true }); await writeFile(`${output}/oldschool-failure.txt`, await page.locator("body").innerText()); throw error; } finally { await context.close(); await server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ headless: true });
  try { await runOldschoolModesRegressions(browser, process.env.NATIVE_REGRESSION_OUTPUT || "test-results/oldschool-modes"); } finally { await browser.close(); }
}
