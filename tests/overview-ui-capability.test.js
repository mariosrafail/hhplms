import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requiresOverviewUiSchema } from "../netlify-sites/ultimate-b2-builder/server/_builder-overview-ui-capability.js";
import { createBuilderProductPublicationHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";
import { findPublicationProduct } from "../src/data/publicationRegistry.js";

for (const book of ["ultimate-b1", "ultimate-b1-plus"]) {
  const legacy = { schemaVersion: "1.0", packageId: `${book}-students-book`, assets: {} };
  const variants = [{ ...legacy, overviewCaptionFontFamily: "Georgia" }, { ...legacy, independentPartsBackgrounds: true },
    ...["background.workbook-parts", "background.grammar-book-parts"].map((id) => ({ ...legacy, assets: { [id]: {} } }))];
  test(`${book}: optional schema predicate covers each added field/binding, not legacy or B2 UI`, () => {
    assert.equal(requiresOverviewUiSchema(legacy), false);
    for (const ui of variants) {
      assert.equal(requiresOverviewUiSchema(ui), true);
      assert.equal(requiresOverviewUiSchema({ ...ui, packageId: "ultimate-b2-students-book" }), false);
    }
    assert.equal(requiresOverviewUiSchema(undefined), false);
  });
  test(`${book}: PUBLISH checks immutable UI before writes; PREPARE checks compiled UI before asset work`, async () => {
    const id = randomUUID(), actor = randomUUID();
    let reads = 0, writes = 0, checks = 0, available = false, frozenUi = legacy;
    const handler = createBuilderProductPublicationHandler({
      getDatabase: () => async (strings) => { assert.match(strings.join(""), /to_regprocedure\('builder_b1_overview_ui_settings_integrity/); checks++; return [{ ready: available }]; },
      authorize: async () => ({ builderUser: { id: actor } }), ready: async () => true, pinReady: async () => true,
      loadRelease: async () => ({ id, bookSlug: book, current: true, compilerId: findPublicationProduct(book).compilerId }),
      loadComponentRows: async () => [{ teacher_projection: { ui: frozenUi } }],
      verifyCandidate: async () => {}, loadMutation: async () => null,
      compileProduct: async () => { reads++; return [{ compiled: { teacherProjection: { ui: variants[0] } } }]; },
      storage: () => { throw new Error("asset work must not start before capability check"); },
      publish: async () => { writes++; return { outcome: "already_active" }; },
    });
    const call = (action) => handler({ path: `/builder/api/publication/books/${book}/${action}`, httpMethod: "POST", headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, body: JSON.stringify(action === "prepare" ? { clientMutationId: randomUUID(), releaseNote: "" } : { productReleaseId: id, expectedHeadRevision: 0, clientMutationId: randomUUID() }) });
    const legacyResponse = await call("publish");
    assert.equal(legacyResponse.statusCode, 200, legacyResponse.body);
    assert.equal(checks, 0); assert.equal(reads, 0); assert.equal(writes, 1);
    for (const ui of variants) {
      frozenUi = ui;
      const response = await call("publish");
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(JSON.parse(response.body).error, "publication_ui_schema_unavailable");
      assert.equal(writes, 1); assert.equal(reads, 0);
    }
    assert.equal(JSON.parse((await call("prepare")).body).error, "publication_ui_schema_unavailable");
    assert.equal(writes, 1);
    available = true;
    assert.equal((await call("publish")).statusCode, 200);
    assert.equal(writes, 2);
  });
}
