import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { dragDropImprovementsPair, dndId } from "../../tests/fixtures/native-runtime-regressions/drag-drop-improvements-data.js";
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from "../../src/data/native-activities/nativeActivityRuntimeValidation.js";
import { runDndVariableHeightRegressions } from "./native-drag-drop-variable-height-regressions.mjs";
import { verifyDragDropContainment } from "./native-drag-drop-containment.mjs";

export async function runDragDropImprovementRegressions(browser, baseUrl, output) {
  await runDndVariableHeightRegressions(browser, baseUrl, output);
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const images = {};
  for (const [slot, width, height, background] of [["background", 1024, 582, "#eef6ff"], ["overlay", 150, 100, "#faaf40"], ["item", 120, 60, "#278244"], ["readable", 1000, 1800, "#faf0cc"]]) images[slot] = await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
  const audio = await readFile("src/assets/books/ultimate-b2/teacher-offline-media/unit-1-television-dialogue.mp3");
  await page.route("**/dnd-fixture/*", (route) => { const slot = new URL(route.request().url()).pathname.split("/").pop(); return route.fulfill({ contentType: slot === "audio" ? "audio/mpeg" : "image/png", body: slot === "audio" ? audio : images[slot] }); });
  const target = (n) => page.locator(`[data-drag-drop-target-id="${dndId("target", n)}"]`);
  const word = (n) => page.locator(`[data-drag-drop-word-id="${dndId("word", n)}"]`);
  const order = () => page.locator("[data-drag-drop-word-id]").evaluateAll((nodes) => nodes.map((n) => n.dataset.dragDropWordId));
  const allIds = [1, 2, 3, 4].map((n) => dndId("word", n));
  const change = (values) => page.evaluate((values) => dnd.setPair((pair) => { const next = structuredClone(pair); Object.assign(next.publicDocument.parts[0].interaction, values); return next; }), values);
  const evidence = [];
  const contained = async (locator) => {
    evidence.push(await verifyDragDropContainment(locator, output, `dnd-containment-${evidence.length}`));
  };
  try {
    await page.goto(`${baseUrl}tests/fixtures/native-runtime-regressions/drag-drop-improvements.html`);
    await expect(word(1).locator("img")).toBeVisible();
    assert.deepEqual(await order(), allIds);
    await expect(target(1).locator("[data-drag-drop-target-text]")).toHaveCount(0);
    for (const layoutMode of ["standard", "text"]) for (const scale of [1, .65]) {
      await change({ layoutMode });
      await expect(page.locator(".native-drag-drop")).toHaveAttribute("data-layout-mode", layoutMode);
      await page.evaluate((scale) => dnd.setScale(scale), scale);
      await expect(page.locator("#root > div")).toHaveCSS("transform", `matrix(${scale}, 0, 0, ${scale}, 0, 0)`);
      const before = await word(1).boundingBox();
      const imageBefore = await word(1).locator("img").boundingBox();
      assert.equal(await word(1).evaluate((el) => getComputedStyle(el).padding), "2px");
      await page.mouse.move(before.x + 10, before.y + 10); await page.mouse.down(); await page.mouse.move(before.x + 40, before.y - 40, { steps: 5 });
      const proxy = page.locator("[data-drag-drop-drag-preview]"); await expect(proxy).toBeVisible();
      const after = await proxy.boundingBox(); const imageAfter = await proxy.locator("img").boundingBox();
      for (const dim of ["width", "height"]) { assert.ok(Math.abs(before[dim] - after[dim]) < 1); assert.ok(Math.abs(imageBefore[dim] - imageAfter[dim]) < 1); }
      await page.screenshot({ path: `${output}/dnd-image-proxy-${layoutMode}-${scale}.png` });
      const destination = await target(1).boundingBox(); await page.mouse.move(destination.x + 20, destination.y + 20); await page.mouse.up();
      await expect(target(1).locator("img")).toHaveCount(1);
      await target(1).getByRole("button", { name: /^Remove/ }).click();
    }
    await page.evaluate(() => dnd.setScale(1));
    await change({ layoutMode: "standard" });
    await expect(page.locator(".native-drag-drop")).toHaveAttribute("data-layout-mode", "standard");
    await expect(page.locator("#root > div")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await word(1).click(); await expect(word(1)).toHaveAttribute("aria-pressed", "true"); await target(1).click({ position: { x: 3, y: 3 } }); await word(2).click(); await expect(word(2)).toHaveAttribute("aria-pressed", "true"); await target(1).click({ position: { x: 3, y: 3 } });
    await expect(target(1).locator("[data-drag-drop-target-text]")).toHaveCount(2);
    await contained(target(1));
    assert.deepEqual(await order(), [allIds[0], allIds[2], allIds[3]]);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await word(1).click(); await target(2).click(); await contained(target(2));
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await target(1).getByRole("button", { name: /^Remove Reusable/ }).click();
    assert.deepEqual(await page.evaluate(() => dnd.responses[Object.keys(dnd.responses).find((id) => id.endsWith("2"))]), [allIds[0]]);
    await target(1).getByRole("button", { name: /^Remove Longer/ }).click();
    assert.deepEqual(await order(), allIds);
    await word(2).focus(); await page.keyboard.press("Enter"); await target(3).focus(); await page.keyboard.press("Enter");
    await expect(target(3).locator(".native-drag-drop-target-items")).toHaveAttribute("data-fit-status", "fit");
    await contained(target(3));
    await page.screenshot({ path: `${output}/dnd-small-word-target.png` });
    await page.keyboard.press("Delete"); assert.deepEqual(await order(), allIds);
    await page.evaluate(() => dnd.setPair((pair) => { const next = structuredClone(pair); next.publicDocument.parts[0].interaction.words.reverse(); return next; }));
    await expect.poll(order).toEqual([...allIds].reverse());
    // Use controlled randomness before the next activity identity starts a session.
    await page.evaluate(() => { Math.random = () => 0; dnd.setPair((pair) => { const next = structuredClone(pair); delete next.publicDocument.parts[0].interaction.randomize; next.publicDocument.activityId = "legacy-random-session"; return next; }); });
    await expect.poll(order).toEqual([allIds[2], allIds[1], allIds[0], allIds[3]]);
    const shuffled = await order();
    await change({ randomize: true });
    assert.deepEqual(await order(), shuffled);
    await page.evaluate(() => { dnd.rerender(); dnd.reset(); });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    assert.deepEqual(await order(), shuffled);
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await word(2).click();
    const beforeHotspot = await page.evaluate(() => dnd.responses);
    await page.getByRole("button", { name: "Open excerpt 1", exact: true }).click();
    await expect(page.getByRole("region", { name: "Focused readable text: Open excerpt 1" })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => dnd.responses), beforeHotspot);
    await expect(word(2)).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: `${output}/dnd-readable-focus.png` });
    await page.keyboard.press("Escape");
    await expect(page.locator(".native-audio-text-focus")).toHaveCount(0);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Open excerpt 2", exact: true }).click();
    const audioNode = page.locator(".native-audio-text-focus audio");
    await expect.poll(() => audioNode.evaluate((el) => !el.paused)).toBe(true);
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(audioNode).toHaveCount(0);
    await page.evaluate(({ id, words }) => { dnd.setResponses({ [id]: words }); dnd.setReadOnly(true); }, { id: dndId("target", 1), words: allIds.slice(0, 2) });
    await expect(word(1)).toBeDisabled();
    await expect(target(1).locator("[data-drag-drop-target-text]")).toHaveCount(2); await contained(target(1));
    await page.screenshot({ path: `${output}/dnd-read-only-review.png` });
    await page.getByRole("button", { name: "Open excerpt 1", exact: true }).click();
    await expect(page.locator(".native-audio-text-focus")).toBeVisible(); await page.keyboard.press("Escape");
    await page.evaluate(() => dnd.setTeacher(true));
    await target(1).click(); await expect(target(1).locator("[data-drag-drop-target-text]")).toHaveCount(2); await contained(target(1));
    await page.screenshot({ path: `${output}/dnd-teacher-reveal.png` });
    for (const layoutMode of ["standard", "text"]) {
      await change({ layoutMode, randomize: false });
      await expect(page.locator(".native-drag-drop")).toHaveAttribute("data-layout-mode", layoutMode);
      await page.setViewportSize({ width: 680, height: 850 });
      await contained(target(1));
      await page.screenshot({ path: `${output}/dnd-${layoutMode}-narrow.png` });
    }
    await page.evaluate(() => dnd.setPair((pair) => { const next = structuredClone(pair); const interaction = next.publicDocument.parts[0].interaction; interaction.answerBankHeightPx = 96; interaction.panels[0].surface.height = 1600; interaction.words.find((w) => w.image).image.displayHeight = 256; return next; }));
    const bank = page.locator(".native-drag-drop-bank-items");
    await expect(bank).toHaveCSS("overflow-y", "auto");
    await expect.poll(() => bank.evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; })).toBeGreaterThan(0);
    const textViewport = page.locator(".native-drag-drop-workspace");
    await expect.poll(() => textViewport.evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; })).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Read Text", exact: true }).click();
    await expect.poll(() => page.locator(".native-readable-text-scroll").evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; })).toBeGreaterThan(0);
    await runAuthoring(page, baseUrl, output, images);
    assert.deepEqual(errors, []);
    await writeFile(`${output}/dnd-improvement-measurements.json`, JSON.stringify(evidence, null, 2));
  } catch (error) { await writeFile(`${output}/dnd-improvements-failure.json`, JSON.stringify({ errors, url: page.url(), body: await page.locator("body").innerText() }, null, 2)); await page.screenshot({ path: `${output}/dnd-improvements-failure.png`, fullPage: true }); throw error; }
  finally { await page.close(); }
}

