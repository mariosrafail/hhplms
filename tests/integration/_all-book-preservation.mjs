import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import syntheticMedia from "../fixtures/students-book-synthetic-media.json" with { type: "json" };
import { createPublicationV2FixtureSources } from "../fixtures/publication-v2.js";
import { publicDocument as multiPublic, teacherDocument as multiTeacher, imageTeacher } from "../fixtures/native-runtime-regressions/multi-part-data.js";
import { resolveNativeActivityKind } from "../../netlify-sites/ultimate-b2-builder/server/_native-activity-registry.js";
import { builderDocumentSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js";
import { loadBuilderPages, prepareBuilderPageUpload, claimBuilderPageUpload, completeBuilderPageUpload } from "../../netlify-sites/ultimate-b2-builder/server/_builder-pages-store.js";
import { compileUltimateB2ManagedComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-managed-publication-compiler.js";
import { verifyImmutableComponentRelease } from "../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js";
import { productReleaseMemberSha256, productReleaseSourceSha256, productReleaseSha256 } from "../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-domain.js";
import { submitActivity, getAssignmentResults } from "../../netlify/functions/_book-content/submission-actions.js";
import { reviewSubmission } from "../../netlify/functions/_book-content/class-actions.js";
import { getStudentAssignmentDetail } from "../../netlify/functions/_book-content/published-book-actions.js";
import { normalizeUltimateB2UnitExtrasDocument } from "../../src/data/ultimate-b2/unitExtras.js";
import { HOSTED_EDITABLE_UI_BINDINGS } from "../../src/data/ultimate-b2/hostedTeacherUiBindingCatalog.js";
import { normalizeHostedTeacherUiDocument } from "../../src/data/ultimate-b2/hostedTeacherUiDocument.js";
import { deliverPublishedPinnedAsset } from "../../netlify/functions/_book-content/published-pinned-asset-delivery.js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = (payload, revision = 2) => ({ payload, revision, sha256: builderDocumentSha256(payload) });
export const preservationControlComponents = ["ultimate-b2-workbook", "ultimate-b2-grammar-book", ...["ultimate-b1", "ultimate-b1-plus"].flatMap((book) => ["students-book", "workbook", "grammar-book"].map((component) => `${book}-${component}`))];

// Only synthetic authored setup runs here, before the preservation boundary.
// Transition/no-op scenarios must never call lifecycle operations on this set.
export async function seedAllBookPreservation(pool, { actor, media }, { canonicalFonts = false } = {}) {
  const sql = async (strings, ...values) => (await pool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
  const fontBytes = Buffer.from(await readFile(new URL("../fixtures/fonts/Ahem.ttf.base64", import.meta.url), "utf8"), "base64");
  const tone = Buffer.from(syntheticMedia.files["tone.mp3"].base64, "base64");
  const video = Buffer.from(syntheticMedia.files["color.mp4"].base64, "base64");
  assert.equal(digest(tone), syntheticMedia.files["tone.mp3"].sha256);
  assert.equal(digest(video), syntheticMedia.files["color.mp4"].sha256);
  const controls = [];
  for (const [componentIndex, componentSlug] of preservationControlComponents.entries()) {
    const scope = (await pool.query("select component.id component_id,package.id package_id,package.slug book_slug from book_components component join book_packages package on package.id=component.book_package_id where component.slug=$1", [componentSlug])).rows[0];
    assert.ok(scope, componentSlug);
    const units = (await pool.query("select * from units where book_component_id=$1 order by unit_number", [scope.component_id])).rows;
    assert.equal(units.length, 10);
    const bookSlug = scope.book_slug;
    const prefix = componentSlug.endsWith("students-book") ? "sb" : componentSlug.endsWith("workbook") ? "wb" : "gb";
    const pageId = `${prefix}-page-${randomUUID().replaceAll("-", "")}`;
    const deletedId = `${prefix}-page-${randomUUID().replaceAll("-", "")}`;
    const pageImages = [];
    for (const [revision, targetId] of [pageId, pageId, deletedId].entries()) {
      const bytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: { r: 20 + componentIndex * 20, g: 30 + revision * 50, b: 150 } } }).png().toBuffer();
      const checksum = digest(bytes); const uploadId = randomUUID(); const mutation = randomUUID();
      const upload = { bookSlug, componentSlug, pageKey: `${componentSlug}/pages/${targetId}`, mode: revision === 1 ? "replace" : "create", expectedRevision: revision, clientMutationId: mutation, uploadId, requestSha256: checksum, pageMetadata: { label: `Synthetic editorial page ${revision}`, printedLabel: `Folio ${revision}`, sortOrder: 300 + revision, unitId: units[0].id }, fileDescriptor: { name: "synthetic.png", type: "image/png", size: bytes.length }, stagingObjectKey: `builder-page-assets/${bookSlug}/${componentSlug}/${targetId}/${uploadId}/staging/page-image`, builderUserId: actor, expiresAt: "2099-01-01T00:00:00Z" };
      assert.equal((await prepareBuilderPageUpload(sql, upload)).outcome, "prepared");
      assert.equal((await claimBuilderPageUpload(sql, { uploadId, expectedRevision: revision, clientMutationId: mutation, builderUserId: actor })).outcome, "claimed");
      const objectKey = `builder-page-assets/${bookSlug}/${componentSlug}/${targetId}/assets/${checksum}.png`;
      const result = await completeBuilderPageUpload(sql, { uploadId, builderUserId: actor, objectKey, storageBucket: "synthetic-private", mimeType: "image/png", byteSize: bytes.length, checksumSha256: checksum, width: 48, height: 64 });
      assert.equal(result.outcome, "saved"); media.set(objectKey, bytes); pageImages.push(result);
    }
    await pool.query("update book_pages set source_metadata=source_metadata||'{\"is_deleted\":true,\"is_active\":false,\"is_permanently_deleted\":true}' where id=$1", [pageImages[2].page_id]);
    await pool.query("update book_assets set publication_status='archived' where id=$1", [pageImages[2].asset_id]);
    const edition = (await pool.query("select id from book_editions where book_package_id=$1 and edition_identifier='builder-pages'", [scope.package_id])).rows[0];
    async function asset({ bytes, role, slot, activityId, mime = "image/png", extension = "png", width = 48, height = 64 }) {
      const id = randomUUID(); const checksum = digest(bytes);
      const objectKey = role === "activity_font" ? `builder-font-library/${bookSlug}/${componentSlug}/${canonicalFonts ? "assets/" : ""}${checksum}.ttf` : `builder-native-assets/${bookSlug}/${componentSlug}/${activityId}/assets/${role === "native_teacher_answer" ? "teacher-answers/" : ["mp3", "mp4"].includes(extension) ? `${slot}/` : ""}${checksum}.${extension}`;
      const metadata = role === "activity_font" ? { font_library_scope: "component", original_filename: "Ahem.ttf", family_name: "Ahem" } : { native_activity_id: activityId, asset_slot: slot };
      const row = (await pool.query("insert into book_assets(id,book_package_id,book_component_id,edition_id,stable_logical_key,asset_role,object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,width,height,edition_identifier,version,publication_status,access_level,source_metadata) values($1,$2,$3,$4,$5,$6,$7,'private','synthetic-private',$8,$9,$10,$11,$12,'builder-pages',$13,'draft','internal',$14) returning *", [id, scope.package_id, scope.component_id, edition.id, `${bookSlug}.preservation.${componentSlug}.${id}`, role, objectKey, mime, bytes.length, checksum, width, height, id, metadata])).rows[0];
      media.set(objectKey, bytes);
      return { row, reference: { assetId: id, checksumSha256: checksum, role, slot: role === "activity_font" ? `font-${id.replaceAll("-", "")}` : slot } };
    }
    async function save(type, key, payload, revisions = 2) {
      for (let revision = 0; revision < revisions; revision++) {
        const result = (await pool.query("select * from save_builder_component_document($1,$2,$3,$4,'1.0',$5,$6,$7,$8,$9)", [bookSlug, componentSlug, type, key, revision, payload, builderDocumentSha256(payload), actor, randomUUID()])).rows[0];
        assert.equal(result.outcome, "saved");
      }
    }
    const template = createPublicationV2FixtureSources();
    const templates = [...Object.values(template.native.activities).map((entry) => [entry.public.payload, entry.teacher.payload]), [multiPublic, multiTeacher]];
    const activities = {}; const assetRows = [];
    const index = templates.map(([document], number) => ({ activityId: `${bookSlug}-${prefix}-preserved-o${number + 1}`, kind: document.kind, placement: { pageId }, sortOrder: 90 - number * 7 }));
    await save("native_activity_index", "default", { schemaVersion: "1.0", activities: index });
    const font = await asset({ bytes: fontBytes, role: "activity_font", slot: "component-font", mime: "font/ttf", extension: "ttf", width: null, height: null });
    assetRows.push(font.row);
    for (const [number, [publicTemplate, teacherTemplate]] of templates.entries()) {
      const activityId = `${bookSlug}-${prefix}-preserved-o${number + 1}`;
      const publicDocument = structuredClone(publicTemplate); const teacherDocument = structuredClone(teacherTemplate);
      publicDocument.activityId = teacherDocument.activityId = activityId;
      publicDocument.metadata.title = `Preserved test activity ${number}`;
      publicDocument.placement.pageId = pageId;
      for (const [referenceIndex, oldReference] of publicDocument.assets.entries()) {
        const bytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: { r: 60 + number * 20, g: 40 + referenceIndex * 40, b: 120 + componentIndex } } }).png().toBuffer();
        const created = await asset({ bytes, role: oldReference.role, slot: oldReference.slot, activityId });
        publicDocument.assets[referenceIndex] = created.reference; assetRows.push(created.row);
      }
      if (publicDocument.kind === "image") {
        const bytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: "#701020" } }).png().toBuffer();
        const answer = await asset({ bytes, role: "native_teacher_answer", slot: "sample-answer", activityId });
        teacherDocument.parts[0].solution = structuredClone(imageTeacher.parts[0].solution);
        Object.assign(teacherDocument.parts[0].solution.sampleAnswer.image, { reference: answer.reference, sourceWidth: 48, sourceHeight: 64 });
        assetRows.push(answer.row);
        for (const [slot, bytes, mime, extension] of [["preserved-audio", tone, "audio/mpeg", "mp3"], ["preserved-video", video, "video/mp4", "mp4"]]) {
          const created = await asset({ bytes, role: "activity_artwork", slot, activityId, mime, extension, width: null, height: null });
          publicDocument.assets.push(created.reference); assetRows.push(created.row);
          if (extension === "mp4") publicDocument.video = { kind: "managed-mp4", assetSlot: slot, fileName: "synthetic.mp4", byteSize: bytes.length, durationMs: 400, cues: [{ id: "cue-00000000000000000000000000000001", startMs: 0, endMs: 400, text: "Synthetic blue frame" }] };
          else publicDocument.supplementalAudio = { assetSlot: slot, durationMs: 250 };
        }
      }
      if (publicDocument.kind === "open-response") {
        publicDocument.assets.push(font.reference);
        publicDocument.parts[0].interaction.questions[0].responseRegion.presentation.answerFontAssetSlot = font.reference.slot;
      }
      const kind = resolveNativeActivityKind(publicDocument.kind);
      assert.equal(kind.validatePair(publicDocument, teacherDocument), true);
      const entry = index[number];
      activities[activityId] = { index: entry, public: source(publicDocument, 3), teacher: source(teacherDocument, 4) };
    }
    for (const entry of Object.values(activities)) {
      await save("native_activity_public", entry.index.activityId, entry.public.payload, 3);
      await save("native_activity_teacher", entry.index.activityId, entry.teacher.payload, 4);
    }
    const hotspots = { schemaVersion: "1.0", packageSlug: bookSlug, componentSlug, pages: { [pageId]: index.slice(0, 4).map((entry, i) => ({ id: `preserved-hotspot-${i}`, pageId, unitNumber: 1, left: 5 + i * 20, top: 20, width: 15, height: 17, label: `Authored ${i}`, actionType: "normalized_activity", activityKey: entry.activityId })) } };
    // Multi-part remains active but unlinked: absence from hotspots is not deletion.
    await save("hotspots", "default", hotspots);
    await save("activity_lifecycle", "default", { schemaVersion: "1.0", activities: { [`${bookSlug}-${prefix}-retained-o700`]: { status: "retired", pageId: deletedId, sortOrder: 600 } } });
    const control = { ...scope, componentSlug, pageId, deletedId, index, assetRows, releaseId: null };
    if (bookSlug === "ultimate-b2") {
      // Exercise the existing frozen managed compiler, not the unfinished new SB contract.
      const compiled = compileUltimateB2ManagedComponentRelease({ pages: await loadBuilderPages(sql, { bookSlug, componentSlug }), documents: { hotspots: source(hotspots), activityLifecycle: null }, native: { index: source({ schemaVersion: "1.0", activities: index }), activities, assetRows } }, componentSlug);
      const releaseId = randomUUID(); control.releaseId = releaseId;
      await pool.query("insert into book_component_releases(id,book_package_id,book_component_id,release_number,release_schema_version,compiler_id,runtime_compatibility_sha256,source_snapshot,source_snapshot_sha256,public_projection,public_projection_sha256,teacher_projection,teacher_projection_sha256,asset_manifest,release_sha256,request_sha256,client_mutation_id,created_by_builder_user_id,asset_storage_mode) values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,'pinned-source-v1')", [releaseId, scope.package_id, scope.component_id, compiled.releaseSchemaVersion, compiled.compilerId, compiled.compatibility, compiled.sourceSnapshot, compiled.sourceSnapshotSha256, compiled.publicProjection, compiled.publicProjectionSha256, compiled.teacherProjection, compiled.teacherProjectionSha256, JSON.stringify(compiled.assetManifest), compiled.releaseSha256, randomUUID(), actor]);
      await pool.query("insert into book_component_publication_events(book_package_id,book_component_id,release_id,expected_head_revision,resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id) values($1,$2,$3,0,1,$4,$5,$6)", [scope.package_id, scope.component_id, releaseId, compiled.releaseSha256, randomUUID(), actor]);
      await pool.query("insert into book_component_publication_heads(book_package_id,book_component_id,release_id,head_revision,published_by_builder_user_id) values($1,$2,$3,1,$4)", [scope.package_id, scope.component_id, releaseId, actor]);
      for (const item of compiled.nativeAssetSources) {
        const row = item.row; const descriptor = item.descriptor;
        const owner = descriptor.role === "managed_page_image" ? row.source_metadata.publication_page_id : descriptor.role === "activity_font" ? "component" : row.source_metadata.native_activity_id;
        const slot = ["managed_page_image", "activity_font"].includes(descriptor.role) ? "" : row.source_metadata.asset_slot;
        await pool.query("insert into book_component_release_asset_pins(component_release_id,book_package_id,book_component_id,book_asset_id,asset_role,source_asset_role,checksum_sha256,byte_size,media_type,extension,storage_profile,storage_bucket,object_key,source_owner_key,source_asset_slot,pin_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'private',$11,$12,$13,$14,builder_release_asset_pin_sha256($4,$5,$6,$7,$8,$9,$10,'private',$11,$12,$13,$14))", [releaseId, scope.package_id, scope.component_id, row.id, descriptor.role, row.asset_role, row.checksum_sha256, row.byte_size, row.mime_type, descriptor.extension, row.storage_bucket, row.object_key, owner, slot]);
      }
    }
    controls.push(control);
  }
  return controls;
}

