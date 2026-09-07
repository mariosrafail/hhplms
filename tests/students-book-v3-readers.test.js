import { createHostedReviewHotspotRuntime } from "../src/data/ultimate-b2/hostedReviewHotspotRuntime.js";
import assert from "node:assert/strict";
import test from "node:test";
import { studentsBookV3Sources, studentsBookV3ReleaseRow } from "./fixtures/students-book-publication-v3.js";
import { compileStudentsBookReleaseV3 } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { verifyImmutableComponentRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { normalizeComponentPublicationEnvelope } from "../src/services/componentPublicationApi.js";
import { studentsBookPageUnitsFromV3Release } from "../src/apps/android-teacher-offline/studentsBookReleasePagesV3.js";
import { createHostedReleasePreviewRuntimeContext } from "../src/apps/android-teacher-offline/hostedReleasePreview.js";
import { publishedBookReadModel, resolvePublishedBookLocator } from "../netlify/functions/_book-content/published-book-model.js";

test("v3 immutable server, client envelope, Builder Review pages and LMS locators share the captured release", async () => {
  const compiled = compileStudentsBookReleaseV3(studentsBookV3Sources());
  const releaseId = "10000000-0000-4000-8000-000000000001";
  const row = { ...studentsBookV3ReleaseRow(compiled), id: releaseId, release_number: 12 };
  const verified = verifyImmutableComponentRelease(row);
  const envelope = { releaseId, releaseNumber: 12, compilerId: compiled.compilerId, releaseSchemaVersion: compiled.releaseSchemaVersion, compatibility: compiled.compatibility, releaseSha256: compiled.releaseSha256, projection: verified.publicProjection };
  assert.deepEqual(normalizeComponentPublicationEnvelope(envelope).projection, verified.publicProjection);
  const context = createHostedReleasePreviewRuntimeContext({ authorization: `v3.synthetic.${"a".repeat(43)}`, productReleaseId: "10000000-0000-4000-8000-000000000002", componentReleaseId: releaseId, memberSha256: compiled.releaseSha256 });
  const pages = studentsBookPageUnitsFromV3Release(envelope, context).flatMap((unit) => unit.pages);
  const hotspotRuntime = createHostedReviewHotspotRuntime({ pages: {} });
  await hotspotRuntime.prepare({ runtimeContext: context, fetchImpl: async () => ({ ok: true, json: async () => envelope }) });
  assert.equal(hotspotRuntime.getActions({ pageId: "ub2-sb-unit-1-part-1", pageNumber: null, unitNumber: 1 }).length, 4);
  await assert.rejects(hotspotRuntime.prepare({ runtimeContext: context, fetchImpl: async () => ({ ok: true, json: async () => ({ ...envelope, releaseId: context.productReleaseId }) }) }), /could not be loaded/);
  assert.equal(pages.length, 110);
  for (const page of pages) {
    const snapshot = verified.publicProjection.pages.find((entry) => entry.id === page.id);
    assert.equal(page.imageWidth, snapshot.image.width); assert.equal(page.imageHeight, snapshot.image.height);
    assert(page.images[0].includes(`/releases/books/ultimate-b2/components/ultimate-b2-students-book/${releaseId}/assets/${snapshot.image.sha256}.${snapshot.image.extension}`));
    assert.deepEqual(page.activities, []); assert.deepEqual(page.actions, []);
  }
  const capabilities = Object.fromEntries(Object.keys(verified.publicProjection.nativeActivities).map((id) => [id, { assignable: true, submittable: true }]));
  const book = publishedBookReadModel(row, verified.publicProjection, capabilities);
  assert.equal(book.activities.length, 4); assert.equal(book.pages.length, 110);
  const activity = book.activities[0]; const locator = activity.placements[0];
  assert.deepEqual(resolvePublishedBookLocator(book, activity.target.nativeActivityId, locator), locator);
  const page = book.pages.find((entry) => entry.id === locator.pageId);
  assert.deepEqual(page.image, verified.publicProjection.pages.find((entry) => entry.id === locator.pageId).image);
  assert.throws(() => resolvePublishedBookLocator(book, activity.target.nativeActivityId, { ...locator, hotspotId: "foreign-hotspot" }));
  assert.throws(() => studentsBookPageUnitsFromV3Release(envelope, { ...context, releaseId: context.productReleaseId }));
  for (const replacement of [{ compilerId: "ultimate-b2-students-book-v2" }, { releaseSchemaVersion: "2.0" }, { compatibility: "f".repeat(64) }]) assert.throws(() => normalizeComponentPublicationEnvelope({ ...envelope, ...replacement }));
  assert.throws(() => publishedBookReadModel({ ...row, compiler_id: "ultimate-b2-students-book-v2" }, verified.publicProjection));
  assert.doesNotMatch(JSON.stringify({ book, pages, envelope }), /PHASE_5_PRIVATE_TEACHER_SENTINEL|modelAnswers/);
});