async function runAuthoring(page, baseUrl, output, images) {
  let pair = dragDropImprovementsPair(); let saves = 0; let slot; let pendingFinalize = null;
  let uploadDimensions = { width: 120, height: 60 }; let immediateUpload = false; let uploadNumber = 9;
  pair.publicDocument.parts[0].interaction.randomize = true;
  await page.route("**/builder/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/fonts")) return route.fulfill({ json: { fonts: [] } });
    if (url.pathname.endsWith("/preview")) { const asset = pair.publicDocument.assets.find((a) => url.pathname.includes(a.assetId)); return route.fulfill({ contentType: "image/png", body: images[asset?.slot] || images.item }); }
    if (url.pathname.includes("/native-activity-public/")) return route.fulfill({ json: { document: pair.publicDocument, revision: saves + 1 } });
    if (url.pathname.includes("/native-activity-teacher/")) return route.fulfill({ json: { document: pair.teacherDocument, revision: saves + 1 } });
    if (url.pathname.endsWith("/prepare")) { slot = route.request().postDataJSON().assetSlot; return route.fulfill({ json: { uploadId: "fixture-upload", authorization: { url: `${baseUrl}dnd-upload`, headers: {} } } }); }
    if (url.pathname.endsWith("/finalize")) { pendingFinalize = () => route.fulfill({ json: { reference: { slot, assetId: `10000000-0000-4000-8000-${String(uploadNumber++).padStart(12, "0")}`, checksumSha256: "a".repeat(64), role: "activity_artwork" }, metadata: uploadDimensions } }); if (immediateUpload) await pendingFinalize(); return; }
    if (url.pathname.endsWith("/save")) {
      const input = route.request().postDataJSON();
      const publicDocument = normalizeNativeRuntimePublicDocument(input.publicDocument, { activityId: pair.publicDocument.activityId, kind: "drag-drop" });
      const teacherDocument = normalizeNativeRuntimeTeacherDocument(input.teacherDocument, { activityId: pair.publicDocument.activityId, kind: "drag-drop", publicDocument });
      pair = { publicDocument, teacherDocument }; saves += 1;
      return route.fulfill({ json: { ...pair, publicRevision: saves + 1, teacherRevision: saves + 1 } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route("**/dnd-upload", (route) => route.fulfill({ status: 200 }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(`${baseUrl}tests/fixtures/native-runtime-regressions/drag-drop-improvements.html?editor`);
  const editor = page.locator(".native-drag-drop-editor");
  await expect(editor.getByRole("checkbox", { name: "Randomize", exact: true })).toBeChecked();
  await editor.getByRole("checkbox", { name: "Randomize", exact: true }).uncheck();
  for (const width of [1400, 680]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await editor.locator(".native-drag-drop-content").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
    const row = editor.locator(".native-drag-drop-word-row").first();
    assert.ok(await row.getByRole("textbox", { name: "Word 1", exact: true }).evaluate((el) => el.clientWidth > 250));
    await page.screenshot({ path: `${output}/dnd-content-${width}.png`, fullPage: true });
  }
  await editor.locator(".native-drag-drop-word-row").first().getByRole("checkbox", { name: "Reusable item" }).click();
  await expect(editor.getByRole("alert")).toContainText("repeated correct mappings");
  await expect(editor.locator(".native-drag-drop-word-row").first().getByRole("checkbox", { name: "Reusable item" })).toBeChecked();
  await editor.getByLabel("Upload image for A", { exact: true }).setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: images.item });
  await expect.poll(() => Boolean(pendingFinalize)).toBe(true);
  await expect(editor.getByRole("button", { name: "Remove word 2", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Save Draft", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Move word 2 up", exact: true }).click();
  await pendingFinalize();
  await expect(editor.locator(".native-drag-drop-word-row").first().getByLabel("Image width for A", { exact: true })).toHaveValue("64");
  await editor.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect.poll(() => saves).toBe(1);
  assert.ok(pair.publicDocument.parts[0].interaction.words.find((w) => w.id === dndId("word", 2)).image);
  assert.equal(pair.publicDocument.parts[0].interaction.randomize, false);
  await page.reload();
  await expect(editor.getByRole("checkbox", { name: "Randomize", exact: true })).not.toBeChecked();
  await expect(editor.getByRole("textbox", { name: "Word 1", exact: true })).toHaveValue("Longer target label");
  page.once("dialog", (dialog) => dialog.dismiss());
  await editor.getByRole("button", { name: "Remove word 1", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Word 1", exact: true })).toHaveValue("Longer target label");
  pendingFinalize = null;
  await editor.getByLabel("Upload image for A", { exact: true }).setInputFiles({ name: "late.png", mimeType: "image/png", buffer: images.item });
  await expect.poll(() => Boolean(pendingFinalize)).toBe(true);
  await editor.getByRole("tab", { name: "Readable Text", exact: true }).click();
  await pendingFinalize();
  await expect(editor.getByRole("button", { name: "Save Draft", exact: true })).toBeDisabled();
  assert.equal(saves, 1, "late upload after unmount cannot save or attach to another item");
  await expect(editor.getByRole("button", { name: "Place readable-text hotspot on activity" })).toBeVisible();
  await expect(editor.locator(".native-audio-hotspot-authoring-stage .native-or-artwork")).toHaveCount(2);
  await page.screenshot({ path: `${output}/dnd-hotspot-authoring.png`, fullPage: true });
  await editor.getByRole("button", { name: "Add readable-text hotspot", exact: true }).click();
  await editor.getByRole("combobox", { name: /^Activity panel/ }).selectOption(dndId("panel", 2));
  await editor.getByLabel("Hotspot accessible label", { exact: true }).fill("New second-panel excerpt");
  await editor.getByRole("radio", { name: "Pink", exact: true }).check();
  await editor.getByRole("button", { name: "Place readable-text hotspot on activity" }).click({ position: { x: 40, y: 40 } });
  await editor.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect.poll(() => saves).toBe(2);
  const created = pair.publicDocument.audioTextHotspots.hotspots[2];
  assert.equal(created.panelId, dndId("panel", 2)); assert.equal(created.highlightColor, "pink");
  assert.ok(created.activityArea.x + created.activityArea.width <= 1024);
  await page.reload(); await editor.getByRole("tab", { name: "Readable Text", exact: true }).click();
  await editor.getByRole("tab", { name: "Hotspot 3", exact: true }).click();
  await expect(editor.getByLabel("Hotspot accessible label", { exact: true })).toHaveValue("New second-panel excerpt");
  await editor.getByRole("button", { name: "Remove hotspot", exact: true }).click();
  await editor.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect.poll(() => saves).toBe(3);
  assert.equal(pair.publicDocument.audioTextHotspots.hotspots.length, 2);
  await editor.getByRole("tab", { name: "Layout", exact: true }).click();
  await editor.getByRole("button", { name: "Move panel 2 up", exact: true }).click();
  await editor.getByRole("button", { name: /^Panel 1 .*2 images/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "Remove panel", exact: true }).click();
  await editor.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect.poll(() => saves).toBe(4);
  assert.equal(pair.publicDocument.audioTextHotspots.hotspots.length, 1);
  assert.equal(pair.publicDocument.assets.some((a) => a.slot === "audio"), false);
  assert.equal(pair.publicDocument.audioTextHotspots.hotspots[0].panelId, dndId("panel", 1));
  immediateUpload = true;
  const teacherBefore = structuredClone(pair.teacherDocument);
  const focusBefore = structuredClone(pair.publicDocument.audioTextHotspots.hotspots[0].readableFocusArea);
  const wordsBefore = structuredClone(pair.publicDocument.parts[0].interaction.words);
  for (const height of [291, 312, 582]) {
    await editor.getByRole("tab", { name: "Layout", exact: true }).click();
    uploadDimensions = { width: 1024, height };
    const buffer = await sharp({ create: { ...uploadDimensions, channels: 3, background: "#d5eaff" } }).png().toBuffer();
    const before = structuredClone(pair.publicDocument.parts[0].interaction.panels[0]);
    if (height === 291) await editor.getByLabel("Add Background", { exact: true }).setInputFiles({ name: `background-${height}.png`, mimeType: "image/png", buffer });
    else {
      await editor.locator(".native-drag-drop-authoring-image").first().focus();
      await page.keyboard.press("Enter");
      await editor.getByLabel("Replace image", { exact: true }).setInputFiles({ name: `background-${height}.png`, mimeType: "image/png", buffer });
    }
    await expect(editor.locator(".native-drag-drop-authoring-stage")).toHaveCSS("aspect-ratio", `1024 / ${height}`);
    if (height === 291) await editor.getByRole("textbox", { name: "Alt text", exact: true }).fill("Variable-height exercise background");
    await editor.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect.poll(() => pair.publicDocument.parts[0].interaction.panels[0].surface.height).toBe(height);
    const panel = pair.publicDocument.parts[0].interaction.panels[0];
    assert.deepEqual(panel.dropTargets.map((target) => target.id), before.dropTargets.map((target) => target.id));
    for (let i = 0; i < panel.dropTargets.length; i++) {
      assert.equal(panel.dropTargets[i].area.y, Math.round(before.dropTargets[i].area.y * height / before.surface.height));
    }
    assert.deepEqual(pair.teacherDocument, teacherBefore);
    assert.deepEqual(pair.publicDocument.parts[0].interaction.words, wordsBefore);
    assert.deepEqual(pair.publicDocument.audioTextHotspots.hotspots[0].readableFocusArea, focusBefore);
    await page.reload(); await editor.getByRole("tab", { name: "Layout", exact: true }).click();
    await expect(editor.locator(".native-drag-drop-authoring-stage")).toHaveCSS("aspect-ratio", `1024 / ${height}`);
    await editor.getByRole("tab", { name: "Local Preview", exact: true }).click();
    await expect(editor.locator(".native-drag-drop-stage")).toHaveAttribute("data-surface-height", String(height));
  }
  await editor.getByRole("tab", { name: "Layout", exact: true }).click();
  await editor.getByRole("button", { name: "Overlay 1", exact: true }).click();
  const panelBeforeLayer = structuredClone(pair.publicDocument.parts[0].interaction.panels[0]);
  uploadDimensions = { width: 150, height: 100 };
  await editor.getByLabel("Replace image", { exact: true }).setInputFiles({ name: "decoration.png", mimeType: "image/png", buffer: images.overlay });
  await expect(editor.getByRole("button", { name: "Save Draft", exact: true })).toBeEnabled();
  const savesBeforeLayer = saves;
  await editor.getByRole("button", { name: "Save Draft", exact: true }).click(); await expect.poll(() => saves).toBe(savesBeforeLayer + 1);
  assert.deepEqual(pair.publicDocument.parts[0].interaction.panels[0].surface, panelBeforeLayer.surface);
  assert.deepEqual(pair.publicDocument.parts[0].interaction.panels[0].dropTargets, panelBeforeLayer.dropTargets);
}
