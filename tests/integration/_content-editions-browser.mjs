import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createBuilderEditionHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-editions.js";
import { requireBuilderUser, hashBuilderToken } from "../../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { localPlaywrightLaunchOptions } from "../../scripts/android-teacher/playwright-launch-options.mjs";
import { contentEditionStorage } from "../fixtures/content-edition-storage.js";

export async function exerciseContentEditionBrowser({ sql, pool, actor }) {
  const token = randomBytes(32).toString("hex");
  await pool.query("insert into builder_sessions(builder_user_id,token_hash,expires_at) values($1,$2,now()+interval '10 minutes')", [actor, hashBuilderToken(token)]);
  const root = path.resolve("dist-netlify/ultimate-b2-builder");
  const records = (await pool.query("select record from book_content_source_revisions where revision=1")).rows.map(({ record }) => record);
  const storage = await contentEditionStorage(records, root);
  const handler = createBuilderEditionHandler({ getDatabase: () => sql, storage: () => storage });
  const handlerContext = { cloudflare: { staticAssets: { async fetch(request) {
    const pathname = new URL(request.url).pathname;
    assert(pathname.startsWith("/page-library/ultimate-b2/ultimate-b2-students-book/"));
    return new Response(await readFile(path.join(root, pathname)), { headers: { "Content-Type": "image/png" } });
  } } } };
  const writes = []; const errors = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/builder/api/")) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const event = { path: url.pathname, httpMethod: req.method, headers: req.headers,
          queryStringParameters: Object.fromEntries(url.searchParams), body: Buffer.concat(chunks).toString("utf8") };
        if (req.method === "POST") writes.push({ path: url.pathname, body: JSON.parse(event.body) });
        const result = url.pathname === "/builder/api/auth"
          ? await requireBuilderUser(event, sql).then((auth) => auth.error || ({ statusCode: 200, body: JSON.stringify({ authenticated: true, builderUser: auth.builderUser }) }))
          : url.pathname.includes("/publication/editions/") ? await handler(event, handlerContext)
            : { statusCode: 404, body: "{}" };
        res.writeHead(result.statusCode, result.headers || { "Content-Type": "application/json" });
        res.end(result.isBase64Encoded ? Buffer.from(result.body, "base64") : result.body); return;
      }
      const file = path.resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
      if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(404); res.end(); return; }
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };
      const bytes = await readFile(file); res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }); res.end(bytes);
    } catch (error) { errors.push(error.message); res.writeHead(500); res.end("{}"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(localPlaywrightLaunchOptions());
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: "hh_builder_session", value: token, url: origin }]);
    const page = await context.newPage(); const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${origin}/#/books/ultimate-b2`);
    const selector = page.getByLabel("Content edition", { exact: true });
    await expect(selector).toHaveValue("");
    await selector.selectOption("greek");
    await expect(page.getByRole("heading", { name: /Ultimate B2 · Greek/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare Greek candidate" })).toBeEnabled();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Component", { exact: true }).selectOption("ultimate-b2-workbook");
    await expect(page.getByText(/Shared source — edits affect future candidates/)).toBeVisible();
    await page.getByLabel("Page label", { exact: true }).fill("Browser unsaved source edit");
    page.once("dialog", (dialog) => dialog.dismiss());
    await selector.selectOption("international");
    await expect(selector).toHaveValue("greek");
    await expect(page.getByLabel("Page label", { exact: true })).toHaveValue("Browser unsaved source edit");
    await page.getByRole("button", { name: "Save source revision", exact: true }).click();
    await expect(page.getByText("Saved revision 3", { exact: true })).toBeVisible();
    assert.equal(writes.length, 1); assert(writes[0].path.endsWith("/editions/greek/save-source"));
    assert.equal(writes[0].body.scope.kind, "shared");
    await selector.selectOption("international");
    await expect(page.getByRole("heading", { name: /Ultimate B2 · International/ })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Component", { exact: true }).selectOption("ultimate-b2-workbook");
    await expect(page.getByLabel("Page label", { exact: true })).toHaveValue("Browser unsaved source edit");
    await page.getByRole("button", { name: "Review immutable release 1", exact: true }).click();
    await expect(page.getByRole("heading", { name: "International · Release 1 · Immutable" })).toBeVisible();
    await page.getByLabel("Review component", { exact: true }).selectOption("ultimate-b2-workbook");
    await expect(page.getByLabel("Review page", { exact: true })).toHaveText("shared workbook");
    await expect.poll(() => page.locator(".edition-review-page img").evaluate((img) => img.complete && img.naturalWidth === 1)).toBe(true);
    await page.getByRole("button", { name: "Edition fixture activity", exact: true }).click();
    await expect(page.getByText("Explain question 1.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Associate selected source", exact: true }).click();
    await expect(page.getByRole("button", { name: "Prepare International candidate", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Prepare International candidate", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review immutable release 2", exact: true })).toBeVisible({ timeout: 60000 });
    assert(storage.uploads >= 110);
    await page.getByRole("button", { name: "Publish release 2", exact: true }).click();
    await expect(page.getByText("Release 2 · Published", { exact: true })).toBeVisible();
    const heads = (await pool.query("select edition_id,revision from book_content_edition_heads order by edition_id")).rows;
    assert.deepEqual(heads.map(({ edition_id, revision }) => [edition_id, Number(revision)]), [["greek", 1], ["international", 2]]);
    // Every request uses the verified release/edition route, never a draft read.
    assert.equal(writes.length, 4);
    assert.deepEqual(pageErrors, []);
    const anonymous = await fetch(`${origin}/builder/api/publication/editions/books/ultimate-b2/editions/greek`);
    assert.equal(anonymous.status, 401);
    await context.close();
    assert.deepEqual(errors, []);
    console.log("Edition browser: real Builder authentication, PostgreSQL source save, shared propagation, dirty cancellation and immutable review passed.");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
