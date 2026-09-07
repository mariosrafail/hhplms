import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { currentExtrasFixture, extrasScope, extrasRoute, responseJson } from "./_students-book-current-extras-fixture.mjs";
import { fullbookStorage } from "./_students-book-fullbook-storage.mjs";
import { createBuilderProductPublicationHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";
import { collectStudentsBookPublicationV3Sources } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-sources-v3.js";
import { compileStudentsBookReleaseV3 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v3.js";
import { normalizeCurrentPublishedUnitExtras, unitExtrasForPage, unitExtraAudiosForPage } from "../../src/data/ultimate-b2/unitExtras.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
test("current Extras real handlers preserve Unit 3/managed Unit 10 media, visibility, dormant settings and revision outcomes", { skip: !enabled }, async (t) => {
  const f = await currentExtrasFixture(t);
  const managedId = await f.addManaged();
  const u3 = (await f.catalog()).pages.find((page) => page.unitNumber === 3);
  const initial = await f.read();
  initial.document.pages = [{ pageId: u3.id, unitId: "unit-3", extrasVisibility: { videos: true, audios: false } }, { pageId: managedId, unitId: "unit-10", extrasVisibility: { videos: false, audios: true } }];
  responseJson(await f.save(initial.document, initial.revision));
  const media = [];
  for (const unit of [3, 10]) for (const kind of ["videos", "audios"]) media.push(await f.attach(unit, kind));
  let state = await f.read();
  state.document.units.push({ unitId: "unit-2", unitNumber: 2, categories: { videos: [] } });
  state.document.pages = [{ pageId: u3.id, unitId: "unit-3", extrasVisibility: { videos: true, audios: false } }, { pageId: managedId, unitId: "unit-10", extrasVisibility: { videos: false, audios: true } }];
  const mutation = randomUUID(); const before = structuredClone(state.document);
  state = responseJson(await f.save(before, state.revision, mutation));
  assert.deepEqual((await f.read()).document, before);
  assert.equal(responseJson(await f.save(before, state.revision - 1, mutation)).idempotent, true);
  responseJson(await f.save(before, state.revision - 1), 409);
  const replayConflict = structuredClone(before); replayConflict.pages[0].extrasVisibility.videos = false;
  assert.equal(responseJson(await f.save(replayConflict, state.revision - 1, mutation), 409).error, "mutation_id_conflict");
  const snapshot = () => f.pool.query("select to_jsonb(document) value from builder_component_documents document order by id").then((value) => value.rows);
  const protectedRows = await snapshot();
  for (const mutate of [
    (doc) => { doc.pages[0].pageId = "unknown-page"; },
    (doc) => { doc.pages[0].unitId = "unit-10"; },
    (doc) => { doc.pages.push(structuredClone(doc.pages[0])); },
    (doc) => { doc.pages[0].extrasVisibility.videos = null; },
    (doc) => { doc.pages[0].extrasVisibility.audios = "true"; },
    (doc) => { doc.units[0].categories.videos[0].asset.role = "unit_extra_audio"; },
    (doc) => { doc.units[0].categories.videos[0].asset.assetId = randomUUID(); },
    (doc) => { const foreign = doc.units[1].categories.videos[0].asset; Object.assign(doc.units[0].categories.videos[0].asset, { assetId: foreign.assetId, checksumSha256: foreign.checksumSha256 }); },
  ]) { const invalid = structuredClone(before); mutate(invalid); responseJson(await f.save(invalid, state.revision), 400); assert.deepEqual(await snapshot(), protectedRows); }
  const unauthorized = f.event(`${extrasRoute("unit-extras")}/save`, "POST", { document: before, expectedRevision: state.revision, clientMutationId: randomUUID() }); unauthorized.headers.cookie = "";
  responseJson(await f.extras(unauthorized), 401);
  responseJson(await f.extras(f.event("/builder/api/unit-extras/books/ultimate-b2/components/ultimate-b2-workbook/save", "POST", { document: before, expectedRevision: state.revision, clientMutationId: randomUUID() })), 404);
  const preview = responseJson(await f.preview(f.event("/builder/preview/content/books/ultimate-b2/components/ultimate-b2-students-book/unit-extras")));
  const draft = { kind: "draft", projection: { unitExtras: normalizeCurrentPublishedUnitExtras(preview.document) } };
  assert.equal(unitExtrasForPage(draft, { unitNumber: 3, pageId: u3.id }).length, 1);
  assert.equal(unitExtraAudiosForPage(draft, { unitNumber: 3, pageId: u3.id }).length, 0);
  assert.equal(unitExtrasForPage(draft, { unitNumber: 10, pageId: managedId }).length, 0);
  assert.equal(unitExtraAudiosForPage(draft, { unitNumber: 10, pageId: managedId }).length, 1);
  assert.deepEqual(await snapshot(), protectedRows, "read and Saved Draft are read-only");
  const releaseStorage = await fullbookStorage(t, f.storage);
  const product = createBuilderProductPublicationHandler({ getDatabase: () => f.sql, storage: () => releaseStorage.storage, canonicalFetch: () => releaseStorage.fetchAsset });
  const prepared = responseJson(await product(f.event("/builder/api/publication/books/ultimate-b2/prepare", "POST", { releaseNote: "Synthetic Extras", clientMutationId: randomUUID() })));
  assert.equal(prepared.release.members.length, 3);
  responseJson(await product(f.event("/builder/api/publication/books/ultimate-b2/publish", "POST", { productReleaseId: prepared.productReleaseId, expectedHeadRevision: 0, clientMutationId: randomUUID() })));
  assert.deepEqual(await snapshot(), protectedRows, "Prepare/Publish never rewrite authored documents");
  const r1 = compileStudentsBookReleaseV3(await collectStudentsBookPublicationV3Sources(f.sql));
  const catalog = await f.catalog();
  const deleted = responseJson(await f.pages(f.event(`${extrasRoute("pages")}/pages/${managedId}/delete`, "POST", { expectedRevision: catalog.revision, expectedHotspotRevision: catalog.hotspotRevision, clientMutationId: randomUUID(), metadata: {} })));
  assert.deepEqual((await f.read()).document, before);
  const dormant = compileStudentsBookReleaseV3(await collectStudentsBookPublicationV3Sources(f.sql));
  assert.equal(dormant.publicProjection.unitExtras.pages.some((page) => page.pageId === managedId), false);
  responseJson(await f.save(before, state.revision));
  const restored = responseJson(await f.pages(f.event(`${extrasRoute("pages")}/pages/${managedId}/restore`, "POST", { expectedRevision: deleted.revision, clientMutationId: randomUUID(), metadata: {} })));
  assert(restored.pages.some((page) => page.id === managedId));
  const r2 = compileStudentsBookReleaseV3(await collectStudentsBookPublicationV3Sources(f.sql));
  assert.deepEqual(r2.publicProjection.unitExtras, r1.publicProjection.unitExtras);
  assert.deepEqual((await f.read()).document.units.find((unit) => unit.unitNumber === 2), before.units.find((unit) => unit.unitNumber === 2));
  assert.equal(media.length, 4);
});
