import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { createEmptyHostedTeacherUiDocument, projectHostedTeacherUiPreview } from "../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { HOSTED_EDITABLE_UI_BINDINGS } from "../../src/data/ultimate-b2/hostedTeacherUiBindingCatalog.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
test("064 accepts exact overview UI settings and preserves 063 validation of historical projections", { skip: !enabled }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  const schema = `overview_ui_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: url.href, max: 1 });
  await admin.query(`create schema "${schema}"`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.href, max: 1 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool, { through: "063_b1_immutable_package_ui.sql" });
  const verify = async (ui) => (await pool.query("select builder_b1_ui_projection_integrity($1::jsonb,$2) valid", [JSON.stringify(ui), ui.packageId])).rows[0].valid;
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    const ui = projectHostedTeacherUiPreview(createEmptyHostedTeacherUiDocument(`${bookSlug}-students-book`), { packageId: `${bookSlug}-students-book` });
    assert.equal(await verify(ui), true);
    assert.equal(await verify({ ...ui, overviewCaptionFontFamily: "Georgia", independentPartsBackgrounds: true }), false);
  }
  await applyCanonicalProductionMigrations(pool);
  for (const bookSlug of ["ultimate-b1", "ultimate-b1-plus"]) {
    const ui = { schemaVersion: "1.0", packageId: `${bookSlug}-students-book`, assets: {} };
    assert.equal(await verify(ui), true);
    assert.equal(await verify({ ...ui, overviewCaptionFontFamily: "Georgia", independentPartsBackgrounds: true }), true);
    for (const invalid of [{ overviewCaptionFontFamily: "unapproved" }, { overviewCaptionFontFamily: null }, { independentPartsBackgrounds: "true" }, { independentPartsBackgrounds: false }, { unknown: true }]) assert.equal(await verify({ ...ui, ...invalid }), false);
    for (const { id } of HOSTED_EDITABLE_UI_BINDINGS.filter((binding) => binding.mediaFamily === "raster")) {
      const asset = { sha256: "a".repeat(64), extension: "png", mediaType: "image/png", sizeBytes: 100, width: 20, height: 10 };
      assert.equal(await verify({ ...ui, assets: { [id]: asset } }), true, id);
      assert.equal(await verify({ ...ui, assets: { [id]: { ...asset, width: 0 } } }), false, `${id}: invalid dimensions`);
    }
  }
});
