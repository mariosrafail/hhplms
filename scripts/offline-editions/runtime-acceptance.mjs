import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import { readPackFile, verifyPackDirectory } from "../../lib/offline-editions/materialize.js";
import { localPlaywrightLaunchOptions } from "../android-teacher/playwright-launch-options.mjs";
import { digest, PACK_WEB_ROOT } from "../../src/data/offline-editions/contract.js";

export async function verifyOfflineEditionRuntime({ webRoot, output }) {
  const { manifest } = await verifyPackDirectory(path.join(webRoot, PACK_WEB_ROOT));
  await fs.mkdir(output, { recursive: true });
  const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".ttf": "font/ttf", ".pdf": "application/pdf" };
  const server = createServer(async (request, response) => {
    try { const url = new URL(request.url, "http://localhost"); const name = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const bytes = await readPackFile(webRoot, name); response.writeHead(200, { "Content-Type": type[path.extname(name)] || "application/octet-stream", "Content-Length": bytes.length }); response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(localPlaywrightLaunchOptions());
  const network = [], errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.route("**/*", (route) => { const url = route.request().url(); network.push(url);
      return url.startsWith(`${origin}/`) ? route.continue() : route.abort("blockedbyclient"); });
    const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    try { await expect(page.locator("[data-page-id]").first()).toBeVisible({ timeout: 120000 }); }
    catch (error) { await page.screenshot({ path: path.join(output, "startup-failure.png") }); throw new Error(`${error.message}\n${await page.locator("body").innerText()}\n${JSON.stringify(errors)}`); }
    await expect(page.getByRole("button", { name: "Vocabulary", exact: true })).toHaveCount(0);
    const sb = manifest.snapshot.members[0], first = sb.projection.pages.find((page) => (sb.projection.activityOrder[page.id] || []).length);
    await page.locator(`[data-page-id="${first.id}"]`).click();
    const vocabulary = page.getByRole("button", { name: "Vocabulary", exact: true }); await expect(vocabulary).toBeEnabled(); await vocabulary.click();
    const dialog = page.getByRole("dialog", { name: "Word List", exact: true }); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Greek", exact: true })).toHaveCount(manifest.selection.editionId === "greek" ? 1 : 0);
    assert((await dialog.textContent()).includes("false")); assert((await dialog.textContent()).includes("true"));
    assert.equal(await dialog.locator("[data-word-list-entry]").count(), sb.wordlist.entries.filter((entry) => sb.wordlist.mappings.some((mapping) => entry.groups.includes(mapping.group) && mapping.pageIds.includes(first.id))).length);
    for (const state of ["active", "pressed", "disabled"]) {
      const source = await vocabulary.locator(`[data-icon-state="${state}"]`).getAttribute("src");
      const response = await context.request.get(source);
      assert.equal(await digest(await response.body()), manifest.snapshot.uiOwner.ui.assets[`navibar.vocabulary.${state}`].sha256);
    }
    const player = page.locator("[data-word-list-overlay] audio"); assert(await player.evaluate((node) => node.paused && !node.getAttribute("src")));
    await page.screenshot({ path: path.join(output, "wordlist-before-controls.png") });
    await dialog.getByRole("button", { name: "Hide all English words" }).click(); await expect(dialog.getByRole("button", { name: "Show all English words" })).toBeVisible();
    await dialog.getByRole("button", { name: "Show all English words" }).click();
    if (manifest.selection.editionId === "greek") {
      await dialog.getByRole("button", { name: "Hide all Greek words" }).click();
      await expect(dialog.getByRole("button", { name: "Hide all English words" })).toBeVisible();
      await dialog.getByRole("button", { name: "Show all Greek words" }).click();
    }
    await dialog.getByRole("button", { name: /Play English pronunciation/ }).first().click();
    await expect.poll(() => player.evaluate((node) => !node.paused && node.currentTime > 0)).toBe(true);
    await page.screenshot({ path: path.join(output, "wordlist.png") });
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect.poll(() => player.evaluate((node) => node.paused && !node.getAttribute("src"))).toBe(true);
    const mountedKinds = [];
    for (const [id, entry] of Object.entries(sb.projection.nativeActivities)) {
      const hotspot = sb.projection.hotspots.pages[first.id].find((item) => item.activityKey === id);
      await page.getByRole("button", { name: hotspot.label, exact: true }).click();
      const activity = page.locator(".teacher-offline-embedded-activity");
      await expect(activity).toHaveAttribute("data-embedded-activity-id", id);
      await expect(activity.locator("[data-native-media-scope]").first()).toBeVisible();
      await activity.evaluate((node) => { node.dataset.offlineIdentity = "same-instance"; });
      const reveal = page.getByRole("button", { name: "Show All", exact: true });
      if (await reveal.isEnabled()) { await reveal.click(); await expect(reveal).toBeDisabled(); }
      if (entry.kind === "open-response") {
        await expect(activity.locator(".native-or-answer-layer").first()).toHaveAttribute("aria-pressed", "true");
        await expect(activity.locator(".native-or-answer-layer").first()).toHaveAttribute("data-font-status", "loaded");
        await page.getByRole("button", { name: "Show Text", exact: true }).click();
        await expect(activity.getByAltText("Synthetic readable passage")).toBeVisible();
      }
      if (entry.kind === "image") {
        const pendingDownload = page.waitForEvent("download");
        await page.getByRole("button", { name: "Open Video Worksheet", exact: true }).click();
        const download = await pendingDownload;
        assert(new URL(download.url()).pathname.startsWith("/assets/"), "Worksheet must satisfy the existing Android PdfSaver asset boundary");
        const worksheet = entry.document.assets.find((asset) => asset.slot === entry.document.video.worksheet.assetSlot);
        const worksheetPath = path.join(output, "worksheet.pdf"); await download.saveAs(worksheetPath);
        assert.equal(await digest(await fs.readFile(worksheetPath)), worksheet.checksumSha256);
        await page.getByRole("button", { name: "Sample answer", exact: true }).click();
        const answer = page.getByAltText("OFFLINE_TEACHER_ANSWER_ONLY"); await expect(answer).toBeVisible();
        await expect.poll(() => answer.evaluate((node) => node.complete && node.naturalWidth > 0)).toBe(true);
        await page.getByRole("button", { name: "Sample answer", exact: true }).click();
        const audio = activity.locator("audio").first();
        await audio.evaluate(async (node) => { node.playbackRate = 0.1; await node.play(); });
        await expect.poll(() => audio.evaluate((node) => node.currentTime)).toBeGreaterThan(0);
        await audio.evaluate((node) => node.pause());
        await page.getByRole("button", { name: "Open activity video", exact: true }).click();
        const video = activity.locator("video"); await expect(video).toBeVisible();
        await video.evaluate(async (node) => { node.playbackRate = 0.1; await node.play(); });
        await expect.poll(() => video.evaluate((node) => node.currentTime)).toBeGreaterThan(0);
        await vocabulary.click(); await expect(dialog).toBeVisible(); await expect.poll(() => video.evaluate((node) => node.paused)).toBe(true);
        await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
        await page.getByRole("button", { name: "Return to questions", exact: true }).click();
        await expect(video).toBeHidden();
      }
      const state = () => activity.evaluate((node) => ({ text: node.innerText, pressed: [...node.querySelectorAll("[aria-pressed]")].map((item) => item.getAttribute("aria-pressed")) }));
      const before = await state();
      await vocabulary.click(); await expect(dialog).toBeVisible(); await dialog.getByRole("button", { name: "Close Word List" }).click(); await expect(dialog).toBeHidden();
      await expect(activity).toHaveAttribute("data-offline-identity", "same-instance"); assert.deepEqual(await state(), before, entry.kind);
      await page.screenshot({ path: path.join(output, `activity-${entry.kind}.png`) }); mountedKinds.push(entry.kind);
      await page.getByRole("button", { name: "Back", exact: true }).click();
    }
    await page.getByRole("button", { name: "Workbook", exact: true }).click(); await page.locator("[data-page-id]").first().click();
    await expect(vocabulary).toBeEnabled(); await vocabulary.click(); await expect(dialog).toBeVisible(); await page.keyboard.press("Escape");
    await page.getByRole("button", { name: Object.values(manifest.snapshot.members[1].projection.hotspots.pages)[0][0].label, exact: true }).click();
    const workbookAnswer = page.locator(".native-or-answer-layer").first(); await workbookAnswer.click(); await expect(workbookAnswer).toHaveAttribute("aria-pressed", "true");
    await vocabulary.click(); await page.keyboard.press("Escape"); await expect(workbookAnswer).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Grammar Book", exact: true }).click(); await page.locator("[data-page-id]").first().click();
    await expect(vocabulary).toHaveCount(0); await page.screenshot({ path: path.join(output, "grammar.png") });
    const grammar = manifest.snapshot.members[2];
    await page.getByRole("button", { name: Object.values(grammar.projection.hotspots.pages)[0][0].label, exact: true }).click();
    await expect(page.locator(".native-or-answer-layer").first()).toBeVisible();
    await page.getByRole("button", { name: "Home", exact: true }).click(); await expect(page.getByRole("heading", { name: "Choose a book" })).toBeVisible();
    await page.getByRole("button", { name: "Students Book", exact: true }).click(); await expect(page.locator("[data-page-id]").first()).toBeVisible();
    assert(network.every((url) => url.startsWith(`${origin}/`)), "External network dependency attempted"); assert.deepEqual(errors, []);
    await context.close();
    const damaged = await browser.newContext({ serviceWorkers: "block" });
    const asset = manifest.assets.find((asset) => asset.role === "wordlist_audio");
    await damaged.route(`**/${PACK_WEB_ROOT}/${asset.path}`, (route) => route.fulfill({ status: 200, body: "corrupted" }));
    const broken = await damaged.newPage(); await broken.goto(origin); await expect(broken.getByRole("alert")).toContainText("missing or damaged", { timeout: 120000 });
    await expect(broken.locator("[data-page-id]")).toHaveCount(0); await damaged.close();
    const result = { status: "passed-extracted-apk-browser", editionId: manifest.selection.editionId, packSha256: manifest.packSha256, requests: network.length,
      externalAttempts: 0, mountedKinds, coldContext: true, collectionServerRequired: false, corruptedAudioFailsClosed: true, androidDeviceTested: false };
    await fs.writeFile(path.join(output, "runtime-receipt.json"), JSON.stringify(result, null, 2)); return result;
  } finally { await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [webRoot, output] = process.argv.slice(2); console.log(await verifyOfflineEditionRuntime({ webRoot, output }));
}
