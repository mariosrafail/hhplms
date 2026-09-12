import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { browserAssetMime } from "./browser-acceptance-server.mjs";
import { createManagedSavedDraftFixture, savedDraftIdentities, savedDraftImage } from "./managed-saved-draft-fixtures.mjs";

export async function assertManagedSavedDraftStartup(browser, viewerRoot) {
  for (const identity of savedDraftIdentities) {
    const fixture = createManagedSavedDraftFixture();
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
    const viewerOrigin = "https://hhplms-viewer.netlify.app";
    const publicRequests = [];
    const escapedRequests = [];
    const imageRequests = [];
    const pageErrors = [];
    let denyImages = false;
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== viewerOrigin) {
        escapedRequests.push(url.origin);
        return route.abort("blockedbyclient");
      }
      if (url.pathname.startsWith("/preview/ui-assets-v2/")) {
        publicRequests.push(url);
        return route.fulfill({ status: 200, contentType: "image/png", body: savedDraftImage });
      }
      if (url.pathname.startsWith("/preview/")) {
        if (url.pathname.includes("/pages/") && url.pathname.includes("/assets/")) {
          imageRequests.push({ pageId: url.pathname.split("/pages/").at(-1).split("/")[0], token: url.searchParams.get("previewAuthorization"), identity: { ...identity } });
          if (denyImages) url.searchParams.set("previewAuthorization", fixture.issue(identity, { issuedAt: fixture.now - 600_000 }).token);
        }
        const response = await fixture.fetch(url, { method: request.method(), headers: request.headers(), ...(!["GET", "HEAD"].includes(request.method()) ? { body: request.postData() || "" } : {}) });
        if (response.status === 302) {
          assert.ok(response.headers.get("Location")?.startsWith("https://synthetic-storage.invalid/synthetic/"));
          return route.fulfill({ status: 200, contentType: "image/png", body: savedDraftImage });
        }
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.resolve(viewerRoot, relative);
      assert.ok(file.startsWith(`${viewerRoot}${path.sep}`), "static fixture requests stay inside the built Viewer");
      const body = await readFile(file);
      return route.fulfill({ status: 200, contentType: browserAssetMime[path.extname(file)] || "application/octet-stream", body });
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const initialToken = fixture.issue(identity).token;
      const url = new URL(viewerOrigin);
      for (const [key, value] of Object.entries({ builderPreview: "1", view: "library", ...identity, previewAuthorization: initialToken })) url.searchParams.set(key, value);
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
      await expect.poll(() => imageRequests.length).toBeGreaterThanOrEqual(2);
      const required = fixture.requests.filter((request) => request.action === "managed-page-asset");
      assert.ok(required[0]?.decision.authorized, "first required managed-page browser request must be authorized before Viewer readiness");
      assert.ok(required.every((request) => request.decision.authorized && request.componentSlug === identity.componentSlug));
      assert.deepEqual([...new Set(required.map((request) => request.pageId))].sort(), fixture.pageIds(identity).sort());
      assert.ok(imageRequests.every((request) => request.token && request.token !== initialToken), "startup uses the current renewed component session, not the window token");
      await page.locator(".teacher-offline-library").waitFor();
      assert.equal(await page.locator(".teacher-viewer-startup-error").count(), 0);
      const owner = `${identity.bookSlug}-students-book`;
      const uiRequests = fixture.requests.filter((request) => request.action === "teacher-ui-draft");
      assert.ok(uiRequests.length > 0 && uiRequests.every((request) => request.componentSlug === owner && request.decision.authorized));
      if (identity.componentSlug.endsWith("workbook")) assert.ok(required.every((request) => request.token !== uiRequests[0].token));
      assert.ok(publicRequests.length > 0 && publicRequests.every((url) => !url.searchParams.has("previewAuthorization")));

      const launcher = page.locator(".teacher-offline-library");
      const selectedEdition = await launcher.getAttribute("data-selected-edition");
      const beforeDisabledAttempts = fixture.requests.length;
      for (const [edition, message] of [["grammar-book", "Grammar Book is currently disabled for this package."], ["extras", "Extras are currently disabled for this package."]]) {
        const button = page.locator(`[data-teacher-control-id="edition:${edition}"]`);
        await expect(button).toBeVisible();
        await expect(button).toBeDisabled();
        await expect(button).toHaveAttribute("title", message);
        await button.hover({ force: true });
        assert.equal(await button.locator(".hover-pressed").evaluate((art) => getComputedStyle(art).opacity), "0", "disabled artwork never shows hover/pressed state");
        await button.evaluate((element) => element.click());
        // Invoke the real App selection callback directly, bypassing disabled HTML.
        const accepted = await button.evaluate((element, id) => {
          let fiber = element[Object.keys(element).find((key) => key.startsWith("__reactFiber$"))];
          while (fiber && typeof fiber.memoizedProps?.onSelectEdition !== "function") fiber = fiber.return;
          if (!fiber) throw new Error("Teacher App selection callback was not found");
          return fiber.memoizedProps.onSelectEdition(id);
        }, edition);
        assert.equal(accepted, false);
        await expect(launcher).toHaveAttribute("data-selected-edition", selectedEdition);
        await expect(page.locator(".legacy-home-extras-column")).toHaveCount(0);
      }
      assert.equal(fixture.requests.length, beforeDisabledAttempts, "disabled editions never start component preparation");
      for (const edition of ["students-book", "workbook"]) await expect(page.locator(`[data-teacher-control-id="edition:${edition}"]`)).toBeEnabled();

      await page.getByRole("button", { name: /^Open Unit 1:/ }).click();
      await expect(page.locator(".teacher-unit-page-card")).toHaveCount(2);
      const grammarSwitch = page.locator('.teacher-book-navigation [data-book-id="grammar-book"]');
      await expect(grammarSwitch).toBeVisible();
      await expect(grammarSwitch).toBeDisabled();
      await expect(grammarSwitch).toHaveAttribute("title", "Grammar Book is currently disabled for this package.");
      const beforeSwitchAttempt = fixture.requests.length;
      await grammarSwitch.evaluate((element) => element.click());
      assert.equal(await grammarSwitch.evaluate(async (element) => {
        let fiber = element[Object.keys(element).find((key) => key.startsWith("__reactFiber$"))];
        while (fiber && typeof fiber.memoizedProps?.onBookSwitch !== "function") fiber = fiber.return;
        if (!fiber) throw new Error("Teacher App switch callback was not found");
        return fiber.memoizedProps.onBookSwitch("grammar-book");
      }), false);
      assert.equal(fixture.requests.length, beforeSwitchAttempt, "programmatic disabled switch performs no component preparation");
      await expect(page.locator(".teacher-unit-page-card")).toHaveCount(2);
      await expect(page.locator(".teacher-unit-page-card").first().locator("strong")).toHaveCount(0);
      await page.getByRole("button", { name: "Open pg 1", exact: true }).click();
      await expect(page.locator('.teacher-book-navigation [data-book-id="grammar-book"]')).toHaveAttribute("title", "Grammar Book is currently disabled for this package.");
      await expect.poll(() => page.locator(".teacher-offline-page-image img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await page.getByRole("button", { name: identity.componentSlug.endsWith("workbook") ? "Students Book" : "Workbook", exact: true }).click();
      await page.locator(".teacher-offline-library").waitFor();
      await page.getByRole("button", { name: /^Open Unit 1:/ }).click();
      await expect(page.locator(".teacher-unit-page-card")).toHaveCount(2);

      if (identity.componentSlug === "ultimate-b1-workbook") {
        denyImages = true;
        await page.goto(url.href, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "Viewer could not start", exact: true }).waitFor();
        assert.equal(await page.locator(".teacher-offline-library").count(), 0);
        assert.ok(fixture.requests.some((request) => request.action === "managed-page-asset" && request.decision.code === "token_expired"));
        const failedTokens = new Set(imageRequests.map((request) => request.token));
        denyImages = false;
        const beforeRetry = imageRequests.length;
        await page.getByRole("button", { name: "Retry", exact: true }).click();
        await page.locator(".teacher-offline-library").waitFor();
        assert.ok(imageRequests.slice(beforeRetry).length >= 2);
        assert.ok(imageRequests.slice(beforeRetry).every((request) => !failedTokens.has(request.token)));
      }
      assert.deepEqual(escapedRequests, []);
      assert.deepEqual(pageErrors, []);
      console.log(`Saved Draft managed startup PASS: ${identity.componentSlug}; scoped required images, readiness and switching`);
    } finally { await context.close(); }
  }
}
