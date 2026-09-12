import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";
import { createBuilderPagesHandler } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js";
import { resolvePublicationCompiler, verifyImmutableComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { freezeComponentPublicationAssetPins } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js";
import { createProductRelease, loadProductRelease, productPublicationDatabaseReady } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-store.js";
import { verifyProductReleaseEnvelope } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-domain.js";
import { clientSql } from "./_b1-page-placement-regression.mjs";
import { verifyOverviewPre064 } from "./_overview-pre064-regression.mjs";
import { verifyOverviewPre065 } from "./_overview-pre065-regression.mjs";

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
test("063 preserves historical B1/B1+ families and serves legacy publication before optional 064 UI activation", { skip: !enabled }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL); assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  const schema = `ui_history_${randomBytes(8).toString("hex")}`, admin = new pg.Pool({ connectionString: url.href, max: 1 });
  await admin.query(`create schema "${schema}"`); url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.href, max: 2 }), sql = clientSql(pool);
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool, { through: "062_b1_managed_publication.sql" });
  const actor = randomUUID(); await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Historical UI fixture',$2,'synthetic')", [actor, `${actor}@example.test`]);
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#397c82' } }).png().toBuffer();
  const media = new Map(), checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const storage = { bucket: () => "private-assets", signedPutUrl: async () => ({ url: "https://isolated.invalid/upload", headers: {} }),
    download: async ({ objectKey }) => { assert.ok(media.has(objectKey)); return media.get(objectKey); },
    upload: async ({ objectKey, body }) => { media.set(objectKey, Buffer.from(body)); }, delete: async ({ objectKey }) => media.delete(objectKey),
    head: async ({ objectKey }) => { assert.ok(media.has(objectKey)); return { checksumSha256, byteSize: bytes.length, contentType: "image/png" }; } };
  const pages = createBuilderPagesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }), storage: () => storage });
  const call = async (path, body) => { const response = await pages({ path, httpMethod: "POST", headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, body: JSON.stringify(body) }); assert.equal(response.statusCode, 200, response.body); return JSON.parse(response.body); };
  const families = [], historicalInputs = [];
  for (const book of ["ultimate-b1", "ultimate-b1-plus"]) {
    const members = [];
    for (const suffix of ["students-book", "workbook"]) {
      const slug = `${book}-${suffix}`, mutation = randomUUID();
      const unit = (await pool.query("select id from units where book_component_id=(select id from book_components where slug=$1) and unit_number=1", [slug])).rows[0];
      const prefix = `/builder/api/pages/books/${book}/components/${slug}/assets`;
      const prepared = await call(`${prefix}/prepare`, { mode: "create", pageId: "", expectedRevision: 0, clientMutationId: mutation,
        metadata: { unitId: unit.id, label: "Historical page", printedLabel: "1", sortOrder: 1 }, file: { name: "synthetic.png", type: "image/png", size: bytes.length } });
      const session = (await pool.query("select staging_object_key from builder_component_page_upload_sessions where id=$1", [prepared.uploadId])).rows[0]; media.set(session.staging_object_key, bytes);
      await call(`${prefix}/finalize`, { uploadId: prepared.uploadId, expectedRevision: 0, clientMutationId: mutation });
      const compiler = resolvePublicationCompiler(`${slug}-v1`, "1.0"), compiled = compiler.compile(await compiler.collect(sql));
      const assetPins = await freezeComponentPublicationAssetPins(storage, { bookSlug: book, componentSlug: slug, ...compiled });
      members.push({ ...compiled, componentSlug: slug, releaseId: randomUUID(), requestSha256: compiled.releaseSha256, assetStorageMode: "pinned-source-v1", assetPins });
    }
    const input = { bookSlug: book, productReleaseId: randomUUID(), compilerId: `${book}-product-v1`, releaseSchemaVersion: "1.0", members,
      requestSha256: "a".repeat(64), releaseNote: "Historical v1", builderUserId: actor, clientMutationId: randomUUID() };
    const created = await createProductRelease(sql, input); assert.equal(created.outcome, "created");
    historicalInputs.push(input);
    assert.equal((await pool.query("select outcome from publish_builder_product_release($1,$2,0,$3,$4,$5)", [book, created.productReleaseId, "b".repeat(64), actor, randomUUID()])).rows[0].outcome, "published");
    families.push({ book, id: created.productReleaseId });
  }
  const tables = ["book_component_releases", "book_product_releases", "book_product_release_members", "book_component_release_asset_pins", "book_component_publication_heads", "book_product_publication_heads", "book_component_publication_events", "book_product_publication_mutations"];
  const capture = async () => Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await pool.query(`select row_to_json(t)::text value from ${table} t order by row_to_json(t)::text`)).rows.map((r) => r.value)])));
  const before = await capture();
  const verify = async () => {
    for (const r of (await pool.query("select *,builder_b1_component_integrity(id) valid from book_component_releases")).rows) { assert.equal(r.valid, true); verifyImmutableComponentRelease(r); assert.equal(Object.hasOwn(r.teacher_projection, "ui"), false); }
    for (const family of families) {
      assert.equal((await pool.query("select builder_b1_product_integrity($1) valid", [family.id])).rows[0].valid, true);
      const { current, headRevision, publishedAt, ...product } = await loadProductRelease(sql, { bookSlug: family.book, productReleaseId: family.id });
      product.members = product.members.map(({ sourceSnapshotSha256, ...member }) => member);
      verifyProductReleaseEnvelope(product);
    }
  };
  await verify();
  assert.equal(await productPublicationDatabaseReady(sql, 'ultimate-b1'), false, 'Current v2 PREPARE remains gated on 063');
  await applyCanonicalProductionMigrations(pool, { through: "063_b1_immutable_package_ui.sql" });
  assert.equal(await productPublicationDatabaseReady(sql, 'ultimate-b1'), true);
  await verify(); assert.deepEqual(await capture(), before);
  for (const input of historicalInputs) assert.equal((await createProductRelease(sql, { ...input, productReleaseId: randomUUID(), clientMutationId: randomUUID() })).outcome, 'invalid_request', 'Current SQL writer cannot prepare a new product-v1');
  await verifyOverviewPre064({ pool, sql, actor, storage, families });
  await verifyOverviewPre065({ pool, sql, actor, storage, families });
});
