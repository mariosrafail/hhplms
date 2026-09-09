import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "@playwright/test";

// The caller supplies the real Worker, auth, compiled immutable release and
// isolated PostgreSQL. Only the unrelated cover failures are simulated.
export async function verifyWorkbookRouteBrowser({ pool, login, teacherContext, student, origin, book }) {
  const before = (await pool.query("select release_sha256,public_projection_sha256 from book_component_releases where id=$1", [book.releaseId])).rows[0];
  const studentContext = await login(student);
  const [first, second] = book.pages;
  try {
    for (const [role, context] of [["student", studentContext], ["teacher", teacherContext]]) {
      const page = await context.newPage();
      const errors = [], requests = [], coverFailures = new Set();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => requests.push(new URL(request.url())));
      await page.route("**/.netlify/functions/book-content?**", async (route) => {
        const query = new URL(route.request().url()).searchParams;
        if (query.get("action") === "asset-access" && ["ultimate-b2.students-book.cover", "ultimate-b2.workbook.cover"].includes(query.get("logicalKey"))) {
          coverFailures.add(query.get("logicalKey"));
          await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Book asset not found" }) });
        } else await route.continue();
      });
      const prefix = role === "student" ? "/courses" : "/teacher/books";
      const componentRoute = `${prefix}/${book.bookSlug}/components/${book.componentSlug}`;
      const pageRoute = (id) => `${componentRoute}/pages/${id}`;
      await page.goto(`${origin}/#${prefix}/${book.bookSlug}/components`);
      const cards = page.locator(".book-component-card");
      await expect(cards).toHaveCount(2);
      await expect(cards.filter({ hasText: "Grammar Book" })).toHaveCount(0);
      await cards.filter({ hasText: book.componentTitle }).getByRole("button").first().click();
      const surface = page.locator('[data-book-mode="practice"]');
      const selector = surface.locator(".published-book-controls select").nth(1);
      const retained = async (selected, { routed = true } = {}) => {
        if (routed) await expect.poll(() => new URL(page.url()).hash).toBe(`#${pageRoute(selected.id)}`);
        await expect(surface).toHaveAttribute("data-release-id", book.releaseId);
        await expect(page.getByRole("heading", { name: book.componentTitle, exact: true })).toBeVisible();
        await expect(selector).toHaveValue(selected.id);
        await expect.poll(() => surface.locator(".published-page > img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
        await expect(page.locator(".book-component-card")).toHaveCount(0);
      };
      await retained(first, { routed: false });
      await expect.poll(() => [...coverFailures].sort()).toEqual(["ultimate-b2.students-book.cover", "ultimate-b2.workbook.cover"]);
      await surface.getByRole("button", { name: "Next page", exact: true }).click();
      await retained(second);
      await surface.getByRole("button", { name: "Previous page", exact: true }).click();
      await retained(first);
      await selector.selectOption(second.id);
      await retained(second);
      await page.goBack();
      await retained(first);
      await page.goForward();
      await retained(second);
      await page.reload();
      await retained(second);
      const hotspot = second.hotspots[0];
      const activityResponse = page.waitForResponse((response) => {
        const query = new URL(response.url()).searchParams;
        return query.get("action") === "published-book-activity" && query.get("releaseId") === book.releaseId && query.get("activityId") === hotspot.activityId;
      });
      await surface.locator(".published-page-hotspots button").first().click();
      assert.equal((await activityResponse).status(), 200);
      await expect(surface.locator(".published-native-activity")).toHaveAttribute("data-release-id", book.releaseId);
      if (role === "student") {
        await expect(surface.getByRole("textbox").first()).toBeEditable();
        await expect(surface).not.toContainText("PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL");
        assert.equal(requests.some((url) => url.searchParams.get("action") === "published-native-teacher"), false);
      } else {
        const reveal = surface.getByRole("button", { name: /^Reveal model answer/ }).first();
        await reveal.click();
        await expect(surface.getByRole("button", { name: /^Hide model answer/ }).first()).toHaveAttribute("aria-pressed", "true");
      }
      const evidence = process.env.PUBLISHED_BOOK_EVIDENCE_DIR || "/tmp/published-book-evidence";
      await mkdir(evidence, { recursive: true });
      await page.locator(".app-intro-overlay").waitFor({ state: "hidden" });
      await page.screenshot({ path: `${evidence}/workbook-${role}-managed-page.png`, fullPage: true });
      // Route syntax never authorizes a page or falls back to static page data.
      for (const id of [`wb-page-${"0".repeat(32)}`, "wb-listening-20"]) {
        await page.goto(`${origin}/#${pageRoute(id)}`);
        await expect(page.getByRole("alert")).toHaveText("This page is not available in the published book.");
        assert.equal(new URL(page.url()).hash, `#${pageRoute(id)}`);
        await expect(surface).toHaveCount(0);
        await expect(page.locator(".book-component-card")).toHaveCount(0);
      }
      const legacyRequests = requests.filter((url) => url.pathname === "/.netlify/functions/activity"
        || ["activity", "teacher-activity-solutions"].includes(url.searchParams.get("action"))
        || (url.searchParams.get("action") === "asset-access" && !url.searchParams.get("logicalKey")?.endsWith(".cover")));
      assert.deepEqual(legacyRequests.map(String), [], "Workbook page navigation and activity launch use immutable publication APIs exclusively");
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await studentContext.close(); }
  const after = (await pool.query("select release_sha256,public_projection_sha256 from book_component_releases where id=$1", [book.releaseId])).rows[0];
  assert.deepEqual(after, before, "Navigation must not alter the immutable release");
  console.log("WORKBOOK_ROUTE_BROWSER Student/Teacher Next, Previous, selector, history, reload, native activity, missing-page boundary, no legacy fallback, Grammar hidden and independent cover 404 checks passed.");
}
