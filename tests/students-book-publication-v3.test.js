import test from "node:test";
import assert from "node:assert/strict";
import { studentsBookUnits } from "./fixtures/students-book-current.js";
import { studentsBookV3Sources, studentsBookV3PdfSources, studentsBookPdfArtwork, studentsBookV3ReleaseRow as releaseRow } from "./fixtures/students-book-publication-v3.js";
import { compileStudentsBookReleaseV3, reconcileStudentsBookPublication } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { verifyImmutableComponentRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { normalizeStudentsBookV3Public, STUDENTS_BOOK_V3_COMPATIBILITY, STUDENTS_BOOK_V3_COMPATIBILITY_SHA256 } from "../src/data/ultimate-b2/componentPublicationV3.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

test("v3 compiles the restored PDF worksheet descriptor and preserves its exact public asset identity", () => {
  const sources = studentsBookV3PdfSources(); const before = structuredClone(sources);
  const compiled = compileStudentsBookReleaseV3(sources);
  const projection = normalizeStudentsBookV3Public(compiled.publicProjection);
  assert.deepEqual(projection.assets.find((asset) => asset.sha256 === studentsBookPdfArtwork.sha256), studentsBookPdfArtwork);
  assert.deepEqual(compiled.assetManifest.find((asset) => asset.sha256 === studentsBookPdfArtwork.sha256), studentsBookPdfArtwork);
  const source = compiled.nativeAssetSources.find((entry) => entry.descriptor.sha256 === studentsBookPdfArtwork.sha256);
  assert.equal(source.row.source_metadata.native_activity_id, "ultimate-b2-sb-u1-p2-o7");
  assert.equal(source.row.source_metadata.asset_slot, "video-worksheet");
  assert.deepEqual(sources, before);
});

test("v3 PDF support retains exact MIME, role and checksum validation", () => {
  const compiled = compileStudentsBookReleaseV3(studentsBookV3PdfSources());
  for (const replacement of [
    { extension: "pdf", mediaType: "image/png" },
    { extension: "png", mediaType: "application/pdf" },
    { extension: "unknown", mediaType: "application/pdf" },
    { role: "unknown_role" },
    { role: "native_teacher_answer" },
    { sha256: "bad-checksum" },
    { sha256: studentsBookPdfArtwork.sha256.toUpperCase() },
  ]) {
    const projection = structuredClone(compiled.publicProjection);
    Object.assign(projection.assets.find((asset) => asset.sha256 === studentsBookPdfArtwork.sha256), replacement);
    assert.throws(() => normalizeStudentsBookV3Public(projection), /Invalid Students Book v3 asset identity/);
  }
});

test("Students Book v3 captures canonical pages and all native inclusion decisions with frozen verification", () => {
  const sources = studentsBookV3Sources(); const before = structuredClone(sources);
  const compiled = compileStudentsBookReleaseV3(sources);
  assert.equal(builderDocumentSha256(STUDENTS_BOOK_V3_COMPATIBILITY), STUDENTS_BOOK_V3_COMPATIBILITY_SHA256);
  assert.equal(compiled.publicProjection.pages.length, 110);
  assert.equal(compiled.publicProjection.units.length, 10);
  assert.equal(compiled.canonicalAssetSources.length, 110);
  assert.equal(compiled.publicProjection.pages[0].image.role, "canonical_page_image");
  assert.equal(Object.keys(compiled.publicProjection.nativeActivities).length, 4);
  assert.equal(compiled.reconciliation.length, 4);
  assert(compiled.reconciliation.every((entry) => entry.included));
  assert(!JSON.stringify(compiled.publicProjection).includes("PHASE_5_PRIVATE_TEACHER_SENTINEL"));
  assert(JSON.stringify(compiled.teacherProjection).includes("PHASE_5_PRIVATE_TEACHER_SENTINEL"));
  assert.deepEqual(verifyImmutableComponentRelease(releaseRow(compiled)).publicProjection, compiled.publicProjection);
  assert.deepEqual(sources, before);
  const saved = releaseRow(compiled);
  sources.pages.units = []; sources.native.activities = {}; sources.documents.hotspots.payload.pages = {};
  assert.deepEqual(verifyImmutableComponentRelease(saved).publicProjection, compiled.publicProjection);
});

test("Students Book v3 preserves authored precision and empties, captures overrides/managed Unit 10, and excludes tombstones", () => {
  const sources = studentsBookV3Sources();
  const managedId = `sb-page-${"1".repeat(32)}`;
  const canonicalId = "ub2-sb-unit-1-part-1";
  const row = { id: "10000000-0000-4000-8000-000000000055", stable_key: `ultimate-b2-students-book/pages/${managedId}`, book_slug: "ultimate-b2", component_slug: "ultimate-b2-students-book", unit_id: studentsBookUnits[9].id, unit_number: 10, label: "My authored page", sort_order: -5,
    source_metadata: { is_active: true, printed_label: "New 10" }, asset_id: "10000000-0000-4000-8000-000000000056", checksum_sha256: "5".repeat(64), asset_role: "page_image", publication_status: "draft", access_level: "internal", storage_profile: "private", storage_bucket: "synthetic", object_key: "synthetic-will-be-checked-at-materialization", mime_type: "image/png", byte_size: 150, width: 120, height: 80 };
  sources.pages.rows.push(row, { stable_key: "ultimate-b2-students-book/pages/reading-19", unit_id: studentsBookUnits[1].id, source_metadata: { is_deleted: true } },
    { ...row, stable_key: `ultimate-b2-students-book/pages/${canonicalId}`, unit_id: studentsBookUnits[0].id, unit_number: 1, label: "Preserved editorial label", source_metadata: { has_metadata_override: true, has_image_override: true, printed_label: "Custom folio" } });
  const target = sources.native.index.payload.activities[0];
  target.placement.pageId = managedId;
  sources.native.activities[target.activityId].public.payload.placement.pageId = managedId;
  const existing = sources.documents.hotspots.payload.pages[canonicalId];
  const hotspot = existing.shift();
  delete hotspot.pageNumber;
  Object.assign(hotspot, { pageId: managedId, unitNumber: 10, left: 4.123456789, label: "  editorial spacing  " });
  sources.documents.hotspots.payload.pages[managedId] = [hotspot];
  sources.documents.hotspots.payload.pages["ub2-sb-unit-3-part-1"] = [];
  const compiled = compileStudentsBookReleaseV3(sources);
  assert.equal(compiled.publicProjection.pages.length, 110);
  assert(!compiled.publicProjection.pages.some((page) => page.id === "reading-19"));
  assert.equal(compiled.publicProjection.pages.find((page) => page.id === canonicalId).label, "Preserved editorial label");
  assert.equal(compiled.publicProjection.pages.find((page) => page.id === managedId).image.width, 120);
  assert.deepEqual(compiled.publicProjection.hotspots, sources.documents.hotspots.payload);
  assert.equal(compiled.publicProjection.pages.filter((entry) => entry.image.role === "managed_page_image").length, 2);
  assert.equal(compiled.nativeAssetSources.filter((entry) => entry.descriptor.role === "managed_page_image").length, 1);
  assert.deepEqual(verifyImmutableComponentRelease(releaseRow(compiled)).publicProjection, compiled.publicProjection);
  const conflicting = structuredClone(compiled.publicProjection);
  conflicting.pages.find((page) => page.id === managedId).image.width++;
  assert.throws(() => normalizeStudentsBookV3Public(conflicting), /conflicting image dimensions/);
});

test("Students Book v3 accounts for unlinked/incomplete/unavailable activities without creating hotspots or including unfinished work", () => {
  const sources = studentsBookV3Sources();
  const pageId = "ub2-sb-unit-1-part-1";
  const [open, image, choice] = sources.native.index.payload.activities;
  sources.documents.hotspots.payload.pages[pageId] = sources.documents.hotspots.payload.pages[pageId].filter((entry) => entry.activityKey !== open.activityId && entry.activityKey !== image.activityId);
  sources.native.activities[image.activityId].teacher = null;
  const compiled = compileStudentsBookReleaseV3(sources);
  assert.equal(compiled.reconciliation.find((entry) => entry.activityId === open.activityId).reason, "no_authored_hotspot");
  assert.equal(compiled.reconciliation.find((entry) => entry.activityId === image.activityId).reason, "native_activity_not_found");
  assert.equal(Object.keys(compiled.publicProjection.nativeActivities).length, 2);
  const detached = structuredClone(sources);
  detached.native.index.payload.activities.find((entry) => entry.activityId === open.activityId).placement.pageId = `sb-page-${"2".repeat(32)}`;
  const reconciliation = reconcileStudentsBookPublication(detached, compiled.publicProjection.pages, detached.documents.hotspots.payload);
  assert.equal(reconciliation.length, 4);
  assert.equal(reconciliation.find((entry) => entry.activityId === open.activityId).reason, "placement_unavailable");
  const retained = studentsBookV3Sources();
  const beforeRetained = structuredClone(retained.documents.hotspots);
  retained.pages.rows.push({ stable_key: `ultimate-b2-students-book/pages/${pageId}`, source_metadata: { is_deleted: true } });
  assert.throws(() => compileStudentsBookReleaseV3(retained), (error) => error.code === "placement_unavailable" && error.reconciliation.length === 4 && error.reconciliation.every((entry) => entry.linked && !entry.included));
  assert.deepEqual(retained.documents.hotspots, beforeRetained, "blocked publication preserves retained authored hotspots");
  sources.native.activities[choice.activityId].teacher = null;
  assert.throws(() => compileStudentsBookReleaseV3(sources), (error) => error.code === "native_activity_not_found" && error.reconciliation.length === 4);
});

test("Students Book v3 fails foreign/forged topology and corrupt immutable hashes closed", () => {
  const sources = studentsBookV3Sources();
  const compiled = compileStudentsBookReleaseV3(sources);
  for (const mutate of [
    (value) => { value.pages[0].unitId = studentsBookUnits[1].id; },
    (value) => { value.pages[0].image.role = "native_teacher_answer"; },
    (value) => { value.pages[0].image.byteSize = 0; },
    (value) => { value.pages[0].image.url = "https://foreign.invalid"; },
    (value) => { value.hotspots.pages[`sb-page-${"2".repeat(32)}`] = []; },
    (value) => { value.assets.pop(); },
    (value) => { value.unitExtras.pages[0].unitId = "unit-10"; },
  ]) {
    const projection = structuredClone(compiled.publicProjection); mutate(projection);
    assert.throws(() => normalizeStudentsBookV3Public(projection));
  }
  const corrupt = structuredClone(releaseRow(compiled)); corrupt.public_projection.pages[0].label = "Tampered";
  assert.throws(() => verifyImmutableComponentRelease(corrupt));
  const mismatched = structuredClone(releaseRow(compiled)); delete mismatched.source_snapshot.nativeActivities[Object.keys(mismatched.source_snapshot.nativeActivities)[0]];
  mismatched.source_snapshot_sha256 = builderDocumentSha256(mismatched.source_snapshot);
  assert.throws(() => verifyImmutableComponentRelease(mismatched));
  sources.pages.units.pop(); assert.throws(() => compileStudentsBookReleaseV3(sources), /expansion_required/);
});

test("deleted-page Unit Extras settings stay authored and hashed while dormant in a new release", () => {
  const sources = studentsBookV3Sources();
  const setting = sources.unitExtras.document.payload.pages[0];
  delete sources.documents.hotspots.payload.pages[setting.pageId];
  sources.pages.rows.push({ stable_key: `ultimate-b2-students-book/pages/${setting.pageId}`, source_metadata: { is_deleted: true } });
  const before = structuredClone(sources.unitExtras.document);
  const compiled = compileStudentsBookReleaseV3(sources);
  assert(!compiled.publicProjection.unitExtras.pages.some((entry) => entry.pageId === setting.pageId));
  assert.deepEqual(sources.unitExtras.document, before);
  assert.equal(compiled.sourceSnapshot.unitExtras.sha256, before.sha256);
  sources.unitExtras.document.payload.pages.push({ ...setting, pageId: "foreign-page" });
  assert.throws(() => compileStudentsBookReleaseV3(sources));
});
