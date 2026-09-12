import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createEmptyHostedTeacherUiDocument, independentHostedPartsAssets, normalizeHostedTeacherUiDocument, projectHostedTeacherUiPreview } from "../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { createBuilderTeacherUiAssetsHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import { createTeacherRuntimeUiAssetModel } from "../src/apps/android-teacher-offline/teacherRuntimeUiAssetModel.js";
import { ultimateB2TeacherAppAuthoring } from "../src/data/ultimate-b2/teacherAppAuthoring.js";
import { buildTeacherUnitOverviewEntries } from "../src/apps/android-teacher-offline/studentsBookOverviewLayout.js";
import { managedPageUnitsFromCatalog, managedPageUnitsFromRelease } from "../src/apps/android-teacher-offline/managedReviewRuntime.js";
import { compileManagedUiReleaseV2 } from "../netlify-sites/ultimate-b2-builder/server/_builder-managed-ui-publication-compiler.js";
import { verifyImmutableComponentRelease } from "../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { publishedManagedBookSources, managedPageRouteIds } from "./fixtures/published-managed-book.js";
import { componentReleaseRow } from "./fixtures/published-managed-ui.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

const ids = ["background.students-book-parts", "background.workbook-parts", "background.grammar-book-parts"];
const asset = (letter) => ({ sha256: letter.repeat(64), extension: "png", mediaType: "image/png", sizeBytes: 12, width: 120, height: 80, originalFilename: "background.png" });
const model = (document, bookSlug, runtimeContext = { kind: "builder-preview" }) => createTeacherRuntimeUiAssetModel({ authoring: ultimateB2TeacherAppAuthoring, resolveCanonicalAssetUrl: (binding) => `canonical:${binding.id}`, hostedPreview: projectHostedTeacherUiPreview(document, { packageId: document.packageId }), identity: { bookSlug, componentSlug: document.packageId }, runtimeContext });

for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus", "ultimate-b2"]) {
  test(`${bookSlug}: independent backgrounds and font survive normalization, reload and reset`, () => {
    const document = { ...createEmptyHostedTeacherUiDocument(`${bookSlug}-students-book`), independentPartsBackgrounds: true, overviewCaptionFontFamily: "Georgia", assets: Object.fromEntries(ids.map((id, i) => [id, asset("abc"[i])])) };
    const loaded = normalizeHostedTeacherUiDocument(JSON.parse(JSON.stringify(document)), { packageId: document.packageId });
    const runtime = model(loaded, bookSlug);
    assert.equal(runtime.classroom.overviewCaptionFontFamily, "Georgia");
    for (const [index, name] of ["studentsBookPartsBackground", "workbookPartsBackground", "grammarBookPartsBackground"].entries()) assert.ok(runtime.classroom.backgrounds[name].includes("abc"[index].repeat(64)));
    for (const [index, id] of ids.entries()) {
      const changed = structuredClone(loaded); delete changed.assets[id];
      const next = model(changed, bookSlug);
      const names = ["studentsBookPartsBackground", "workbookPartsBackground", "grammarBookPartsBackground"];
      assert.equal(next.classroom.backgrounds[names[index]], "canonical:background.students-book-parts");
      for (const name of names.filter((name) => name !== names[index])) assert.equal(next.classroom.backgrounds[name], runtime.classroom.backgrounds[name]);
      assert.equal(next.classroom.backgrounds.classroomGlacier, runtime.classroom.backgrounds.classroomGlacier);
    }
    assert.throws(() => normalizeHostedTeacherUiDocument({ ...loaded, overviewCaptionFontFamily: "url(https://invalid)" }, { packageId: loaded.packageId }));
    assert.throws(() => normalizeHostedTeacherUiDocument(loaded, { packageId: "another-package" }));
  });
}

test("legacy documents preserve shared appearance until first edit, then retain each inherited choice", async () => {
  const legacy = { ...createEmptyHostedTeacherUiDocument(), assets: { [ids[0]]: asset("a") } };
  assert.deepEqual(normalizeHostedTeacherUiDocument(legacy), legacy);
  const previous = model(legacy, "ultimate-b2").classroom.backgrounds;
  assert.equal(previous.studentsBookPartsBackground, previous.workbookPartsBackground);
  assert.equal(previous.studentsBookPartsBackground, previous.grammarBookPartsBackground);
  const document = { ...legacy, independentPartsBackgrounds: true, overviewCaptionFontFamily: "Verdana", assets: independentHostedPartsAssets(legacy) };
  delete document.assets[ids[0]];
  let stored = legacy;
  const handler = createBuilderTeacherUiAssetsHandler({ getDatabase: () => ({}), authorize: async () => ({ builderUser: { id: randomUUID() } }), loadDocument: async () => ({ document: stored, revision: 1 }), loadCandidates: async () => [], markSaved: async () => {}, logger: { error() {} }, saveDocument: async (_sql, input) => { stored = input.document; return { outcome: "saved", revision: 2, document: stored }; } });
  const save = (value) => handler({ httpMethod: "POST", path: "/builder/api/ui-assets/save", headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, clientMutationId: randomUUID(), candidateUploadIds: [], document: value }) });
  const response = await save(document);
  assert.equal(response.statusCode, 200, response.body);
  const current = model(stored, "ultimate-b2").classroom;
  assert.equal(current.backgrounds.workbookPartsBackground, previous.workbookPartsBackground);
  assert.equal(current.backgrounds.grammarBookPartsBackground, previous.grammarBookPartsBackground);
  assert.equal(current.overviewCaptionFontFamily, "Verdana");
  const forged = structuredClone(document); forged.assets[ids[1]] = asset("f");
  assert.equal((await save(forged)).statusCode, 400, "inheritance cannot authorize a foreign/new asset");
});

