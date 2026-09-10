import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { compileUltimateB2ComponentReleaseV2 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compiler-v2.js";
import { compileUltimateB2ManagedComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-managed-publication-compiler.js";
import {
  collectUltimateB2ManagedPublicationSources,
  collectUltimateB2PublicationV2Sources,
  createComponentRelease,
  publicationAssetPinDatabaseReady,
  publishComponentRelease,
} from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-store.js";
import { productPublicationPinDatabaseReady } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-store.js";
import {
  productReleaseMemberSha256,
  productReleaseSha256,
  productReleaseSourceSha256,
  verifyProductReleaseEnvelope,
} from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-domain.js";
import { publicationAssetPinFingerprint } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js";
import { loadProductionMigrationManifest } from "../../scripts/_migration-readiness.mjs";
import { mutateBuilderPage } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages-store.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl) && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";
const actor = "10000000-0000-4000-8000-000000000048";
const hash = (character) => character.repeat(64);

function scoped(base, schema) {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function tag(pool) {
  return async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1]}`;
    return (await pool.query(text, values)).rows;
  };
}

async function apply(pool, migrations) {
  for (const migration of migrations) {
    await pool.query("begin");
    try {
      await pool.query(migration.sql);
      await pool.query("insert into eduforge_migration_history(filename,checksum_sha256) values($1,$2)", [migration.filename, migration.checksum]);
      await pool.query("commit");
    } catch (error) {
      await pool.query("rollback").catch(() => {});
      throw error;
    }
  }
}

function componentInput(componentSlug, compilerId, releaseSchemaVersion, marker) {
  const sourceSnapshot = compilerId === "ultimate-b2-students-book-v2" ? null : {
    pages: { revision: 0 },
    hotspots: { revision: 0, sha256: hash(marker) },
    activityLifecycle: { revision: 0, sha256: hash(marker) },
    nativeIndex: { revision: 0, sha256: hash(marker) },
    nativeActivities: {},
  };
  return {
    componentSlug,
    compilerId,
    releaseSchemaVersion,
    releaseId: randomUUID(),
    compatibility: hash(marker),
    sourceSnapshot,
    sourceSnapshotSha256: hash(marker),
    publicProjection: { componentSlug, marker },
    publicProjectionSha256: hash(marker),
    teacherProjection: { componentSlug, marker },
    teacherProjectionSha256: hash(marker),
    assetManifest: [],
    releaseSha256: hash(marker),
    requestSha256: hash(marker),
  };
}

async function createProduct(pool, { productReleaseId, members, mutationId, requestSha256 = hash("9") }) {
  return (await pool.query(
    "select * from create_builder_pinned_product_release($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)",
    [productReleaseId, "ultimate-b2", "1.0", "ultimate-b2-product-v1", JSON.stringify(members), requestSha256, "Atomic family", actor, mutationId],
  )).rows[0];
}

test("migrations 048/049/050 preserve truthful legacy families and publish exact three-member role-scoped pinned products atomically", { skip: !enabled, timeout: 120_000 }, async (t) => {
  const schema = `builder_product_publication_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const pool = new Pool({ connectionString: scoped(databaseUrl, schema), max: 4 });
  t.after(async () => {
    await pool.end();
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });

  const migrations = await loadProductionMigrationManifest();
  const productMigrationIndex = migrations.findIndex((migration) => migration.filename === "048_ultimate_b2_product_publication.sql");
  const pinMigrationIndex = migrations.findIndex((migration) => migration.filename === "049_builder_publication_asset_pins.sql");
  const rolePinMigrationIndex = migrations.findIndex((migration) => migration.filename === "050_builder_publication_role_scoped_asset_pins.sql");
  assert.equal(pinMigrationIndex, productMigrationIndex + 1);
  assert.equal(rolePinMigrationIndex, pinMigrationIndex + 1);
  assert.ok(migrations.slice(rolePinMigrationIndex + 1).some((migration) => migration.filename === "051_builder_page_deletion_lifecycle.sql"));
  await pool.query("create table eduforge_migration_history(filename text primary key,checksum_sha256 text not null,applied_at timestamptz not null default now())");
  await apply(pool, migrations.slice(0, productMigrationIndex));
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'Product Publication Integration','product-publication@example.test','not-a-real-login-hash')", [actor]);
  const sql = tag(pool);

  const legacyCompiled = compileUltimateB2ComponentReleaseV2(await collectUltimateB2PublicationV2Sources(sql));
  const legacyCreated = await createComponentRelease(sql, {
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    ...legacyCompiled,
    requestSha256: legacyCompiled.releaseSha256,
    releaseNote: "Students only",
    clientMutationId: randomUUID(),
    builderUserId: actor,
  });
  assert.equal(legacyCreated.outcome, "created");
  const legacyPublished = await publishComponentRelease(sql, {
    bookSlug: "ultimate-b2",
    componentSlug: "ultimate-b2-students-book",
    releaseId: legacyCreated.releaseId,
    expectedHeadRevision: 0,
    requestSha256: hash("8"),
    builderUserId: actor,
    clientMutationId: randomUUID(),
  });
  assert.equal(legacyPublished.outcome, "published");

  await apply(pool, migrations.slice(productMigrationIndex, rolePinMigrationIndex));
  assert.equal(await publicationAssetPinDatabaseReady(sql), false);
  assert.equal(await productPublicationPinDatabaseReady(sql), false);
  await apply(pool, migrations.slice(rolePinMigrationIndex));
  assert.equal(await publicationAssetPinDatabaseReady(sql), true);
  assert.equal(await productPublicationPinDatabaseReady(sql), true);
  const legacy = (await pool.query(`
    select product.id,product.release_number,product.compiler_id,product.release_schema_version,
      product.source_snapshot_sha256,product.release_sha256,coalesce(product.release_note,'') release_note,product.created_at,
      jsonb_agg(jsonb_build_object(
        'componentSlug',component.slug,'order',member.member_order,'status',member.member_status,
        'componentReleaseId',member.component_release_id,'compilerId',member.component_compiler_id,
        'releaseSchemaVersion',member.component_release_schema_version,'releaseSha256',member.component_release_sha256,
        'compatibility',member.runtime_compatibility_sha256,'memberSha256',member.member_sha256,
        'unavailableReason',member.unavailable_reason
      ) order by member.member_order) members
    from book_product_releases product
    join book_product_release_members member on member.product_release_id=product.id
    join book_components component on component.id=member.book_component_id
    where product.compiler_id='ultimate-b2-product-legacy-v1'
    group by product.id
  `)).rows[0];
  const legacyEnvelope = verifyProductReleaseEnvelope({
    id: legacy.id,
    number: Number(legacy.release_number),
    bookSlug: "ultimate-b2",
    compilerId: legacy.compiler_id,
    releaseSchemaVersion: legacy.release_schema_version,
    sourceSnapshotSha256: legacy.source_snapshot_sha256,
    releaseSha256: legacy.release_sha256,
    releaseNote: legacy.release_note,
    createdAt: legacy.created_at.toISOString(),
    members: legacy.members.map((member) => ({ ...member, order: Number(member.order) })),
  });
  assert.equal(legacyEnvelope.members[0].componentReleaseId, legacyCreated.releaseId);
  assert.equal((await pool.query("select asset_storage_mode from book_component_releases where id=$1", [legacyCreated.releaseId])).rows[0].asset_storage_mode, "materialized-v1");
  assert.deepEqual(legacyEnvelope.members.slice(1).map((member) => [member.status, member.unavailableReason]), [
    ["unavailable", "not_in_legacy_release"],
    ["unavailable", "not_in_legacy_release"],
  ]);
  assert.equal((await pool.query("select head_revision from book_product_publication_heads")).rows[0].head_revision, "1");
  const legacyRepublish = (await pool.query("select * from publish_builder_product_release($1,$2,$3,$4,$5,$6)", ["ultimate-b2", legacy.id, 1, hash("5"), actor, randomUUID()])).rows[0];
  assert.equal(legacyRepublish.outcome, "incomplete_product_release");

  const studentsCompiled = compileUltimateB2ComponentReleaseV2(await collectUltimateB2PublicationV2Sources(sql));
  const students = { ...componentInput("ultimate-b2-students-book", "ultimate-b2-students-book-v2", "2.0", "a"), ...studentsCompiled, releaseId: randomUUID(), requestSha256: studentsCompiled.releaseSha256 };
  const workbook = { ...compileUltimateB2ManagedComponentRelease(await collectUltimateB2ManagedPublicationSources(sql, "ultimate-b2-workbook"), "ultimate-b2-workbook"), componentSlug: "ultimate-b2-workbook", releaseId: randomUUID(), requestSha256: hash("b") };
  const grammar = { ...compileUltimateB2ManagedComponentRelease(await collectUltimateB2ManagedPublicationSources(sql, "ultimate-b2-grammar-book"), "ultimate-b2-grammar-book"), componentSlug: "ultimate-b2-grammar-book", releaseId: randomUUID(), requestSha256: hash("c") };
  assert.equal(workbook.publicProjection.units.length, 10);
  assert.equal(grammar.publicProjection.units.length, 10);
  const scope = (await pool.query(`
    select package.id package_id,component.id component_id,unit_record.id unit_id
    from book_packages package join book_components component on component.book_package_id=package.id
    join units unit_record on unit_record.book_component_id=component.id
    where package.slug='ultimate-b2' and component.slug='ultimate-b2-workbook' order by unit_record.sort_order limit 1
  `)).rows[0];
  const edition = (await pool.query("insert into book_editions(book_package_id,edition_identifier,title) values($1,'pin-test','Pin test') returning id", [scope.package_id])).rows[0];
  const pageId = randomUUID();
  await pool.query("insert into book_pages(id,book_package_id,book_component_id,unit_id,stable_key,label) values($1,$2,$3,$4,'ultimate-b2-workbook/pages/pin-page','Pin page')", [pageId, scope.package_id, scope.component_id, scope.unit_id]);
  const pinnedAssetId = randomUUID();
  const pinChecksum = hash("d");
  const pinObjectKey = `builder-page-assets/ultimate-b2/ultimate-b2-workbook/pin-page/assets/${pinChecksum}.png`;
  await pool.query(`insert into book_assets(id,book_package_id,edition_id,book_component_id,unit_id,page_id,stable_logical_key,asset_role,
    object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,width,height,edition_identifier,version,publication_status,access_level)
    values($1,$2,$3,$4,$5,$6,'ultimate-b2.pin-test.page','page_image',$7,'private','private-fixture','image/png',68,$8,1,1,'pin-test','v1','draft','internal')`,
  [pinnedAssetId, scope.package_id, edition.id, scope.component_id, scope.unit_id, pageId, pinObjectKey, pinChecksum]);
  const descriptor = { sha256: pinChecksum, extension: "png", mediaType: "image/png", role: "managed_page_image" };
  const pinBase = { assetId: pinnedAssetId, role: descriptor.role, sourceAssetRole: "page_image", checksumSha256: pinChecksum, byteSize: 68,
    mediaType: descriptor.mediaType, extension: descriptor.extension, storageProfile: "private", storageBucket: "private-fixture",
    objectKey: pinObjectKey, ownerKey: "pin-page", assetSlot: "" };
  const pin = { ...pinBase, pinSha256: createHash("sha256").update(publicationAssetPinFingerprint(pinBase)).digest("hex") };
  workbook.assetManifest = [descriptor];
  const studentsScope = (await pool.query(`select component.id component_id,unit_record.id unit_id,unit_record.slug unit_slug
    from book_components component join units unit_record on unit_record.book_component_id=component.id
    where component.slug='ultimate-b2-students-book' order by unit_record.sort_order limit 1`)).rows[0];
  const videoItem = "video-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const videoChecksum = hash("e");
  const videoObjectKey = `builder-unit-extra-assets/ultimate-b2/ultimate-b2-students-book/${studentsScope.unit_slug}/${videoItem}/assets/${videoChecksum}.mp4`;
  const pinnedVideoAssetId = randomUUID();
  const unpinnedVideoAssetId = randomUUID();
  for (const [assetId, itemId, digest] of [[pinnedVideoAssetId, videoItem, videoChecksum], [unpinnedVideoAssetId, "video-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", hash("f")]]) {
    const key = `builder-unit-extra-assets/ultimate-b2/ultimate-b2-students-book/${studentsScope.unit_slug}/${itemId}/assets/${digest}.mp4`;
    await pool.query(`insert into book_assets(id,book_package_id,edition_id,book_component_id,unit_id,stable_logical_key,asset_role,
      object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,duration_seconds,edition_identifier,version,publication_status,access_level,source_metadata)
      values($1,$2,$3,$4,$5,$6,'unit_extra_video',$7,'private','private-fixture','video/mp4',4096,$8,10,'pin-test',$9,'draft','internal',$10::jsonb)`,
    [assetId, scope.package_id, edition.id, studentsScope.component_id, studentsScope.unit_id, `ultimate-b2.pin-test.${itemId}`, key, digest, itemId, JSON.stringify({ unit_slug: studentsScope.unit_slug, unit_extra_item_id: itemId, asset_slot: itemId })]);
  }
  const videoDescriptor = { sha256: videoChecksum, extension: "mp4", mediaType: "video/mp4", role: "unit_extra_video" };
  const videoPinBase = { assetId: pinnedVideoAssetId, role: videoDescriptor.role, sourceAssetRole: videoDescriptor.role, checksumSha256: videoChecksum,
    byteSize: 4096, mediaType: videoDescriptor.mediaType, extension: videoDescriptor.extension, storageProfile: "private", storageBucket: "private-fixture",
    objectKey: videoObjectKey, ownerKey: videoItem, assetSlot: videoItem };
  const videoPin = { ...videoPinBase, pinSha256: createHash("sha256").update(publicationAssetPinFingerprint(videoPinBase)).digest("hex") };
  const artworkAssetId = randomUUID();
  const artworkOwner = "ultimate-b2-sb-u1-p1-o77";
  const artworkSlot = "shared-video";
  const artworkObjectKey = `builder-native-assets/ultimate-b2/ultimate-b2-students-book/${artworkOwner}/assets/${artworkSlot}/${videoChecksum}.mp4`;
  await pool.query(`insert into book_assets(id,book_package_id,edition_id,book_component_id,unit_id,stable_logical_key,asset_role,
    object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,duration_seconds,edition_identifier,version,publication_status,access_level,source_metadata)
    values($1,$2,$3,$4,$5,$6,'activity_artwork',$7,'private','private-fixture','video/mp4',4096,$8,10,'pin-test','shared-video','archived','internal',$9::jsonb)`,
  [artworkAssetId, scope.package_id, edition.id, studentsScope.component_id, studentsScope.unit_id, `ultimate-b2.pin-test.${artworkOwner}`, artworkObjectKey, videoChecksum, JSON.stringify({ native_activity_id: artworkOwner, asset_slot: artworkSlot })]);
  await pool.query("update book_assets set publication_status='draft' where id=$1", [artworkAssetId]);
  const artworkDescriptor = { ...videoDescriptor, role: "activity_artwork" };
  const artworkPinBase = { ...videoPinBase, assetId: artworkAssetId, role: artworkDescriptor.role, sourceAssetRole: artworkDescriptor.role,
    objectKey: artworkObjectKey, ownerKey: artworkOwner, assetSlot: artworkSlot };
  const artworkPin = { ...artworkPinBase, pinSha256: createHash("sha256").update(publicationAssetPinFingerprint(artworkPinBase)).digest("hex") };
  students.assetManifest = [artworkDescriptor, videoDescriptor];
  const members = [students, workbook, grammar].map((member) => ({ ...member, assetStorageMode: "pinned-source-v1", assetPins: member === workbook ? [pin] : member === students ? [artworkPin, videoPin] : [] }));
  const mutationId = randomUUID();
  const productReleaseId = randomUUID();
  const before = (await pool.query("select count(*)::int count from book_component_releases")).rows[0].count;
  const created = await createProduct(pool, { productReleaseId, members, mutationId });
  assert.equal(created.outcome, "created");
  assert.equal(created.product_release_number, "2");
  assert.equal(created.members.length, 3);
  assert.equal((await createProduct(pool, { productReleaseId, members, mutationId })).outcome, "idempotent");
  assert.equal((await createProduct(pool, { productReleaseId, members, mutationId, requestSha256: hash("7") })).outcome, "mutation_id_conflict");
  assert.equal((await pool.query("select count(*)::int count from book_component_releases")).rows[0].count, before + 3);
  const storedRolePins = (await pool.query("select asset_role,checksum_sha256,extension from book_component_release_asset_pins where component_release_id=$1 order by asset_role", [students.releaseId])).rows;
  assert.deepEqual(storedRolePins, [
    { asset_role: "activity_artwork", checksum_sha256: videoChecksum, extension: "mp4" },
    { asset_role: "unit_extra_video", checksum_sha256: videoChecksum, extension: "mp4" },
  ]);
  assert.deepEqual((await pool.query("select distinct asset_storage_mode from book_component_releases where id=any($1::uuid[])", [members.map((member) => member.releaseId)])).rows, [{ asset_storage_mode: "pinned-source-v1" }]);
  const storedPin = (await pool.query("select * from book_component_release_asset_pins where component_release_id=$1", [workbook.releaseId])).rows[0];
  assert.equal(storedPin.book_asset_id, pinnedAssetId);
  assert.equal(storedPin.object_key, pinObjectKey);
  assert.equal(storedPin.pin_sha256, pin.pinSha256);
  const duplicateRoleMembers = structuredClone(members).map((member) => ({ ...member, releaseId: randomUUID() }));
  duplicateRoleMembers[0].assetManifest = [videoDescriptor, videoDescriptor];
  duplicateRoleMembers[0].assetPins = [videoPin, videoPin];
  await assert.rejects(
    createProduct(pool, { productReleaseId: randomUUID(), members: duplicateRoleMembers, mutationId: randomUUID(), requestSha256: hash("2") }),
    /release_pin_conflict/,
  );
  const archived = (await pool.query("select * from archive_unreferenced_builder_unit_extra_assets('ultimate-b2','ultimate-b2-students-book',$1)", [actor])).rows;
  assert.equal(archived.some((row) => row.asset_id === pinnedVideoAssetId), false);
  assert.equal(archived.some((row) => row.asset_id === unpinnedVideoAssetId), true);
  assert.equal((await pool.query("select publication_status from book_assets where id=$1", [pinnedVideoAssetId])).rows[0].publication_status, "draft");
  assert.equal((await pool.query("select publication_status from book_assets where id=$1", [unpinnedVideoAssetId])).rows[0].publication_status, "archived");

  const releasesBeforeInvalid = (await pool.query("select count(*)::int count from book_component_releases")).rows[0].count;
  const productsBeforeInvalid = (await pool.query("select count(*)::int count from book_product_releases")).rows[0].count;
  const invalidMembers = structuredClone(members).map((member) => ({ ...member, releaseId: randomUUID() }));
  const invalidPin = invalidMembers[1].assetPins[0];
  invalidPin.assetId = randomUUID();
  invalidPin.pinSha256 = createHash("sha256").update(publicationAssetPinFingerprint(invalidPin)).digest("hex");
  await assert.rejects(createProduct(pool, { productReleaseId: randomUUID(), members: invalidMembers, mutationId: randomUUID(), requestSha256: hash("6") }), /release_pin_integrity_failed/);
  assert.equal((await pool.query("select count(*)::int count from book_component_releases")).rows[0].count, releasesBeforeInvalid);
  assert.equal((await pool.query("select count(*)::int count from book_product_releases")).rows[0].count, productsBeforeInvalid);

  const malformed = structuredClone(members);
  malformed[2].compilerId = "wrong-compiler";
  await assert.rejects(createProduct(pool, { productReleaseId: randomUUID(), members: malformed, mutationId: randomUUID() }), /product member identity is invalid/);
  assert.equal((await pool.query("select count(*)::int count from book_component_releases")).rows[0].count, before + 3);

  const memberRows = created.members.map((member) => ({ ...member, order: Number(member.order) }));
  for (const member of memberRows) assert.equal(member.memberSha256, productReleaseMemberSha256(member));
  assert.equal(created.source_snapshot_sha256, productReleaseSourceSha256({ bookSlug: "ultimate-b2", releaseNumber: 2, members: memberRows }));
  assert.equal(created.release_sha256, productReleaseSha256({ compilerId: "ultimate-b2-product-v1", releaseSchemaVersion: "1.0", bookSlug: "ultimate-b2", releaseNumber: 2, sourceSnapshotSha256: created.source_snapshot_sha256, releaseNote: "Atomic family", members: memberRows }));

  const publishMutation = randomUUID();
  const published = (await pool.query("select * from publish_builder_product_release($1,$2,$3,$4,$5,$6)", ["ultimate-b2", productReleaseId, 1, hash("6"), actor, publishMutation])).rows[0];
  assert.equal(published.outcome, "published");
  assert.equal(published.head_revision, "2");
  assert.equal((await pool.query("select count(*)::int count from book_component_publication_heads")).rows[0].count, 3);
  assert.deepEqual((await pool.query(`
    select component.slug,release.id release_id from book_component_publication_heads head
    join book_components component on component.id=head.book_component_id
    join book_component_releases release on release.id=head.release_id
    where component.slug in ('ultimate-b2-students-book','ultimate-b2-workbook','ultimate-b2-grammar-book') order by component.sort_order
  `)).rows.map((row) => [row.slug, row.release_id]), memberRows.map((member) => [member.componentSlug, member.componentReleaseId]));
  assert.equal((await pool.query("select * from publish_builder_product_release($1,$2,$3,$4,$5,$6)", ["ultimate-b2", productReleaseId, 1, hash("6"), actor, publishMutation])).rows[0].outcome, "idempotent");

  await assert.rejects(pool.query("update book_product_releases set release_note='changed' where id=$1", [productReleaseId]), /immutable/);
  await assert.rejects(pool.query("delete from book_product_release_members where product_release_id=$1", [productReleaseId]), /immutable/);
  await assert.rejects(pool.query("delete from book_component_releases where id=$1", [workbook.releaseId]), /immutable/);
  await assert.rejects(pool.query("update book_component_release_asset_pins set byte_size=69 where component_release_id=$1", [workbook.releaseId]), /immutable/);
  await assert.rejects(pool.query("delete from book_component_release_asset_pins where component_release_id=$1", [workbook.releaseId]), /immutable/);
  await assert.rejects(pool.query("update book_assets set object_key=object_key||'-changed' where id=$1", [pinnedAssetId]), /pinned_book_asset_identity_immutable/);
  await assert.rejects(pool.query("delete from book_assets where id=$1", [pinnedAssetId]), /pinned_book_asset_identity_immutable/);

  const concurrentInputs = ["3", "4"].map((marker) => ({
    productReleaseId: randomUUID(),
    members: structuredClone(members).map((member) => ({ ...member, releaseId: randomUUID() })),
    mutationId: randomUUID(),
    requestSha256: hash(marker),
  }));
  const concurrent = await Promise.all(concurrentInputs.map((input) => createProduct(pool, input)));
  assert.deepEqual(concurrent.map((result) => result.outcome), ["created", "created"]);
  assert.deepEqual(concurrent.map((result) => Number(result.product_release_number)).sort((left, right) => left - right), [3, 4]);
  assert.deepEqual(concurrent.map((result) => result.members.length), [3, 3]);
  const concurrentPinCount = await pool.query(`
    select count(*)::int count from book_component_release_asset_pins pin
    join book_product_release_members member on member.component_release_id=pin.component_release_id
    where member.product_release_id=any($1::uuid[])
  `, [concurrent.map((result) => result.product_release_id)]);
  assert.equal(concurrentPinCount.rows[0].count, 6);
  assert.equal((await pool.query("update book_assets set publication_status='archived' where id=$1 returning publication_status", [pinnedAssetId])).rows[0].publication_status, "archived");
  if (migrations.some((migration) => migration.filename === '062_b1_managed_publication.sql')) {
    const frozenPins = (await pool.query('select * from book_component_release_asset_pins order by component_release_id,pin_sha256')).rows;
    const frozenReleases = (await pool.query('select * from book_component_releases order by id')).rows;
    await pool.query("update book_assets set publication_status='draft' where id=$1", [pinnedAssetId]);
    const targetUnit = (await pool.query('select id from units where book_component_id=$1 and unit_number=2', [scope.component_id])).rows[0].id;
    const revision = Number((await pool.query('select revision from builder_component_page_revisions where book_component_id=$1', [scope.component_id])).rows[0]?.revision || 0);
    const input = { bookSlug: 'ultimate-b2', componentSlug: 'ultimate-b2-workbook', pageKey: 'ultimate-b2-workbook/pages/pin-page', action: 'metadata', expectedRevision: revision,
      clientMutationId: randomUUID(), pageMetadata: { label: 'Moved pinned page', printedLabel: '', sortOrder: 1, unitId: targetUnit }, builderUserId: actor };
    assert.equal((await mutateBuilderPage(sql, input)).outcome, 'saved');
    assert.equal((await mutateBuilderPage(sql, input)).outcome, 'idempotent');
    assert.equal((await pool.query('select unit_id from book_pages where id=$1', [pageId])).rows[0].unit_id, targetUnit);
    assert.equal((await pool.query('select unit_id from book_assets where id=$1', [pinnedAssetId])).rows[0].unit_id, scope.unit_id);
    assert.equal((await pool.query("update book_assets set publication_status='archived' where id=$1 returning publication_status", [pinnedAssetId])).rows[0].publication_status, 'archived');
    assert.deepEqual((await pool.query('select * from book_component_release_asset_pins order by component_release_id,pin_sha256')).rows, frozenPins);
    assert.deepEqual((await pool.query('select * from book_component_releases order by id')).rows, frozenReleases);
  }
});
