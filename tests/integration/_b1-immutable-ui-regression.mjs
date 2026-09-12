import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { publishedManagedUiFixture } from "../fixtures/published-managed-ui.js";
import { verifyImmutableComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";

export async function verifyB1ImmutableUi({ pool, actor, save, media, publication }) {
  const post = async (book, action, body) => publication({ path: `/builder/api/publication/books/${book}/${action}`, httpMethod: "POST",
    headers: { host: "builder.example", origin: "https://builder.example", "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const book of ["ultimate-b1", "ultimate-b1-plus"]) {
    const slug = `${book}-students-book`, ui = await publishedManagedUiFixture(slug);
    ui.payload.overviewCaptionFontFamily = "Georgia";
    ui.payload.independentPartsBackgrounds = true;
    for (const component of ["students-book", "workbook", "grammar-book"]) ui.payload.assets[`background.${component}-parts`] = { ...ui.payload.assets["background.main"] };
    ui.sha256 = builderDocumentSha256(ui.payload);
    for (const [key, bytes] of ui.objects) media.set(key, bytes);
    await save(book, slug, "ui-controller", ui.payload);
    const soundKey = [...ui.objects.keys()].find((key) => key.endsWith(".wav")), originalSound = media.get(soundKey);
    media.delete(soundKey);
    const missing = await post(book, "prepare", { clientMutationId: randomUUID(), releaseNote: "Missing UI fixture" });
    assert.equal(missing.statusCode, 409, missing.body); media.set(soundKey, originalSound);
    const result = await post(book, "prepare", { clientMutationId: randomUUID(), releaseNote: "Immutable UI fixture" });
    assert.equal(result.statusCode, 200, result.body); const prepared = JSON.parse(result.body);
    const rows = (await pool.query("select r.* from book_component_releases r join book_product_release_members m on m.component_release_id=r.id where m.product_release_id=$1 order by m.member_order", [prepared.productReleaseId])).rows;
    const frozen = JSON.stringify(rows), sb = rows[0]; verifyImmutableComponentRelease(sb);
    assert.equal(sb.compiler_id, `${slug}-v2`); assert.equal(sb.teacher_projection.ui.packageId, slug);
    assert.equal(sb.teacher_projection.ui.overviewCaptionFontFamily, "Georgia");
    assert.equal(sb.teacher_projection.ui.independentPartsBackgrounds, true);
    assert.equal(rows[1].compiler_id, `${book}-workbook-v1`); assert.equal(Object.hasOwn(rows[1].teacher_projection, "ui"), false);
    assert.equal((await pool.query("select builder_b1_product_integrity($1) valid", [prepared.productReleaseId])).rows[0].valid, true);
    assert.equal((await pool.query("select count(*)::int count from book_component_release_asset_pins where component_release_id=$1 and asset_role='teacher_ui'", [sb.id])).rows[0].count, 0);
    assert.ok((await pool.query("select count(*)::int count from book_component_release_asset_pins where component_release_id=$1", [sb.id])).rows[0].count > 0);
    // The collector validates but retains authored bytes; projection normalization
    // must not change the source checksum or make a valid raw document stale.
    const raw = structuredClone(ui.payload);
    raw.assets['sound.correct'].extension = 'WAV'; raw.assets['sound.correct'].mediaType = 'AUDIO/WAV';
    const revision = (await pool.query("select revision from builder_component_documents where book_component_id=$1 and document_type='teacher_ui' and document_key='default'", [sb.book_component_id])).rows[0].revision;
    const rawHash = builderDocumentSha256(raw);
    assert.equal((await pool.query("select outcome from save_builder_component_document($1,$2,'teacher_ui','default','1.0',$3,$4::jsonb,$5,$6,$7)", [book, slug, revision, JSON.stringify(raw), rawHash, actor, randomUUID()])).rows[0].outcome, 'saved');
    const rawResult = await post(book, 'prepare', { clientMutationId: randomUUID(), releaseNote: 'Raw authored UI fixture' });
    assert.equal(rawResult.statusCode, 200, rawResult.body);
    const rawRelease = (await pool.query("select r.* from book_component_releases r join book_product_release_members m on m.component_release_id=r.id where m.product_release_id=$1 and m.member_order=1", [JSON.parse(rawResult.body).productReleaseId])).rows[0];
    assert.equal(rawRelease.source_snapshot.teacherUi.sha256, rawHash);
    assert.deepEqual(rawRelease.teacher_projection.ui, sb.teacher_projection.ui);
    const changed = await publishedManagedUiFixture(slug, 1); for (const [key, bytes] of changed.objects) media.set(key, bytes);
    await save(book, slug, "ui-controller", changed.payload);
    const newerResult = await post(book, "prepare", { clientMutationId: randomUUID(), releaseNote: "Changed UI fixture" });
    assert.equal(newerResult.statusCode, 200, newerResult.body);
    const newer = (await pool.query("select r.* from book_component_releases r join book_product_release_members m on m.component_release_id=r.id where m.product_release_id=$1 and m.member_order=1", [JSON.parse(newerResult.body).productReleaseId])).rows[0];
    assert.notEqual(newer.source_snapshot_sha256, sb.source_snapshot_sha256); assert.notEqual(newer.release_sha256, sb.release_sha256);
    assert.equal((await pool.query("select builder_product_release_sources_are_current($1) current", [prepared.productReleaseId])).rows[0].current, false);
    assert.equal((await pool.query("select outcome from publish_builder_product_release($1,$2,0,$3,$4,$5)", [book, prepared.productReleaseId, "d".repeat(64), actor, randomUUID()])).rows[0].outcome, "stale_release_preview");
    const stale = await post(book, "publish", { productReleaseId: prepared.productReleaseId, expectedHeadRevision: 0, clientMutationId: randomUUID() });
    assert.equal(stale.statusCode, 409); assert.equal(JSON.parse(stale.body).error, "stale_release_preview");
    const reread = (await pool.query("select r.* from book_component_releases r join book_product_release_members m on m.component_release_id=r.id where m.product_release_id=$1 order by m.member_order", [prepared.productReleaseId])).rows;
    assert.equal(JSON.stringify(reread), frozen); for (const r of reread) verifyImmutableComponentRelease(r);
    assert.equal((await pool.query("select builder_b1_product_integrity($1) valid", [prepared.productReleaseId])).rows[0].valid, true, "Immutable validity does not depend on current UI draft");
    await save(book, slug, "ui-controller", ui.payload);
  }
}
