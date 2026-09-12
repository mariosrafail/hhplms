import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import pg from "pg";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { applyCanonicalProductionMigrations } from "../../tests/integration/_migration-test-helpers.mjs";
import { clientSql } from "../../tests/integration/_b1-page-placement-regression.mjs";
import { createBuilderNativeActivitiesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js";
import { createBuilderTeacherUiAssetsHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import { resolveBuilderContentResource } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { loadBuilderComponentDocument } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-store.js";

assert.equal(process.env.TEST_DATABASE_CONFIRMATION, "isolated-test-database");
const url = new URL(process.env.TEST_DATABASE_URL); assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
const schema = `overview_browser_${randomBytes(8).toString("hex")}`, admin = new pg.Pool({ connectionString: url.href, max: 1 });
await admin.query(`create schema "${schema}"`); url.searchParams.set("options", `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.href, max: 2 }), sql = clientSql(pool);
let server, browser;
try {
  await applyCanonicalProductionMigrations(pool);
  const actor = randomUUID(); await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Local font fixture',$2,'synthetic')", [actor, `${actor}@example.test`]);
  const objects = new Map(), uploads = new Map();
  const storage = { bucket: () => "private-test", signedPutUrl: async (input) => { const id = randomUUID(); uploads.set(id, input); return { url: `/local-font-upload/${id}`, headers: { "Content-Type": "font/ttf" } }; },
    head: async ({ objectKey }) => { const value = objects.get(objectKey); assert.ok(value); return { byteSize: value.length, contentType: "font/ttf", checksumSha256: createHash("sha256").update(value).digest("hex") }; },
    download: async ({ objectKey }) => objects.get(objectKey), upload: async ({ objectKey, body }) => objects.set(objectKey, Buffer.from(body)), delete: async ({ objectKey }) => objects.delete(objectKey) };
  const dependencies = { getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }), storage: () => storage };
  const native = createBuilderNativeActivitiesHandler(dependencies), ui = createBuilderTeacherUiAssetsHandler(dependencies);
  let saves = 0;
  const fixtureMiddleware = async (request, response, next) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (!pathname.startsWith("/builder/api/") && !pathname.startsWith("/local-font-upload/")) return next();
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = Buffer.concat(chunks);
      if (pathname.startsWith("/local-font-upload/")) { const input = uploads.get(pathname.split("/").at(-1)); assert.ok(input); objects.set(input.objectKey, body); response.writeHead(200); response.end(); return; }
      const event = { path: pathname, httpMethod: request.method, headers: request.headers, body: body.toString("utf8") };
      let result;
      if (pathname.startsWith("/builder/api/native-activities/")) result = await native(event);
      else if (pathname.startsWith("/builder/api/ui-assets/")) { result = await ui(event); if (result.statusCode === 200) saves++; }
      else {
        const match = pathname.match(/\/books\/([^/]+)\/components\/([^/]+)\/ui-controller$/); assert.ok(match);
        const resource = await resolveBuilderContentResource(match[1], match[2], "ui-controller");
        const stored = await loadBuilderComponentDocument(sql, resource);
        result = { statusCode: 200, body: JSON.stringify({ ...resource, revision: stored?.revision || 0, document: stored?.document || resource.baseline() }) };
      }
      response.writeHead(result.statusCode, { "Content-Type": "application/json", ...result.headers }); response.end(result.isBase64Encoded ? Buffer.from(result.body, "base64") : result.body);
    } catch (error) { console.error(error); response.writeHead(500); response.end("Local fixture failed"); }
  };
  server = await createServer({ configFile: false, plugins: [react(), { name: "local-font-api", configureServer(instance) { instance.middlewares.use(fixtureMiddleware); } }], optimizeDeps: { entries: ["scripts/book-builder/overview-managed-font-fixture.html"] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}scripts/book-builder/overview-managed-font-fixture.html`);
  const fontBytes = Buffer.from(await readFile("tests/fixtures/fonts/Ahem.ttf.base64", "utf8"), "base64");
  const select = () => page.getByLabel("Page overview captions font", { exact: true });
  const uiView = async () => { await page.getByRole("button", { name: "Overview selector", exact: true }).click(); await page.getByRole("button", { name: "Shell / Background", exact: true }).click(); await select().waitFor(); };
  const activityView = async () => { await page.getByRole("button", { name: "Activity selector", exact: true }).click(); await page.getByLabel("Answer font", { exact: true }).waitFor(); };
  const allAssets = [];
  for (const book of ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"]) {
    await page.getByRole("button", { name: book, exact: true }).click(); await activityView();
    await expect(page.getByLabel("Answer font", { exact: true }).locator("option")).toHaveCount(1);
    // Existing activity control -> real shared prepare/PUT/finalize -> UI list.
    await page.locator('input[accept=".ttf,font/ttf"]').setInputFiles({ name: "Activity-Ahem.ttf", mimeType: "font/ttf", buffer: fontBytes });
    await expect(page.getByLabel("Answer font", { exact: true })).toHaveValue(/^font-/);
    const activitySlot = await page.getByLabel("Answer font", { exact: true }).inputValue();
    let slot = activitySlot;
    await uiView(); await expect(select().locator(`option[value="${slot}"]`)).toHaveCount(1);
    for (const previous of allAssets) assert.equal(await select().locator(`option[value="${previous}"]`).count(), 0);
    const before = saves;
    await page.locator('input[accept=".ttf,font/ttf"]').setInputFiles({ name: "Overview-Ahem.ttf", mimeType: "font/ttf", buffer: Buffer.concat([fontBytes, Buffer.alloc(4)]) });
    await expect(select()).toHaveValue(/^font-/);
    slot = await select().inputValue(); assert.notEqual(slot, activitySlot, "UI upload creates its own shared-library asset");
    assert.equal(saves, before, "upload selects and marks dirty without Save");
    await page.getByRole("button", { name: "Save UI draft", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    assert.equal(saves, before + 1);
    const stored = (await pool.query("select d.payload from builder_component_documents d join book_components c on c.id=d.book_component_id where c.slug=$1 and d.document_type='teacher_ui'", [`${book}-students-book`])).rows[0].payload;
    assert.equal(stored.overviewCaptionFontAsset.slot, slot); assert.equal(Object.hasOwn(stored, "overviewCaptionFontFamily"), false);
    await activityView(); await expect(page.getByLabel("Answer font", { exact: true }).locator(`option[value="${slot}"]`)).toHaveCount(1);
    assert.equal((await pool.query("select count(*)::int count from book_assets a join book_components c on c.id=a.book_component_id where c.slug=$1 and a.asset_role='activity_font'", [`${book}-students-book`])).rows[0].count, 2, "activity selector reuses the new UI asset without uploading it again");
    await uiView(); await expect(select()).toHaveValue(slot);
    for (const value of ["Arial", "Georgia", "Verdana", "", slot]) {
      await select().selectOption(value); await page.getByRole("button", { name: "Save UI draft", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await activityView(); await uiView(); await expect(select()).toHaveValue(value);
    }
    // Reupload identical bytes through the other control: no third asset.
    await activityView();
    await page.locator('input[accept=".ttf,font/ttf"]').setInputFiles({ name: "Overview-again.ttf", mimeType: "font/ttf", buffer: Buffer.concat([fontBytes, Buffer.alloc(4)]) });
    await expect(page.getByLabel("Answer font", { exact: true })).toHaveValue(slot);
    assert.equal((await pool.query("select count(*)::int count from book_assets a join book_components c on c.id=a.book_component_id where c.slug=$1 and a.asset_role='activity_font'", [`${book}-students-book`])).rows[0].count, 2);
    await uiView();
    allAssets.push(activitySlot, slot);
  }
  await mkdir("artifacts/overview-managed-font", { recursive: true }); await page.screenshot({ path: "artifacts/overview-managed-font/controller.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Managed font browser: real PostgreSQL shared library, both upload controls, auto-selection/no auto-save, deduplication, isolation and all selection transitions passed for B1/B1+/B2.");
} finally {
  await browser?.close(); await server?.close(); await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end();
}