export async function assertPreservedSyntheticMediaReadable(pool, media, controls) {
  const rows = (await pool.query("select * from book_assets where storage_bucket='synthetic-private'")).rows;
  assert.ok(rows.length >= 70);
  for (const row of rows) {
    const bytes = media.get(row.object_key);
    assert.ok(bytes, `Missing synthetic bytes ${row.id}`);
    assert.equal(bytes.length, Number(row.byte_size)); assert.equal(digest(bytes), row.checksum_sha256);
    if (row.mime_type === "image/png") { const image = await sharp(bytes).metadata(); assert.equal(image.width, row.width); assert.equal(image.height, row.height); }
    if (row.mime_type === "font/ttf") assert.equal(bytes.readUInt32BE(0), 0x00010000);
    if (row.mime_type === "audio/mpeg") assert.equal(bytes.toString("ascii", 0, 3), "ID3");
    if (row.mime_type === "video/mp4") assert.equal(bytes.toString("ascii", 4, 8), "ftyp");
  }
  for (const control of controls.filter((entry) => entry.releaseId)) {
    const release = (await pool.query("select * from book_component_releases where id=$1", [control.releaseId])).rows[0];
    verifyImmutableComponentRelease(release);
    const pins = (await pool.query("select * from book_component_release_asset_pins where component_release_id=$1", [control.releaseId])).rows;
    assert.equal(pins.filter((pin) => pin.asset_role === "managed_page_image").length, 1);
    const sql = async (strings, ...values) => (await pool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
    for (const pin of pins) {
      assert.equal(digest(media.get(pin.object_key)), pin.checksum_sha256);
      let storageReads = 0;
      const storage = {
        bucket: () => "synthetic-private",
        async openReadStream({ objectKey, range }) {
          storageReads++;
          const bytes = media.get(objectKey); assert.ok(bytes);
          const body = range ? bytes.subarray(range.offset, range.offset + range.length) : bytes;
          return { body: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close(); } }), byteSize: body.length, checksumSha256: digest(bytes), contentType: pin.media_type, contentRange: range ? `bytes ${range.offset}-${range.offset + range.length - 1}/${bytes.length}` : null };
        },
      };
      const asset = release.asset_manifest.find((entry) => entry.sha256 === pin.checksum_sha256 && entry.role === pin.asset_role);
      const query = { bookSlug: "ultimate-b2", componentSlug: control.componentSlug, releaseId: release.id, sha256: asset.sha256, extension: asset.extension };
      const response = await deliverPublishedPinnedAsset(sql, query, { row: release, projection: release.public_projection, asset, storage, method: "GET", rangeHeader: null });
      if (pin.asset_role === "native_teacher_answer") {
        assert.equal(response.statusCode, 409); assert.equal(storageReads, 0);
      } else {
        assert.equal(response.status, 200, `${asset.role}: ${response.body}`);
        assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), media.get(pin.object_key));
        const corrupt = await deliverPublishedPinnedAsset(sql, query, { row: release, projection: release.public_projection, asset, storage: { ...storage, async openReadStream(input) { return { ...await storage.openReadStream(input), checksumSha256: "0".repeat(64) }; } }, method: "GET", rangeHeader: null });
        assert.equal(corrupt.statusCode, 409);
      }
    }
  }
}

