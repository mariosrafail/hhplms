import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname, sep } from "node:path";
import { Readable } from "node:stream";
import { chromium, expect } from "@playwright/test";
import worker from "../../cloudflare/lms/worker.js";
import { hashToken, sessionCookieName, setSqlForTests } from "../../netlify/functions/_auth-utils.js";
import { lmsCanonicalPageAssetPath } from "../../shared/lmsCanonicalPages.js";
import pageAssets from "../../src/data/ultimate-b2/generated/students-book-page-assets.json" with { type: "json" };

export async function verifyUnifiedStudentsBookBrowser({ pool, sql, actors, book, storageOrigin, r1Assignment, historical, originalBytes }) {
  const root = resolve("dist"); await readFile(resolve(root, "index.html"));
  const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const failures = [];
  const staticFetch = async (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (path === lmsCanonicalPageAssetPath(pageAssets.pages[0])) return new Response(originalBytes, { headers: { "Content-Type": pageAssets.pages[0].mimeType } });
    const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(`${root}${sep}`)) return new Response("Not found", { status: 404 });
    try { return new Response(await readFile(file), { headers: { "Content-Type": types[extname(file)] || "application/octet-stream" } }); }
    catch { return new Response("Not found", { status: 404 }); }
  };
  const server = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const input = new Request(`http://127.0.0.1:${server.address().port}${request.url}`, { method: request.method, headers: request.headers, ...(!["GET", "HEAD"].includes(request.method) ? { body: Buffer.concat(chunks) } : {}) });
      const output = await worker.fetch(input, { ASSETS: { fetch: staticFetch } });
      response.writeHead(output.status, Object.fromEntries(output.headers));
      if (output.body) Readable.fromWeb(output.body).pipe(response); else response.end();
    } catch (error) { failures.push(error.message); response.writeHead(500); response.end("Isolated server error"); }
  });
  const env = { BOOK_ASSET_STORAGE_PROVIDER: "s3", BOOK_ASSET_S3_ENDPOINT: storageOrigin, BOOK_ASSET_S3_REGION: "auto", BOOK_ASSET_S3_ACCESS_KEY_ID: "isolated-test", BOOK_ASSET_S3_SECRET_ACCESS_KEY: "isolated-test", BOOK_ASSET_PUBLIC_BUCKET: "synthetic-public", BOOK_ASSET_PRIVATE_BUCKET: "synthetic-private", BOOK_ASSET_ARCHIVE_BUCKET: "synthetic-archive", BOOK_ASSET_PUBLIC_BASE_URL: `${storageOrigin}/synthetic-public` };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env); setSqlForTests(sql);
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const api = (action, params = {}) => `${origin}/.netlify/functions/book-content?${new URLSearchParams({ action, ...params })}`;
    browser = await chromium.launch({ headless: true });
    const login = async (user) => {
      const token = randomBytes(32).toString("hex");
      await pool.query("insert into auth_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 hour')", [user.id, hashToken(token)]);
      const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
      context.setDefaultTimeout(10_000);
      await context.addCookies([{ name: sessionCookieName, value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
      return context;
    };
    const teacher = await login(actors.teacher); const student = await login(actors.student);
    const managed = book.pages.find((page) => page.id.startsWith("sb-page-"));
    const target = managed.hotspots[0].target;
    const treeResponse = await student.request.get(api("tree", { packageId: book.packageId }));
    assert.equal(treeResponse.status(), 200);
    const tree = (await treeResponse.json()).bookPackage;
    assert.deepEqual(tree.components.map((component) => component.slug), [book.componentSlug, "ultimate-b2-workbook"]);
    assert.equal(tree.components[0].legacyDiscoveryAllowed, false);
    assert.deepEqual(tree.components[0].units, []);
    const catalogPage = await student.newPage();
    catalogPage.on("pageerror", (error) => failures.push(error.message));
    await catalogPage.goto(`${origin}/#/courses/ultimate-b2/components`);
    const cards = catalogPage.locator(".book-component-card");
    await expect(cards).toHaveCount(2);
    const studentsCard = cards.filter({ hasText: tree.components[0].title });
    await expect(studentsCard).toContainText("Open published Interactive");
    await studentsCard.getByRole("button").first().click();
    const interactive = catalogPage.locator('[data-book-mode="practice"]');
    await expect(interactive).toHaveAttribute("data-release-id", book.releaseId);
    await interactive.locator(".published-book-controls select").nth(1).selectOption(managed.id);
    await expect(interactive.locator(".published-book-controls select").nth(1)).toHaveValue(managed.id);
    const [activityResponse] = await Promise.all([
      catalogPage.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.searchParams.get("action") === "published-book-activity" && url.searchParams.get("releaseId") === book.releaseId && url.searchParams.get("activityId") === target.nativeActivityId;
      }),
      interactive.locator(".published-page-hotspots").getByRole("button", { name: managed.hotspots[0].title, exact: true }).click(),
    ]);
    assert.equal(activityResponse.status(), 200);
    await expect(interactive.getByRole("textbox").first()).toBeEditable();
    await expect(interactive).not.toContainText("R2 Unit 10 protected model");
    // A malformed/missing published target must never revive a recovered exercise.
    // Change only this browser response; the immutable release stays untouched.
    await catalogPage.route("**/.netlify/functions/book-content?action=published-books", async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      const published = payload.books.find((entry) => entry.componentSlug === book.componentSlug);
      const hotspot = published.pages.find((entry) => entry.id === managed.id).hotspots[0];
      hotspot.target = null;
      hotspot.activityId = "ultimate-b2-sb-u1-p1-o1";
      await route.fulfill({ response, json: payload });
    });
    await catalogPage.reload();
    await expect(interactive).toHaveAttribute("data-release-id", book.releaseId);
    await interactive.locator(".published-book-controls select").nth(1).selectOption(managed.id);
    await interactive.locator(".published-page-hotspots").getByRole("button", { name: managed.hotspots[0].title, exact: true }).click();
    await expect(interactive.getByRole("alert")).toHaveText("This activity is unavailable in this view.");
    await expect(interactive.getByRole("textbox")).toHaveCount(0);
    await catalogPage.goto(`${origin}/#/courses/ultimate-b2/components/${book.componentSlug}/pages/sb-page-${"0".repeat(32)}`);
    await expect(catalogPage.getByRole("alert")).toHaveText("This page is not available in the published book.");
    await catalogPage.close();
    const imageUrl = api("published-release-asset", { bookSlug: book.bookSlug, componentSlug: book.componentSlug, releaseId: book.releaseId, sha256: managed.image.sha256, extension: managed.image.extension });
    assert.equal((await fetch(imageUrl)).status, 401);
    const imageResponse = await student.request.get(imageUrl); assert.equal(imageResponse.status(), 200, await imageResponse.text());
    assert.equal(imageResponse.headers()["cross-origin-resource-policy"], "same-origin");
    const unentitled = (await pool.query("insert into app_users(school_id,full_name,role,status) values($1,'Unentitled synthetic learner','student','active') returning id", [actors.teacher.school_id])).rows[0];
    const outsider = await login(unentitled);
    assert.equal((await outsider.request.get(imageUrl)).status(), 403);
    const teacherQuery = { bookSlug: book.bookSlug, componentSlug: book.componentSlug, releaseId: book.releaseId, activityId: target.nativeActivityId };
    assert.equal((await student.request.get(api("published-native-teacher", teacherQuery))).status(), 403);
    assert.equal((await teacher.request.get(api("published-native-teacher", teacherQuery))).status(), 200);
    const forged = await teacher.request.post(api("create-assignment"), { data: { target: { ...target, locator: { ...target.locator, hotspotId: "wrong-hotspot" } }, classIds: [actors.classId], idempotencyKey: randomUUID() } });
    assert.equal(forged.status(), 409);
    assert.equal((await forged.json()).code, "publication_locator_mismatch");
    const page = await teacher.newPage(); page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(`${origin}/#/teacher/assignments`);
    const picker = page.getByRole("region", { name: "Choose exercises from published pages" });
    await picker.locator(":scope > label > select").selectOption(book.componentSlug);
    await picker.locator(".published-book-controls select").nth(1).selectOption(managed.id);
    await expect.poll(() => picker.locator(".published-page > img").evaluate((image) => image.naturalWidth)).toBe(480);
    await picker.locator(".published-page-hotspots button").first().click();
    const before = (await pool.query("select count(*)::int count from activity_submissions")).rows[0].count;
    await picker.getByRole("button", { name: "Preview exercise", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("R2 Unit 10 prompt");
    await page.getByRole("button", { name: "Close preview", exact: true }).click();
    assert.equal((await pool.query("select count(*)::int count from activity_submissions")).rows[0].count, before);
    const created = await teacher.request.post(api("create-assignment"), { data: { title: "V3 browser acceptance", target, classIds: [actors.classId], idempotencyKey: randomUUID() } });
    assert.equal(created.status(), 200, await created.text()); const assignment = (await created.json()).assignment;
    const studentPage = await student.newPage(); studentPage.on("pageerror", (error) => failures.push(error.message));
    await studentPage.goto(`${origin}/#/student/assignments/${assignment.id}`);
    await expect(studentPage.locator('[data-book-mode="assigned"]')).toHaveAttribute("data-release-id", book.releaseId);
    await expect.poll(() => studentPage.locator(".published-page > img").evaluate((image) => image.naturalWidth)).toBe(480);
    await studentPage.getByRole("textbox").first().fill("Browser v3 persisted response");
    await studentPage.getByRole("button", { name: "Submit assignment", exact: true }).click();
    await studentPage.getByRole("button", { name: "Submit final answers", exact: true }).click();
    await expect(studentPage.getByRole("button", { name: "Submit assignment", exact: true })).toHaveCount(0);
    await studentPage.reload();
    await expect(studentPage.getByRole("textbox").first()).toHaveValue("Browser v3 persisted response");
    await expect(studentPage.getByRole("textbox").first()).not.toBeEditable();
    const evidence = process.env.PUBLISHED_BOOK_EVIDENCE_DIR || "/tmp/published-book-evidence"; await mkdir(evidence, { recursive: true });
    await studentPage.locator(".app-intro-overlay").waitFor({ state: "hidden" });
    await studentPage.screenshot({ path: `${evidence}/students-book-v3-submit-reload.png`, fullPage: true });
    await page.goto(`${origin}/#/teacher/assignments/${assignment.id}/review`);
    await expect(page.locator(".teacher-review-responses")).toContainText("Browser v3 persisted response");
    await expect(page.locator(".teacher-review-responses")).toContainText("R2 Unit 10 protected model");
    await page.getByLabel("Teacher score (0–100)", { exact: true }).fill("93");
    await page.getByLabel("Student-visible feedback").fill("Browser Teacher review retained");
    const [savedReview] = await Promise.all([page.waitForResponse((response) => response.url().includes("action=review-submission") && response.request().method() === "POST"), page.getByRole("button", { name: "Save review", exact: true }).click()]);
    assert.equal(savedReview.status(), 200, await savedReview.text());
    await page.reload();
    await expect(page.getByLabel("Teacher score (0–100)", { exact: true })).toHaveValue("93");
    await expect(page.getByLabel("Student-visible feedback")).toHaveValue("Browser Teacher review retained");
    const reviewed = (await pool.query("select score_percent,teacher_feedback,status from activity_submissions where activity_assignment_id=$1", [assignment.id])).rows[0];
    assert.equal(Number(reviewed.score_percent), 93); assert.equal(reviewed.teacher_feedback, "Browser Teacher review retained"); assert.equal(reviewed.status, "reviewed");
    await page.locator(".app-intro-overlay").waitFor({ state: "hidden" });
    await page.screenshot({ path: `${evidence}/students-book-v3-teacher-review.png`, fullPage: true });
    await studentPage.goto(`${origin}/#/student/assignments/${r1Assignment.id}`);
    await expect(studentPage.locator('[data-book-mode="assigned"]')).toHaveAttribute("data-release-id", historical.id);
    await expect(studentPage.getByRole("textbox").first()).toHaveValue("R1 retained learner answer");
    await expect.poll(() => studentPage.locator(".published-page > img").evaluate((image) => image.naturalWidth)).toBe(pageAssets.pages[0].width);
    await studentPage.locator(".app-intro-overlay").waitFor({ state: "hidden" });
    await studentPage.screenshot({ path: `${evidence}/students-book-r1-after-v3.png`, fullPage: true });
    assert.equal((await outsider.request.get(api("student-assignment", { assignmentId: assignment.id }))).status(), 404);
    assert.equal((await fetch(`${origin}${lmsCanonicalPageAssetPath(pageAssets.pages[0])}`)).status, 404);
    await pool.query("delete from book_access where user_id=$1 and book_package_id=$2", [actors.student.id, book.packageId]);
    assert.equal((await student.request.get(imageUrl)).status(), 403);
    assert.deepEqual(failures, []);
    console.log("STUDENTS_BOOK_V3_BROWSER immutable pages, preview, Submit/reload, Teacher review, R1 history and authorization passed.");
  } finally {
    await browser?.close(); await new Promise((resolve) => server.close(resolve)); setSqlForTests(null);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
