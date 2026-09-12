import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";

const phase = process.argv.includes("--before") ? "before" : "after";
const directory = path.resolve("artifacts/overview-appearance", phase);
await mkdir(directory, { recursive: true });
const server = await createServer({ configFile: false, optimizeDeps: { entries: ["scripts/book-builder/overview-appearance-fixture.html"] }, plugins: [react()], server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${server.resolvedUrls.local[0]}scripts/book-builder/overview-appearance-fixture.html`);
    await page.waitForFunction(() => typeof window.renderOverview === "function");
    for (const bookSlug of ["ultimate-b2", "ultimate-b1", "ultimate-b1-plus"]) for (const component of ["students-book", "workbook", "grammar-book"]) for (const dense of [false, true]) {
      if (bookSlug === "ultimate-b2" && component === "students-book" && dense) continue;
      await page.evaluate(async (input) => { window.renderOverview(input); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }, { bookSlug, component, dense });
      await page.waitForFunction((component) => document.querySelector("[data-overview-book]")?.dataset.overviewBook === component, component);
      await page.locator(".teacher-unit-page-thumb img").first().waitFor();
      await page.locator(".teacher-unit-page-thumb img").evaluateAll((images) => Promise.all(images.map((image) => image.decode().catch(() => {}))));
      const metrics = await page.locator(".teacher-unit-page-card").evaluateAll((cards) => cards.map((card) => ({
        id: card.dataset.pageIds, row: card.dataset.overviewRow,
        label: card.querySelector("strong")?.textContent, pageLabel: card.querySelector("b").textContent,
        card: card.getBoundingClientRect().toJSON(),
        images: [...card.querySelectorAll("img")].map((image) => ({ ...image.getBoundingClientRect().toJSON(), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight })),
      })));
      const name = `${bookSlug}-${component}-${dense ? "dense" : "sparse"}-${viewport.width}`;
      await page.screenshot({ path: path.join(directory, `${name}.png`) });
      results.push({ name, metrics });
      if (phase === "after") {
        for (const row of ["1", "2"]) {
          const heights = metrics.filter((card) => card.row === row).flatMap((card) => card.images.map((image) => image.height));
          assert.ok(Math.max(...heights) - Math.min(...heights) < 1, `${name}: equal single/spread image height per row`);
        }
        for (const card of metrics) for (const image of card.images) {
          assert.ok(image.naturalWidth > 0, `${name}: image loaded`);
          assert.ok(Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight) < 0.02, `${name}: intrinsic ratio`);
          assert.ok(image.right <= card.card.right + 1 && image.bottom <= card.card.bottom + 1, `${name}: image stays within card`);
        }
        if (bookSlug !== "ultimate-b2" || component !== "students-book") assert.equal(metrics[0].label, "Section 1");
      }
    }
  }
  if (phase === "after") {
    await page.route("**/preview/ui-assets-v2/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#315f82"/></svg>' }));
    const toolbarFont = await page.locator(".classroom-teaching-toolbar").evaluate((node) => getComputedStyle(node).fontFamily);
    for (const [bookIndex, bookSlug] of ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"].entries()) {
      const ui = { schemaVersion: "1.0", packageId: `${bookSlug}-students-book`, independentPartsBackgrounds: true, overviewCaptionFontFamily: "Georgia", assets: Object.fromEntries(["students-book", "workbook", "grammar-book"].map((id, i) => [`background.${id}-parts`, { sha256: "abcdef123"[bookIndex * 3 + i].repeat(64), extension: "png", mediaType: "image/png", sizeBytes: 100, width: 10, height: 10 }])) };
      for (const component of ["students-book", "workbook", "grammar-book", "students-book"]) {
        await page.evaluate(async (input) => { window.renderOverview(input); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }, { bookSlug, component, ui });
        const background = await page.locator(".teacher-offline-unit-overview").evaluate((node) => getComputedStyle(node).backgroundImage);
        assert.ok(background.includes(ui.assets[`background.${component}-parts`].sha256), `${bookSlug}/${component}: selected background after switching`);
        if (bookSlug !== "ultimate-b2") assert.ok(background.includes(`/books/${bookSlug}/`), "background remains package scoped");
        for (const selector of ["strong", "b"]) assert.match(await page.locator(`.teacher-unit-page-copy ${selector}`).first().evaluate((node) => getComputedStyle(node).fontFamily), /Georgia/);
        assert.equal(await page.locator(".classroom-teaching-toolbar").evaluate((node) => getComputedStyle(node).fontFamily), toolbarFont);
      }
      await page.screenshot({ path: path.join(directory, `${bookSlug}-custom-background-and-font.png`) });
    }
    await page.evaluate(async () => { window.renderOverview({ bookSlug: "ultimate-b1" }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    assert.doesNotMatch(await page.locator(".teacher-unit-page-copy strong").first().evaluate((node) => getComputedStyle(node).fontFamily), /Georgia/);
    const firstId = await page.locator(".teacher-unit-page-card").first().getAttribute("data-page-ids");
    await page.locator(".teacher-unit-page-card").first().click();
    assert.equal(await page.evaluate(() => window.selectedPage), firstId);
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(path.join(directory, "measurements.json"), JSON.stringify(results, null, 2));
  await browser.close(); await server.close();
}
console.log(`Overview ${phase}: ${results.length} screenshots and image measurements in ${directory}`);