export async function seedPreservationLearningHistory(pool, fixture, controls) {
  const teacher = (await pool.query("select * from app_users where role='teacher' and school_id is not null limit 1")).rows[0];
  const student = (await pool.query("select * from app_users where role='student' and school_id=$1 limit 1", [teacher.school_id])).rows[0];
  await pool.query("update app_users set status='active' where id=$1", [student.id]); student.status = "active";
  const sql = async (strings, ...values) => (await pool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
  sql.assignmentLifecycleTransaction = async (assignmentId, callback) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`activity-assignment:${assignmentId}`]);
      const transaction = async (strings, ...values) => (await client.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values)).rows;
      const result = await callback(transaction); await client.query("commit"); return result;
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  };
  const releases = (await pool.query("select release.*,component.slug component_slug from book_component_releases release join book_components component on component.id=release.book_component_id where release.id=any($1::uuid[])", [[fixture.releaseId, ...controls.filter((entry) => entry.releaseId).map((entry) => entry.releaseId)]])).rows;
  const studentsRelease = releases.find((release) => release.id === fixture.releaseId);
  await pool.query("insert into book_component_publication_events(book_package_id,book_component_id,release_id,expected_head_revision,resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id) values($1,$2,$3,0,1,$4,$5,$6)", [fixture.scope.package_id, fixture.scope.component_id, fixture.releaseId, studentsRelease.release_sha256, randomUUID(), fixture.actor]);
  await pool.query("insert into book_component_publication_heads(book_package_id,book_component_id,release_id,head_revision,published_by_builder_user_id) values($1,$2,$3,1,$4)", [fixture.scope.package_id, fixture.scope.component_id, fixture.releaseId, fixture.actor]);
  const componentOrder = ["ultimate-b2-students-book", "ultimate-b2-workbook", "ultimate-b2-grammar-book"];
  const members = componentOrder.map((slug, index) => {
    const release = releases.find((row) => row.component_slug === slug);
    const member = { order: index + 1, componentSlug: slug, status: "included", componentReleaseId: release.id, compilerId: release.compiler_id, releaseSchemaVersion: release.release_schema_version, releaseSha256: release.release_sha256, compatibility: release.runtime_compatibility_sha256, unavailableReason: null };
    return { ...member, memberSha256: productReleaseMemberSha256(member) };
  });
  const productId = randomUUID();
  const identity = { bookSlug: "ultimate-b2", releaseNumber: 1, compilerId: "ultimate-b2-product-v1", releaseSchemaVersion: "1.0", releaseNote: "Synthetic preserved family", members };
  const sourceHash = productReleaseSourceSha256(identity);
  const releaseHash = productReleaseSha256({ ...identity, sourceSnapshotSha256: sourceHash });
  await pool.query("insert into book_product_releases(id,book_package_id,release_number,release_schema_version,compiler_id,source_snapshot_sha256,release_sha256,request_sha256,client_mutation_id,release_note,created_by_builder_user_id) values($1,$2,1,'1.0','ultimate-b2-product-v1',$3,$4,$4,$5,$6,$7)", [productId, fixture.scope.package_id, sourceHash, releaseHash, randomUUID(), identity.releaseNote, fixture.actor]);
  for (const member of members) {
    const release = releases.find((row) => row.id === member.componentReleaseId);
    await pool.query("insert into book_product_release_members(product_release_id,book_package_id,book_component_id,member_order,member_status,component_release_id,component_compiler_id,component_release_schema_version,component_release_sha256,runtime_compatibility_sha256,member_sha256) values($1,$2,$3,$4,'included',$5,$6,$7,$8,$9,$10)", [productId, fixture.scope.package_id, release.book_component_id, member.order, release.id, member.compilerId, member.releaseSchemaVersion, member.releaseSha256, member.compatibility, member.memberSha256]);
  }
  await pool.query("insert into book_product_publication_heads(book_package_id,product_release_id,head_revision,published_by_builder_user_id) values($1,$2,1,$3)", [fixture.scope.package_id, productId, fixture.actor]);
  await pool.query("insert into book_product_publication_events(book_package_id,product_release_id,expected_head_revision,resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id) values($1,$2,0,1,$3,$4,$5)", [fixture.scope.package_id, productId, releaseHash, randomUUID(), fixture.actor]);
  const classId = randomUUID();
  await pool.query("insert into classes(id,school_id,name,slug,teacher_id,book_package_id,status,invite_code) values($1,$2,'Synthetic preserved class',$3,$4,$5,'active',$6)", [classId, teacher.school_id, `preserved-${classId}`, teacher.id, fixture.scope.package_id, randomUUID().slice(0, 8)]);
  await pool.query("insert into class_students(class_id,student_id,status) values($1,$2,'active')", [classId, student.id]);
  await pool.query("insert into book_access(user_id,book_package_id,role_scope) values($1,$2,'teacher'),($3,$2,'student') on conflict do nothing", [teacher.id, fixture.scope.package_id, student.id]);
  const history = [];
  for (const release of releases.filter((row) => row.component_slug !== "ultimate-b2-grammar-book")) {
    const native = Object.values(release.public_projection.nativeActivities).find((entry) => entry.kind === "open-response").document;
    const hotspot = Object.values(release.public_projection.hotspots.pages).flat().find((entry) => entry.activityKey === native.activityId);
    assert.ok(hotspot);
    const locator = { pageId: hotspot.pageId, hotspotId: hotspot.id, productReleaseId: productId };
    const homework = (await pool.query("insert into homeworks(school_id,teacher_id,title,teacher_notes,idempotency_key,request_sha256) values($1,$2,'Synthetic preserved Homework','Preserve these notes',$3,$4) returning id", [teacher.school_id, teacher.id, randomUUID(), releaseHash])).rows[0];
    const item = (await pool.query("insert into homework_items(homework_id,position,target_kind,native_release_id,native_activity_id,native_book_locator) values($1,1,'published_native',$2,$3,$4) returning id", [homework.id, release.id, native.activityId, locator])).rows[0];
    const legacy = (await pool.query("select activity.id from activities activity join lessons lesson on lesson.id=activity.lesson_id join units unit on unit.id=lesson.unit_id where unit.book_component_id=$1 limit 1", [fixture.scope.component_id])).rows[0];
    assert.ok(legacy);
    await pool.query("insert into homework_items(homework_id,position,target_kind,activity_id) values($1,2,'legacy_activity',$2)", [homework.id, legacy.id]);
    const assignment = (await pool.query("insert into activity_assignments(school_id,teacher_id,student_id,class_id,title,target_kind,native_release_id,native_activity_id,native_book_locator,homework_id,homework_item_id) values($1,$2,$3,$4,'Synthetic preserved native work','published_native',$5,$6,$7,$8,$9) returning id", [teacher.school_id, teacher.id, student.id, classId, release.id, native.activityId, locator, homework.id, item.id])).rows[0];
    const response = await submitActivity(sql, { assignmentId: assignment.id, response: { schemaVersion: "native-response.v1", items: native.parts[0].interaction.questions.map((question) => ({ id: question.id, value: "Preserve this authored Student response" })) } }, student);
    assert.equal(response.statusCode, 200, response.body);
    const results = await getAssignmentResults(sql, assignment.id); assert.equal(results.statusCode, 200, results.body);
    const submissionId = JSON.parse(results.body).rows[0].submissionId;
    const reviewed = await reviewSubmission(sql, { submissionId, scorePercent: 87, teacherFeedback: "Preserve this Teacher review" }, teacher);
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    history.push({ assignmentId: assignment.id, locator, releaseId: release.id });
  }
  return { student, teacher, history, sql };
}