for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) test(`${bookSlug}: immutable UI includes independent backgrounds/font without draft fallback`, async () => {
  const componentSlug = `${bookSlug}-students-book`;
  const sources = publishedManagedBookSources(componentSlug, { pageIds: await managedPageRouteIds(componentSlug) });
  const document = { ...createEmptyHostedTeacherUiDocument(componentSlug), independentPartsBackgrounds: true, overviewCaptionFontFamily: "Georgia", assets: Object.fromEntries(ids.map((id, i) => [id, asset("abc"[i])])) };
  sources.documents.teacherUi = { revision: 1, payload: document, sha256: builderDocumentSha256(document) };
  const compiled = compileManagedUiReleaseV2(sources, componentSlug);
  verifyImmutableComponentRelease(componentReleaseRow(compiled));
  assert.deepEqual(compiled.teacherProjection.ui, projectHostedTeacherUiPreview(document, { packageId: componentSlug }));
  assert.equal(compiled.assetManifest.filter((a) => a.role === "teacher_ui").length, 3);
  assert.equal(JSON.stringify(compiled.publicProjection).includes("Georgia"), false);
  const frozen = JSON.stringify(compiled);
  sources.documents.teacherUi.payload.overviewCaptionFontFamily = "Arial";
  assert.equal(JSON.stringify(compiled), frozen);
});

test("managed authored labels and printed numbers reach draft and immutable overview, preserving IDs/order", () => {
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) for (const component of ["students-book", "workbook"]) {
    const identity = { bookSlug, componentSlug: `${bookSlug}-${component}` };
    const units = [{ id: "unit-uuid", slug: "unit-1", unitNumber: 1, title: "Unit 1" }];
    const pages = [0, 1].map((i) => ({ id: `page-${i}`, componentSlug: identity.componentSlug, unitId: units[0].id, label: i ? "Grammar in Use" : "Vocabulary in Use", printedLabel: i ? "8-9" : "6", sortOrder: i, image: { source: "managed", width: i ? 1180 : 581, height: 794, url: `/preview/page-${i}.png`, sha256: "a".repeat(64), extension: "png" } }));
    const draft = managedPageUnitsFromCatalog({ bookSlug, component: { ...identity, kind: "managed" }, units, pages }, identity);
    const release = managedPageUnitsFromRelease({ units, pages }, identity, { kind: "release-preview", releaseId: "20000000-0000-4000-8000-000000000001", authorization: `v3.fixture.${"a".repeat(43)}` });
    for (const unit of [draft[0], release[0]]) {
      const entries = buildTeacherUnitOverviewEntries({ unit, selectedBookId: component, componentIdentity: identity });
      assert.deepEqual(entries.map((e) => [e.label, e.pageLabel, e.pageIds[0], e.physicalWeight]), [["Vocabulary in Use", "pg 6", "page-0", 1], ["Grammar in Use", "pg 8-9", "page-1", 2]]);
    }
  }
});

test("authored label wins internal title and missing metadata has a safe fallback", () => {
  const entries = buildTeacherUnitOverviewEntries({ unit: { number: 1, pages: [{ id: "page-1", title: "internal-page-1", label: "Vocabulary in Use", pageNumbers: [6, 7] }, { id: "page-2", title: "page-2.png", label: "page-2" }] }, selectedBookId: "students-book", componentIdentity: { bookSlug: "ultimate-b1" } });
  assert.deepEqual(entries.map((e) => [e.label, e.pageLabel]), [["Vocabulary in Use", "pg 6-7"], [null, "Page 2"]]);
});


test("B2 v3 snapshots the new UI settings and keeps the current release contract", async () => {
  const { studentsBookV3Sources, studentsBookV3ReleaseRow } = await import("./fixtures/students-book-publication-v3.js");
  const { compileStudentsBookReleaseV3 } = await import("../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js");
  const sources = studentsBookV3Sources();
  const payload = { ...createEmptyHostedTeacherUiDocument(), independentPartsBackgrounds: true, overviewCaptionFontFamily: "Arial", assets: Object.fromEntries(ids.map((id, i) => [id, asset("abc"[i])])) };
  sources.documents.teacherUi = { payload, revision: 1, sha256: builderDocumentSha256(payload) };
  const compiled = compileStudentsBookReleaseV3(sources);
  verifyImmutableComponentRelease(studentsBookV3ReleaseRow(compiled));
  assert.deepEqual(compiled.teacherProjection.ui, projectHostedTeacherUiPreview(payload));
  assert.equal(compiled.assetManifest.filter((a) => a.role === "teacher_ui").length, 3);
});
