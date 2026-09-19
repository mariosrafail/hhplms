import assert from "node:assert/strict";
import test from "node:test";
import { editionFixtureRelease, editionPageBytes } from "./fixtures/content-editions.js";
import { readEditionAsset, editionSourceAssetIds } from "../netlify-sites/ultimate-b2-builder/server/_builder-edition-assets.js";

test("immutable edition asset reads reject component/edition substitution and corrupt bytes", async () => {
  const release = editionFixtureRelease("greek");
  const page = release.members[2].content.publicProjection.pages[0];
  const query = { componentSlug: "ultimate-b2-grammar-book", ...page.image };
  let reads = 0;
  const storage = { bucket: () => "isolated-editions-fixture", async download(target) { reads++; assert.equal(target.objectKey, release.members[2].source.inputs.pages.rows[0].object_key); return editionPageBytes("greek"); } };
  assert.deepEqual((await readEditionAsset(storage, release, query)).bytes, editionPageBytes("greek"));
  assert.equal(reads, 1);
  await assert.rejects(readEditionAsset(storage, release, { ...query, componentSlug: "ultimate-b2-workbook" }), { code: "edition_asset_context_mismatch" });
  await assert.rejects(readEditionAsset(storage, editionFixtureRelease("international"), query), { code: "edition_asset_context_mismatch" });
  await assert.rejects(readEditionAsset(storage, release, { ...query, role: "native_teacher_answer" }), { code: "edition_asset_context_mismatch" });
  await assert.rejects(readEditionAsset({ ...storage, bucket: () => "foreign-bucket" }, release, query), { code: "edition_asset_context_mismatch" });
  assert.equal(reads, 1);
  await assert.rejects(readEditionAsset({ ...storage, download: async () => editionPageBytes("international") }, release, query), { code: "edition_asset_integrity_failed" });
});

test("explicit source asset claims include Page UI Controller managed fonts", () => {
  const source = structuredClone(editionFixtureRelease("greek").members[0]);
  const fontId = "30000000-0000-4000-8000-000000000099";
  source.source.inputs.overviewFontSources = [{ row: { id: fontId } }];
  assert(editionSourceAssetIds(source).includes(fontId));
});