export async function assertPreservedLearningReadable(learning) {
  for (const entry of learning.history) {
    const response = await getStudentAssignmentDetail(learning.sql, learning.student, { assignmentId: entry.assignmentId });
    assert.equal(response.statusCode, 200, response.body);
    const assignment = JSON.parse(response.body).assignment;
    assert.equal(assignment.book.releaseId, entry.releaseId); assert.deepEqual(assignment.bookLocator, entry.locator);
    assert.doesNotMatch(response.body, /SYNTHETIC_COMBINED_PRIVATE_ANSWER|PHASE_5_PRIVATE_TEACHER_SENTINEL/);
    const results = JSON.parse((await getAssignmentResults(learning.sql, entry.assignmentId)).body);
    assert.equal(results.rows[0].teacherFeedback, "Preserve this Teacher review");
    assert.ok(results.rows[0].answerDetails.some((answer) => answer.answer === "Preserve this authored Student response"));
  }
}

export async function seedPreservationExtrasAndUi(pool, fixture) {
  const unit = (await pool.query("select id from units where book_component_id=$1 and unit_number=1", [fixture.scope.component_id])).rows[0];
  const edition = (await pool.query("select id from book_editions where book_package_id=$1 and edition_identifier='builder-pages'", [fixture.scope.package_id])).rows[0];
  const categories = { videos: [], audios: [] };
  for (const [category, name, role, mime, extension, prefix] of [["videos", "color.mp4", "unit_extra_video", "video/mp4", "mp4", "video"], ["audios", "tone.mp3", "unit_extra_audio", "audio/mpeg", "mp3", "audio"]]) {
    const bytes = Buffer.from(syntheticMedia.files[name].base64, "base64"); const checksum = digest(bytes);
    const id = `${prefix}-${randomUUID().replaceAll("-", "")}`; const assetId = randomUUID();
    const objectKey = `builder-unit-extra-assets/ultimate-b2/ultimate-b2-students-book/unit-1/${id}/assets/${checksum}.${extension}`;
    await pool.query("insert into book_assets(id,book_package_id,book_component_id,unit_id,edition_id,stable_logical_key,asset_role,object_key,storage_profile,storage_bucket,mime_type,byte_size,checksum_sha256,duration_seconds,edition_identifier,version,publication_status,access_level,source_metadata) values($1,$2,$3,$4,$5,$6,$7,$8,'private','synthetic-private',$9,$10,$11,$12,'builder-pages','preserved-extra','draft','internal',$13)", [assetId, fixture.scope.package_id, fixture.scope.component_id, unit.id, edition.id, `ultimate-b2.preservation.extra.${id}`, role, objectKey, mime, bytes.length, checksum, extension === "mp4" ? 0.4 : null, { unit_slug: "unit-1", unit_extra_item_id: id, asset_slot: id }]);
    fixture.media.set(objectKey, bytes);
    categories[category].push({ id, title: `Preserved ${prefix}`, assetSlot: id, asset: { assetId, checksumSha256: checksum, role, slot: id }, fileName: name, byteSize: bytes.length, ...(extension === "mp4" ? { durationMs: 400, cues: [] } : {}) });
  }
  const extras = normalizeUltimateB2UnitExtrasDocument({ schemaVersion: "1.0", units: [{ unitId: "unit-1", unitNumber: 1, categories }], pages: [{ pageId: "ub2-sb-unit-1-part-1", unitId: "unit-1", extrasVisibility: { videos: true, audios: true } }] });
  const uiBytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: "#345678" } }).png().toBuffer();
  const binding = HOSTED_EDITABLE_UI_BINDINGS.find((entry) => entry.mediaFamily === "raster" && !entry.atomicGroup);
  assert.ok(binding);
  const ui = normalizeHostedTeacherUiDocument({ schemaVersion: "1.0", packageId: "ultimate-b2-students-book", assets: { [binding.id]: { sha256: digest(uiBytes), extension: "png", mediaType: "image/png", sizeBytes: uiBytes.length, width: 12, height: 12, originalFilename: "synthetic-ui.png" } } });
  const uiKey = `synthetic-teacher-ui/${digest(uiBytes)}.png`; fixture.media.set(uiKey, uiBytes);
  for (const [type, payload] of [["unit_extras", extras], ["teacher_ui", ui]]) for (let revision = 0; revision < 2; revision++) {
    const result = (await pool.query("select * from save_builder_component_document('ultimate-b2','ultimate-b2-students-book',$1,'default','1.0',$2,$3,$4,$5,$6)", [type, revision, payload, builderDocumentSha256(payload), fixture.actor, randomUUID()])).rows[0];
    assert.equal(result.outcome, "saved");
  }
  return { uiKey, uiSha256: digest(uiBytes), uiSize: uiBytes.length };
}
