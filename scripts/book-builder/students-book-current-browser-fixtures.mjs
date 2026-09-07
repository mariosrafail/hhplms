import assert from "node:assert/strict";
import { canonicalStudentsBookPages } from "../../netlify-sites/ultimate-b2-builder/server/_builder-page-catalog.js";
import { nativeDocumentPair } from "./hosted-native-activity-document-fixtures.mjs";

const pageUnits = Array.from({ length: 10 }, (_, i) => ({ id: `60000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, slug: `unit-${i + 1}`, title: `Unit ${i + 1}`, unitNumber: i + 1, sortOrder: i + 1 }));
export async function drawPageHotspot(page) {
  await page.getByRole("button", { name: "Add hotspot", exact: true }).click();
  const pageSurface = page.locator(".builder-page-surface"); await pageSurface.scrollIntoViewIfNeeded();
  await pageSurface.locator("img").evaluate((image) => image.decode());
  const pageSurfaceBox = await pageSurface.boundingBox(); assert.ok(pageSurfaceBox.width > 0 && pageSurfaceBox.height > 0);
  await page.mouse.move(pageSurfaceBox.x + pageSurfaceBox.width * .4, pageSurfaceBox.y + pageSurfaceBox.height * .4);
  await page.mouse.down(); await page.mouse.move(pageSurfaceBox.x + pageSurfaceBox.width * .5, pageSurfaceBox.y + pageSurfaceBox.height * .48, { steps: 5 }); await page.mouse.up();
}
export function studentsBookCurrentPageEnvelope(hotspotRevision) { return { revision: 0, hotspotRevision, component: { bookSlug: "ultimate-b2", componentSlug: "ultimate-b2-students-book", kind: "students-book", title: "Students Book" }, units: pageUnits, pages: canonicalStudentsBookPages.map((page) => ({ ...page, origin: "canonical", unitId: pageUnits[page.unitNumber - 1].id, unitSortOrder: page.unitNumber })), deletedPages: [] }; }

export async function createAndSavePageHotspot(page, activityId, label) {
  await drawPageHotspot(page);
  await page.getByLabel("Activity").selectOption(activityId);
  await page.getByLabel("Label", { exact: true }).fill(label);
  await page.locator(".builder-save-state").getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".builder-save-state").getByText("Saved", { exact: true }).waitFor();
}

export function addDisposableCanonicalPageNative({ nativeDocuments, nativeIndex, hotspotManifest, indexRevision, hotspotRevision }) {
  const activityId = "ultimate-b2-sb-u1-p1-o1";
  nativeDocuments.set(activityId, nativeDocumentPair(activityId, "open-response", "ub2-sb-unit-1-part-1", "Disposable canonical-page native"));
  nativeIndex.activities.push({ activityId, kind: "open-response", placement: { pageId: "ub2-sb-unit-1-part-1" }, sortOrder: indexRevision + 1 });
  hotspotManifest.pages["ub2-sb-unit-1-part-1"].push({ id: "browser-disposable-native", unitNumber: 1, pageId: "ub2-sb-unit-1-part-1", pageNumber: 5, left: 3, top: 3, width: 4, height: 4, label: "Disposable native launch", actionType: "normalized_activity", activityKey: activityId });
  return { indexRevision: indexRevision + 1, hotspotRevision: hotspotRevision + 1 };
}

export async function exerciseDisposableCanonicalPageNativeDeletion(page, addFixture, getState) {
  // Current lifecycle operations target explicit native documents, including those on canonical pages.
  const canonicalRetiredId = "ultimate-b2-sb-u1-p1-o1";
  addFixture();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add Activity" }).waitFor();
  await page.getByRole("button", { name: new RegExp(canonicalRetiredId) }).click(); assert.equal(await page.getByRole("button", { name: "Delete Activity", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Delete Activity", exact: true }).click(); const canonicalDeleteDialog = page.getByRole("dialog", { name: "Delete activity?" }); await canonicalDeleteDialog.getByRole("button", { name: "Delete Activity", exact: true }).click(); await canonicalDeleteDialog.waitFor({ state: "detached" }); assert.equal(getState().nativeIndex.activities.some((entry) => entry.activityId === canonicalRetiredId), false); assert.ok(getState().nativeDocuments.has(canonicalRetiredId), "deleted native documents remain retained"); assert.equal(Object.values(getState().hotspotManifest.pages).flat().some((hotspot) => hotspot.activityKey === canonicalRetiredId), false); await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Add Activity" }).waitFor(); await page.getByRole("button", { name: new RegExp(canonicalRetiredId) }).waitFor({ state: "detached" });
}
