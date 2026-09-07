import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { currentExtrasFixture, extrasRoute, responseJson } from "../../tests/integration/_students-book-current-extras-fixture.mjs";
import media from "../../tests/fixtures/students-book-synthetic-media.json" with { type: "json" };
import { localPlaywrightLaunchOptions } from "../android-teacher/playwright-launch-options.mjs";

const cleanup = [];
const f = await currentExtrasFixture({ after: (callback) => cleanup.unshift(callback) });
let browser; let server;
try {
  const managedId = await f.addManaged(); const canonicalId = (await f.catalog()).pages.find((page) => page.unitNumber === 3).id;
  for (const unit of [3, 10]) for (const kind of ["videos", "audios"]) await f.attach(unit, kind);
  const bundle = await build({ entryPoints: ["tests/fixtures/students-book-extras-browser.jsx"], bundle: true, write: false, outdir: "out", format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, alias: { "virtual:component-publication": path.resolve("tests/fixtures/students-book-extras-preview-provider.js") }, loader: { ".png": "dataurl", ".svg": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" } });
  const script = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
  let failRead = false; let failSave = false; let failUpload = false; let delayRead = null;
  const config = { managedId, canonicalId, authorization: `v2.${Buffer.from("isolated-extras").toString("base64url")}.${"a".repeat(43)}` };
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/app.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(script); return; }
      if (url.pathname === "/app.css") { response.writeHead(200, { "Content-Type": "text/css" }); response.end(css); return; }
      if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end(`<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.extrasFixture=${JSON.stringify(config)}</script><script type="module" src="/app.js"></script></body></html>`); return; }
      if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const pathname = url.pathname.startsWith("/preview/") ? `/builder${url.pathname}` : url.pathname;
      const event = f.event(pathname, request.method); event.body = Buffer.concat(chunks).toString("utf8"); event.queryStringParameters = Object.fromEntries(url.searchParams);
      let result;
      if (pathname.startsWith(extrasRoute("pages"))) {
        if (delayRead) { const wait = delayRead; delayRead = null; await wait; }
        result = failRead ? { statusCode: 503, body: '{"error":"simulated_page_catalog_failure"}' } : await f.pages(event);
      } else if (pathname.startsWith(extrasRoute("content"))) result = await f.content(event);
      else if (pathname.startsWith(extrasRoute("unit-extras"))) result = (failSave && pathname.endsWith("/save") || failUpload && pathname.endsWith("/prepare")) ? { statusCode: 503, body: '{"error":"simulated_save_or_upload_failure"}' } : await f.extras(event);
      else if (pathname.startsWith("/builder/preview/content/")) result = await f.preview(event);
      else if (pathname.startsWith("/builder/preview/unit-extras/")) {
        // Authenticated synthetic preview; bytes were finalized by the real handler.
        const id = pathname.match(/assets\/([^/]+)\/preview$/)?.[1];
        const row = (await f.pool.query("select object_key,mime_type from book_assets where id=$1", [id])).rows[0];
        const bytes = await f.storage.download({ objectKey: row.object_key }); response.writeHead(200, { "Content-Type": row.mime_type, "Content-Length": bytes.length }); response.end(bytes); return;
      } else result = { statusCode: 404, body: "{}" };
      response.writeHead(result.statusCode, { "Content-Type": "application/json", ...result.headers }); response.end(result.body);
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch(localPlaywrightLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient"); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const edit = async (unit, category) => { await page.getByRole("button", { name: `Edit Unit ${unit} ${category}`, exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByText("Loading Unit Extras", { exact: false })).toHaveCount(0); };
  const close = () => page.getByRole("button", { name: "Close dialog", exact: true }).click();
  for (const [unit, id] of [[3, canonicalId], [10, managedId]]) {
    for (const category of ["videos", "audios"]) {
      await edit(unit, category);
      const labels = page.locator(".unit-extra-page-visibility input");
      await expect(labels).toHaveCount((await f.catalog()).pages.filter((entry) => entry.unitNumber === unit).length);
      await page.locator(`.unit-extra-page-visibility input[data-page-id="${id}"]`).check();
      await page.getByRole("button", { name: "Save Unit Extras", exact: true }).click(); await expect(page.getByText("Unit Extras saved.", { exact: true })).toBeVisible();
      await close(); await edit(unit, category); await expect(page.locator(`input[data-page-id="${id}"]`)).toBeChecked(); await close();
    }
    await page.getByRole("button", { name: `Saved Draft Unit ${unit}`, exact: true }).click();
    await expect(page.getByRole("button", { name: "Extra Videos", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Extra Audio", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Extra Videos", exact: true }).click();
    await page.getByRole("menuitem").click(); await expect(page.locator("video")).toHaveJSProperty("readyState", 4);
    await page.getByRole("button", { name: "Close Extra Video", exact: true }).click();
  }
  await edit(3, "videos"); failSave = true; await page.locator(`input[data-page-id="${canonicalId}"]`).uncheck();
  await page.getByRole("button", { name: "Save Unit Extras", exact: true }).click(); await expect(page.getByText("simulated_save_or_upload_failure", { exact: false })).toBeVisible();
  await expect(page.locator(`input[data-page-id="${canonicalId}"]`)).not.toBeChecked(); failSave = false;
  await close(); await edit(3, "videos");
  const savedBeforeUpload = (await f.read()).document;
  failUpload = true;
  await page.locator('input[type="file"][accept="video/mp4,.mp4"]').setInputFiles({ name: "synthetic.mp4", mimeType: "video/mp4", buffer: Buffer.from(media.files["color.mp4"].base64, "base64") });
  await expect(page.getByText("simulated_save_or_upload_failure", { exact: false })).toBeVisible();
  assert.deepEqual((await f.read()).document, savedBeforeUpload);
  await expect(page.locator(`input[data-page-id="${canonicalId}"]`)).toBeChecked(); failUpload = false;
  await close(); failRead = true; await edit(10, "videos"); await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("button", { name: "Save Unit Extras", exact: true })).toBeDisabled();
  await expect(page.getByText("No active Pages in this Unit.")).toHaveCount(0); failRead = false; await close();
  let releaseRead; delayRead = new Promise((resolve) => { releaseRead = resolve; });
  await page.getByRole("button", { name: "Edit Unit 3 videos", exact: true }).click();
  await page.evaluate(() => window.selectExtrasFixture({ unit: { unitNumber: 10, title: "Unit 10" }, category: "audios" }));
  await expect(page.locator(`input[data-page-id="${managedId}"]`)).toBeVisible(); releaseRead();
  await expect(page.locator(`input[data-page-id="${canonicalId}"]`)).toHaveCount(0);
  if (process.env.SB_EXTRAS_SCREENSHOT_DIR) { await mkdir(process.env.SB_EXTRAS_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SB_EXTRAS_SCREENSHOT_DIR, "synthetic-extras-unit-10.png") }); }
  assert.deepEqual(errors, []);
  console.log("PASS: actual Extras editor + real PostgreSQL handlers, U3/U10 independent flags, save/reload, real Saved Draft media render, failed reads/saves/uploads and stale selection responses.");
} finally {
  await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve));
  for (const callback of cleanup) await callback();
}
