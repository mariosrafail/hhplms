import assert from "node:assert/strict";
import path from "node:path";
import { assertInteractiveOverview } from "./interactive-overview-assertions.mjs";

export async function assertStudentsBookOverview({
  page, origin, overviewScreenshotDir, teacherUiChecksum,
  exchangeRequests, managedCatalogRequests, managedPreviewLoads,
}) {
  const residentExchangeStart = exchangeRequests.length;
  const residentCatalogStart = managedCatalogRequests.length;
  const residentPreviewLoadStart = managedPreviewLoads.length;
  await page.goto(`${origin}/#/books/ultimate-b2/components/ultimate-b2-students-book`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const studentsPagesReview = page.frameLocator(".unified-builder-review-dialog iframe");
  await studentsPagesReview.locator(".teacher-offline-library").waitFor();
  const studentsFrameSource = await page.locator(".unified-builder-review-dialog iframe").getAttribute("src");
  const studentsPreviewAuthorization = new URL(studentsFrameSource).searchParams.get("previewAuthorization");
  assert.ok(studentsPreviewAuthorization);
  assert.equal(new URL(studentsFrameSource).searchParams.get("view"), "library");
  assert.equal(await page.getByLabel("Review page").count(), 0);
  assert.equal(await studentsPagesReview.getByRole("button", { name: "Students Book", exact: true }).getAttribute("aria-pressed"), "true");
  const residentIframeLocator = page.locator(".unified-builder-review-dialog iframe");
  const residentIframe = await residentIframeLocator.elementHandle();
  assert.ok(residentIframe);
  await residentIframeLocator.evaluate((iframe) => { iframe.dataset.productViewerInstance = "single"; });
  assert.match(await studentsPagesReview.locator(".teacher-offline-library").getAttribute("style"), new RegExp(`/preview/ui-assets-v2/${teacherUiChecksum}\\.png`));
  await studentsPagesReview.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await studentsPagesReview.getByRole("heading", { name: "Unit 1", exact: true }).waitFor();
  if (overviewScreenshotDir) await studentsPagesReview.locator(".teacher-offline-unit-overview-screen").screenshot({ path: path.join(overviewScreenshotDir, "students-book-unit-1-overview.png") });
  await studentsPagesReview.getByRole("button", { name: "Home" }).click();
  await studentsPagesReview.getByRole("button", { name: /^Open Unit 2:/ }).click();
  await studentsPagesReview.getByRole("heading", { name: "Unit 2", exact: true }).waitFor();
  if (overviewScreenshotDir) await studentsPagesReview.locator(".teacher-offline-unit-overview-screen").screenshot({ path: path.join(overviewScreenshotDir, "students-book-unit-2-overview.png") });
  await studentsPagesReview.getByRole("button", { name: "Home" }).click();
  await studentsPagesReview.getByRole("button", { name: /^Open Unit 5:/ }).click();
  await studentsPagesReview.getByRole("heading", { name: "Unit 5", exact: true }).waitFor();
  const studentsOverviewMetrics = await assertInteractiveOverview(studentsPagesReview, {
    labels: ["pg 65", "pg 66-67", "pg 68-69", "pg 70-71", "pg 72", "pg 73", "pg 74-75", "pg 76", "pg 77-78"],
    rows: [1, 1, 1, 1, 2, 2, 2, 2, 2],
    weights: [1, 2, 2, 2, 1, 1, 2, 1, 2],
    spans: [3, 7, 7, 7, 4, 3, 7, 3, 7],
    pageIds: [
      ["ub2-sb-unit-5-part-1"],
      ["ub2-sb-unit-5-part-2"],
      ["ub2-sb-unit-5-part-3"],
      ["ub2-sb-unit-5-part-4"],
      ["ub2-sb-unit-5-part-5"],
      ["ub2-sb-unit-5-part-6"],
      ["ub2-sb-unit-5-part-7"],
      ["ub2-sb-unit-5-part-8"],
      ["ub2-sb-unit-5-part-9", "ub2-sb-unit-5-part-10"],
    ],
    columnTotals: [24, 24],
    overviewBook: "students-book",
    imageHeightParityTolerance: 1,
    singleImageHeight: 124.76, // shared row fit accounts for the narrowest single-page card
  }, "Students Book Unit 5 interactive Review", { directory: overviewScreenshotDir, fileName: "students-book-unit-5-overview.png" });
  assert.equal(studentsOverviewMetrics.thumbnailToken, "235px", "Students Book launcher keeps its established thumbnail token");
  const studentsOverviewPageIds = studentsOverviewMetrics.pageIds.flat();
  assert.deepEqual(studentsOverviewPageIds, Array.from({ length: 10 }, (_, index) => `ub2-sb-unit-5-part-${index + 1}`), "Unit 5 preserves every page identity in source order");
  assert.equal(new Set(studentsOverviewPageIds).size, 10, "Unit 5 has no duplicate page identities");
  assert.equal(await studentsPagesReview.locator(".teacher-unit-page-open").count(), 10, "Unit 5 has ten independent page buttons");
  const practiceGroup = studentsPagesReview.locator('[data-page-ids="ub2-sb-unit-5-part-9,ub2-sb-unit-5-part-10"]');
  assert.equal(await practiceGroup.locator(".teacher-unit-page-copy strong").textContent(), "Practice");
  assert.equal(await practiceGroup.locator(".teacher-unit-page-copy b").textContent(), "pg 77-78");
  assert.equal(await practiceGroup.evaluate((group) => group.matches("button, a, [role=button]") || Boolean(group.closest("button, a, [role=button]"))), false, "Practice group has no shared click target");
  for (const [printedPage, pageId] of [[77, "ub2-sb-unit-5-part-9"], [78, "ub2-sb-unit-5-part-10"]]) {
    const practiceButton = practiceGroup.getByRole("button", { name: `Open Practice, pg ${printedPage}`, exact: true });
    assert.equal(await practiceButton.getAttribute("data-page-id"), pageId);
    await practiceButton.click();
    await studentsPagesReview.locator(`.teacher-offline-page-stage[data-classroom-surface-id="students-book:page:${pageId}"]`).waitFor();
    await studentsPagesReview.getByRole("button", { name: "Back", exact: true }).click();
    await studentsPagesReview.getByRole("heading", { name: "Unit 5", exact: true }).waitFor();
    await practiceGroup.waitFor();
  }
  console.log("Students Book Unit 5: 9 cards, 10 images, 10 independent page buttons; no missing/duplicate IDs; Practice 77/78 independent navigation PASS");
  await studentsPagesReview.getByRole("button", { name: /^Open Reading, pg 66-67$/ }).click();
  await studentsPagesReview.getByAltText("Unit 5, Reading, pg 66-67", { exact: true }).waitFor();
  await studentsPagesReview.getByRole("button", { name: "Home" }).click();
  await studentsPagesReview.getByRole("button", { name: /^Open Unit 1:/ }).click();
  await studentsPagesReview.getByRole("heading", { name: "Unit 1", exact: true }).waitFor();
  await studentsPagesReview.locator(".teacher-unit-page-card").first().locator(".teacher-unit-page-open").first().click();
  await studentsPagesReview.locator(".teacher-offline-page-stage").waitFor();
  const draftExtraLauncher = studentsPagesReview.getByRole("button", { name: "Extra Videos", exact: true });
  await draftExtraLauncher.waitFor(); await draftExtraLauncher.click();
  await studentsPagesReview.getByRole("menuitem", { name: "Saved Draft Extra", exact: true }).click();
  const draftExtraDialog = studentsPagesReview.getByRole("dialog", { name: "Saved Draft Extra" });
  await draftExtraDialog.waitFor(); await draftExtraDialog.locator("video").waitFor();
  assert.match(await draftExtraDialog.locator("video").getAttribute("src"), /^\/preview\/unit-extras\//);
  await draftExtraDialog.getByRole("button", { name: "Close Extra Video" }).click();
  await studentsPagesReview.getByRole("button", { name: "Home" }).click();
  await studentsPagesReview.locator(".teacher-offline-library").waitFor();
  return {
    studentsPagesReview, studentsFrameSource, residentIframeLocator, residentIframe,
    studentsOverviewMetrics, residentExchangeStart, residentCatalogStart, residentPreviewLoadStart,
  };
}
