import assert from "node:assert/strict";
import test from "node:test";
import { createBuilderUnitExtraAssetsHandler } from "../netlify-sites/ultimate-b2-builder/server/_builder-unit-extra-assets.js";
import { studentsBookPageSql, studentsBookUnits, canonicalStudentsBookPages } from "./fixtures/students-book-current.js";
import { validateCurrentUnitExtrasContext } from "../netlify-sites/ultimate-b2-builder/server/_students-book-current-extras.js";
import { projectCurrentUnitExtras } from "../src/data/ultimate-b2/unitExtras.js";
import { loadBuilderComponentDocument } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-store.js";
import { resolveBuilderContentResource } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js";
import { builderDocumentSha256 } from "../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

const managedId = `sb-page-${"a".repeat(32)}`;
const rows = [{ stable_key: `ultimate-b2-students-book/pages/${managedId}`, unit_id: studentsBookUnits[9].id, unit_number: 10, asset_id: "synthetic-page-asset", label: "Managed Unit 10", sort_order: 1, source_metadata: { is_active: true } }];
for (const [pageId, unitNumber] of [[canonicalStudentsBookPages.find((page) => page.unitNumber === 3).id, 3], [managedId, 10]]) {
  test(`current Extras save accepts authoritative Unit ${unitNumber} page visibility and preserves raw optional fields`, async () => {
    const document = { schemaVersion: "1.0", units: [{ unitId: "unit-1", unitNumber: 1, categories: { videos: [] } }], pages: [{ pageId, unitId: `unit-${unitNumber}`, extrasVisibility: { videos: true } }] };
    let saved;
    const handler = createBuilderUnitExtraAssetsHandler({
      getDatabase: () => studentsBookPageSql({ rows }), authorize: async () => ({ builderUser: { id: "10000000-0000-4000-8000-000000000001" } }),
      validateAssets: async () => {}, archiveUnreferenced: async () => [], storage: () => ({}),
      saveDocument: async (_sql, input) => { saved = input.document; return { outcome: "saved", revision: 1, document: input.document }; },
    });
    const response = await handler({ path: "/builder/api/unit-extras/books/ultimate-b2/components/ultimate-b2-students-book/save", httpMethod: "POST", headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, clientMutationId: "10000000-0000-4000-8000-000000000002", document }) });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(saved, document);
    assert.deepEqual(JSON.parse(response.body).document, document);
  });
}

test("current raw reads check persisted checksum before context and preserve dormant settings without writes", async () => {
  const document = { schemaVersion: "1.0", units: [{ unitId: "unit-2", unitNumber: 2, categories: { videos: [] } }], pages: [{ pageId: managedId, unitId: "unit-10", extrasVisibility: { videos: false } }] };
  const resource = await resolveBuilderContentResource("ultimate-b2", "ultimate-b2-students-book", "unit-extras");
  const row = { schema_version: "1.0", revision: 4, payload: document, payload_sha256: builderDocumentSha256(document) };
  const calls = [];
  const sql = studentsBookPageSql({ rows: [{ ...rows[0], source_metadata: { is_deleted: true } }], onQuery: (query) => { calls.push(query); assert.match(query.trim(), /^select/); }, otherSql: async () => [row] });
  const loaded = await loadBuilderComponentDocument(sql, resource);
  assert.deepEqual(loaded, { revision: 4, source: "database", document });
  assert.deepEqual(projectCurrentUnitExtras(document, await validateCurrentUnitExtrasContext({ document, sql })).pages, []);
  assert.deepEqual(row.payload, document);
  const wrongUnit = structuredClone(document); wrongUnit.pages[0].unitId = "unit-3";
  await assert.rejects(validateCurrentUnitExtrasContext({ document: wrongUnit, sql }), /ownership/);
  const unknown = structuredClone(document); unknown.pages[0].pageId = "unknown-page";
  await assert.rejects(validateCurrentUnitExtrasContext({ document: unknown, sql }), /ownership/);
  calls.length = 0; row.payload_sha256 = "f".repeat(64);
  await assert.rejects(loadBuilderComponentDocument(sql, resource), /checksum/);
  assert.equal(calls.length, 1, "Corrupt persisted bytes must fail before any authority projection");
});
