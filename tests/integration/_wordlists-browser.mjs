import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { requireBuilderUser } from "../../netlify-sites/ultimate-b2-builder/server/_builder-auth.js";
import { createBuilderEditionHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-editions.js";
import { localPlaywrightLaunchOptions } from "../../scripts/android-teacher/playwright-launch-options.mjs";
import { lexicalFixture, testZip, wordListFiles, wordListSha, wordListMp3 } from "../fixtures/wordlists.js";

export async function exerciseWordListBrowser({ sql, token, handler }) {
  const root = path.resolve("dist-netlify/ultimate-b2-builder");
  const editions = createBuilderEditionHandler({ getDatabase: () => sql });
  const writes = []; const errors = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/builder/api/")) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const bytes = Buffer.concat(chunks); const audio = request.headers["content-type"] === "audio/mpeg";
        const event = { path: url.pathname, httpMethod: request.method, headers: request.headers,
          queryStringParameters: Object.fromEntries(url.searchParams), body: bytes.toString(audio ? "base64" : "utf8"), isBase64Encoded: audio };
        if (request.method === "POST") writes.push(url.pathname);
        const result = url.pathname === "/builder/api/auth"
          ? await requireBuilderUser(event, sql).then((auth) => auth.error || { statusCode: 200, body: JSON.stringify({ authenticated: true, builderUser: auth.builderUser }) })
          : url.pathname.includes("/publication/wordlists/") ? await handler(event)
            : url.pathname.includes("/publication/editions/") ? await editions(event) : { statusCode: 404, body: "{}" };
        response.writeHead(result.statusCode, result.headers || { "Content-Type": "application/json" });
        response.end(result.isBase64Encoded ? Buffer.from(result.body, "base64") : result.body); return;
      }
      const file = path.resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
      if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(404); response.end(); return; }
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
      response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }); response.end(await readFile(file));
    } catch (error) { errors.push(error.message); response.writeHead(500); response.end("{}"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`; const browser = await chromium.launch(localPlaywrightLaunchOptions());
  try {
    const context = await browser.newContext(); await context.addCookies([{ name: "hh_builder_session", value: token, url: origin }]);
    const page = await context.newPage(); const pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${origin}/#/books/ultimate-b2`);
    await page.getByLabel("Content edition", { exact: true }).selectOption("greek");
    page.once("dialog", (dialog) => dialog.accept()); await page.getByLabel("Component", { exact: true }).selectOption("ultimate-b2-workbook");
    const area = page.getByRole("region", { name: "Word Lists", exact: true });
    await expect(area.getByLabel("Word List package", { exact: true })).toBeVisible();
    const countBefore = writes.length;
    await area.getByLabel("Word List package", { exact: true }).setInputFiles({ name: "wordlist.zip", mimeType: "application/zip", buffer: testZip(wordListFiles()) });
    await expect(area.getByText(/New: 0 · Changed: 1/)).toBeVisible();
    await expect(area.getByText(/Duplicate original IDs retained: 1/)).toBeVisible();
    assert.equal(writes.length, countBefore, "Selecting a ZIP must not write or upload");
    page.once("dialog", (dialog) => dialog.dismiss()); await page.getByLabel("Content edition", { exact: true }).selectOption("international");
    await expect(page.getByLabel("Content edition", { exact: true })).toHaveValue("greek");
    await area.getByLabel("Pages for work1_1", { exact: true }).selectOption("wb-page-one");
    page.once("dialog", (dialog) => dialog.accept()); await area.getByRole("button", { name: "Confirm Word List import", exact: true }).click();
    await expect(area.getByText("Word List saved. Page readiness is evaluated separately.")).toBeVisible();
    assert.deepEqual(writes.slice(countBefore).map((item) => item.split("/").at(-1).match(/^[a-f0-9-]{36}$/) ? item.split("/").at(-2) : item.split("/").at(-1)), ["begin", "finalize"]);
    await area.getByRole("button", { name: "Edit saved Word List mappings", exact: true }).click();
    await area.getByLabel("Pages for work1_1", { exact: true }).selectOption([]);
    await expect(area.getByText(/Unresolved required groups: 1/)).toBeVisible();
    await area.getByRole("button", { name: "Discard local preview" }).click();
    await area.getByRole("button", { name: "Review Word List draft", exact: true }).click();
    await expect(area.getByRole("region", { name: "Word List data review" }).getByText("ΕΛΛΗΝΙΚΟ_SENTINEL").first()).toBeVisible();
    const audioPath = await area.locator("audio").first().getAttribute("src");
    const audio = await context.request.get(`${origin}${audioPath}`); assert.equal(audio.status(), 200); assert.deepEqual(await audio.body(), wordListMp3);
    await area.getByRole("button", { name: "Prepare edition with Word Lists", exact: true }).click();
    await expect(area.getByRole("button", { name: "Review immutable Word List 2", exact: true })).toBeVisible();
    await area.getByRole("button", { name: "Review immutable Word List 2", exact: true }).click();
    await expect(area.getByRole("heading", { name: "candidate · ready", exact: true })).toBeVisible();
    const immutableAudio = await area.locator("audio").first().getAttribute("src"); assert(immutableAudio.includes("/releases/"));
    assert.equal((await context.request.get(`${origin}${immutableAudio}`)).status(), 200);
    await area.getByRole("button", { name: "Publish Word List edition 2", exact: true }).click();
    await expect(area.getByText("v2 release 2 · Published", { exact: true })).toBeVisible();
    const base = `${origin}/builder/api/publication/wordlists/books/ultimate-b2/editions/international/components/ultimate-b2-workbook/draft`;
    const international = await context.request.get(base); assert.equal(international.status(), 200); assert(!(await international.text()).includes("ΕΛΛΗΝΙΚΟ_SENTINEL"));
    const anonymous = await fetch(`${base}?audioSha256=${wordListSha}`); assert.equal(anonymous.status, 401);
    assert.deepEqual(pageErrors, []); assert.deepEqual(errors, []);
    console.log("Word List browser: real auth, local ZIP preview/no writes, diff, mapping, confirmation, shared source, draft/candidate audio and immutable publication passed.");
    await context.close();
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
