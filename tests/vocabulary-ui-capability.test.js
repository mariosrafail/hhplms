import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { requiresVocabularyUiSchema } from "../netlify-sites/ultimate-b2-builder/server/_builder-vocabulary-ui-capability.js";
import { createBuilderProductPublicationHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js";
import { createBuilderTeacherUiAssetsHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-teacher-ui-assets.js";
import { findPublicationProduct } from "../src/data/publicationRegistry.js";

test("068 extends only the existing SQL raster catalog and preserves every historical validation check", async () => {
  const [before, after] = await Promise.all(["064_teacher_overview_ui.sql", "068_vocabulary_ui_bindings.sql"].map((name) => readFile(new URL(`../database/${name}`, import.meta.url), "utf8")));
  const body = (source) => source.replaceAll("\r\n", "\n").match(/create or replace function builder_b1_ui_projection_integrity\([\s\S]*?end \$\$;/)[0];
  assert.equal(body(after), body(before).replace("}'::jsonb;", "}'::jsonb || builder_b1_vocabulary_ui_bindings();"));
});

for (const book of ["ultimate-b1", "ultimate-b1-plus"]) {
  const legacy = { schemaVersion: "1.0", packageId: `${book}-students-book`, assets: {} };
  const variants = ["active", "disabled", "pressed"].map((state) => ({ ...legacy, assets: { [`navibar.vocabulary.${state}`]: {} } }));
  test(`${book}: optional schema predicate covers each added field/binding, not legacy or B2 UI`, () => {
    assert.equal(requiresVocabularyUiSchema(legacy), false);
    for (const ui of variants) {
      assert.equal(requiresVocabularyUiSchema(ui), true);
      assert.equal(requiresVocabularyUiSchema({ ...ui, packageId: "ultimate-b2-students-book" }), false);
    }
    assert.equal(requiresVocabularyUiSchema(undefined), false);
  });
  test(`${book}: Save rejects new artwork before upload/document writes when 068 is absent`, async () => {
    let downstream = 0;
    const handler = createBuilderTeacherUiAssetsHandler({
      getDatabase: () => async (strings) => { assert.match(strings.join(""), /builder_b1_vocabulary_ui_bindings/); return [{ ready: false }]; },
      authorize: async () => ({ builderUser: { id: randomUUID() } }),
      loadDocument: async () => { downstream++; throw new Error("must not read mutable document before capability gate"); },
      saveDocument: async () => { downstream++; }, loadCandidates: async () => { downstream++; },
    });
    for (const state of ["active", "disabled", "pressed"]) {
      const document = { ...legacy, assets: { [`navibar.vocabulary.${state}`]: { sha256: "a".repeat(64), extension: "png", mediaType: "image/png", sizeBytes: 100, width: 20, height: 10, originalFilename: "fixture.png" } } };
      const response = await handler({ path: `/builder/api/ui-assets/books/${book}/components/${book}-students-book/save`, httpMethod: "POST",
        headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 0, clientMutationId: randomUUID(), candidateUploadIds: [], document }) });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(JSON.parse(response.body).error, "vocabulary_ui_schema_unavailable");
    }
    assert.equal(downstream, 0);
  });
  test(`${book}: PUBLISH checks immutable UI before writes; PREPARE checks compiled UI before asset work`, async () => {
    const id = randomUUID(), actor = randomUUID();
    let reads = 0, writes = 0, checks = 0, available = false, frozenUi = legacy;
    const handler = createBuilderProductPublicationHandler({
      getDatabase: () => async (strings) => { assert.match(strings.join(""), /to_regprocedure\('builder_b1_vocabulary_ui_bindings/); checks++; return [{ ready: available }]; },
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
      assert.equal(JSON.parse(response.body).error, "vocabulary_ui_schema_unavailable");
      assert.equal(writes, 1); assert.equal(reads, 0);
    }
    assert.equal(JSON.parse((await call("prepare")).body).error, "vocabulary_ui_schema_unavailable");
    assert.equal(writes, 1);
    available = true;
    assert.equal((await call("publish")).statusCode, 200);
    assert.equal(writes, 2);
  });
}
