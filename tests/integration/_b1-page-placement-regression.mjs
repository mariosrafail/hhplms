import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createBuilderPagesHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js';
import { createBuilderProductPublicationHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js';
import { verifyImmutableComponentRelease } from '../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js';
import { listPublishedBooks } from '../../netlify/functions/_book-content/published-book-actions.js';
import { createAssignment, listAssignmentsForStudent } from '../../netlify/functions/_book-content/assignment-actions.js';
import { getPublishedReleaseAsset } from '../../netlify/functions/_book-content/publication-actions.js';

const event = (path, body) => ({ path, httpMethod: body ? 'POST' : 'GET', headers: { host: 'builder.example', origin: 'https://builder.example', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const read = (value, status = 200) => { assert.equal(value.statusCode, status, value.body); return JSON.parse(value.body); };
export const clientSql = (client) => async (strings, ...values) => (await client.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;

// Every call uses the real handler and SQL. One enclosing disposable transaction
// keeps this independent regression from changing the older browser expectations.
export async function verifyB1PagePlacement({ t, pool, actor, teacher, student, storage, media, pageBytes, drafts }) {
  for (const book of ['ultimate-b1', 'ultimate-b1-plus']) await t.test(`${book}: real page Unit moves before/after PREPARE and PUBLISH preserve pins and assignments`, async () => {
    const client = await pool.connect();
    await client.query('begin');
    try {
      const sql = clientSql(client), authorize = async () => ({ builderUser: { id: actor } });
      const pages = createBuilderPagesHandler({ getDatabase: () => sql, authorize, storage: () => storage });
      const publication = createBuilderProductPublicationHandler({ getDatabase: () => sql, authorize, storage: () => storage });
      const prepare = async () => read(await publication(event(`/builder/api/publication/books/${book}/prepare`, { clientMutationId: randomUUID(), releaseNote: 'Placement regression' })));
      const publish = async (candidate, revision, status = 200) => read(await publication(event(`/builder/api/publication/books/${book}/publish`, { productReleaseId: candidate.productReleaseId, expectedHeadRevision: revision, clientMutationId: randomUUID() })), status);
      const current = async () => read(await listPublishedBooks(sql, student)).books.filter((entry) => entry.bookSlug === book);
      const members = [book + '-students-book', book + '-workbook'];
      const revisions = async (component) => Number((await client.query('select revision from builder_component_page_revisions where book_component_id=(select id from book_components where slug=$1)', [component])).rows[0].revision);
      const page = async (component) => (await client.query('select * from book_pages where stable_key=$1', [`${component}/pages/${drafts.get(component).pageIds[0]}`])).rows[0];
      const units = async (component) => (await client.query('select * from units where book_component_id=(select id from book_components where slug=$1) order by unit_number', [component])).rows;
      const move = async (component, unitId, expectedStatus = 200) => {
        const row = await page(component), revision = await revisions(component);
        const path = `/builder/api/pages/books/${book}/components/${component}/pages/${drafts.get(component).pageIds[0]}/metadata`;
        const body = { expectedRevision: revision, clientMutationId: randomUUID(), metadata: { label: row.label, printedLabel: row.source_metadata.printed_label || '', sortOrder: row.sort_order, unitId } };
        const result = read(await pages(event(path, body)), expectedStatus);
        if (expectedStatus !== 200) { assert.equal(await revisions(component), revision); return; }
        assert.equal(result.revision, revision + 1);
        assert.equal((await page(component)).unit_id, unitId);
        const audit = (await client.query("select count(*)::int count from builder_audit_log where target_id=$1 and action='component_page_metadata'", [row.id])).rows[0].count;
        assert.ok(audit > 0);
        assert.equal(read(await pages(event(path, body))).idempotent, true);
        assert.equal(await revisions(component), revision + 1);
        assert.equal((await client.query("select count(*)::int count from builder_audit_log where target_id=$1 and action='component_page_metadata'", [row.id])).rows[0].count, audit);
        read(await pages(event(path, { ...body, clientMutationId: randomUUID() })), 409);
        read(await pages(event(path, { ...body, metadata: { ...body.metadata, label: 'Different replay' } })), 409);
      };
      const immutable = async () => ({ releases: (await client.query('select * from book_component_releases order by id')).rows, pins: (await client.query('select * from book_component_release_asset_pins order by component_release_id,pin_sha256')).rows });
      const originalAssets = (await client.query("select id,unit_id,page_id,object_key,checksum_sha256,source_metadata from book_assets where asset_role='page_image' order by id")).rows;
      for (const component of members) { const list = await units(component); await move(component, list[1].id); await move(component, list[0].id); }
      const first = await prepare(), frozen = await immutable();
      assert.deepEqual(await current(), []);
      for (const component of members) await move(component, (await units(component))[1].id);
      assert.deepEqual(await immutable(), frozen);
      await publish(first, 0, 409);
      assert.equal((await client.query('select builder_product_release_sources_are_current($1) current', [first.productReleaseId])).rows[0].current, false);
      const second = await prepare();
      for (const release of (await immutable()).releases) verifyImmutableComponentRelease(release);
      await publish(second, 0);
      const published = await current();
      assert.equal(published.length, 2);
      const assignments = [], replacementBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#bf7234' } }).png().toBuffer();
      const classId = randomUUID();
      await client.query("insert into classes(id,school_id,teacher_id,name,slug,book_package_id,status,invite_code) select $1::uuid,$2,$3,'Placement fixture',$1::text,id,'active',$1::text from book_packages where slug=$4", [classId, teacher.school_id, teacher.id, book]);
      await client.query("insert into class_students(class_id,student_id,status) values($1,$2,'active')", [classId, student.id]);
      for (const component of members) {
        const entry = published.find((item) => item.componentSlug === component), id = drafts.get(component).pageIds[0];
        const publishedPage = entry.pages.find((item) => item.id === id);
        assert.equal(publishedPage.unitNumber, 2);
        const assignment = read(await createAssignment(sql, { target: publishedPage.hotspots[0].target, classIds: [classId], idempotencyKey: randomUUID() }, teacher)).assignment;
        assignments.push({ id: assignment.id, row: (await client.query('select * from activity_assignments where id=$1', [assignment.id])).rows[0], component, pageId: id, releaseId: entry.releaseId });
        await move(component, (await units(component))[2].id);
        const foreign = (await units(members.find((name) => name !== component)))[0].id;
        await move(component, foreign, 400);
      }
      assert.deepEqual(await current(), published);
      const third = await prepare();
      assert.deepEqual(await current(), published);
      await publish(third, 1);
      for (const assignment of assignments) {
        const entry = (await current()).find((item) => item.componentSlug === assignment.component);
        assert.equal(entry.pages.find((item) => item.id === assignment.pageId).unitNumber, 3);
        assert.deepEqual((await client.query('select * from activity_assignments where id=$1', [assignment.id])).rows[0], assignment.row);
        const resolved = await listAssignmentsForStudent(sql, student.id, student, { assignmentId: assignment.id, includeBook: true });
        assert.equal(resolved[0].book.releaseId, assignment.releaseId);
        assert.equal(resolved[0].book.pages.find((item) => item.id === assignment.pageId).unitNumber, 2);
        for (const releaseId of [assignment.releaseId, entry.releaseId]) {
          const image = entry.pages.find((item) => item.id === assignment.pageId).image;
          const delivered = await getPublishedReleaseAsset(sql, { bookSlug: book, componentSlug: assignment.component, releaseId, sha256: image.sha256, extension: 'png' }, { storage: { ...storage, openReadStream: async ({ objectKey }) => ({ body: new Response(media.get(objectKey)).body, byteSize: pageBytes.length, contentType: 'image/png', checksumSha256: image.sha256, contentRange: null }) } });
          assert.equal(delivered.status, 200);
          assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), pageBytes);
        }
        // Same-image replacement must reuse the exact physical row after a move.
        const root = `/builder/api/pages/books/${book}/components/${assignment.component}`;
        const revision = await revisions(assignment.component), mutation = randomUUID();
        const row = await page(assignment.component);
        const upload = read(await pages(event(`${root}/assets/prepare`, { mode: 'replace', pageId: assignment.pageId, expectedRevision: revision, clientMutationId: mutation,
          metadata: { label: row.label, printedLabel: row.source_metadata.printed_label || '', sortOrder: row.sort_order, unitId: row.unit_id }, file: { name: 'fixture.png', type: 'image/png', size: pageBytes.length } })));
        const staged = (await client.query('select staging_object_key from builder_component_page_upload_sessions where id=$1', [upload.uploadId])).rows[0];
        media.set(staged.staging_object_key, pageBytes);
        read(await pages(event(`${root}/assets/finalize`, { uploadId: upload.uploadId, expectedRevision: revision, clientMutationId: mutation })));
        await move(assignment.component, (await units(assignment.component))[0].id);
        const listed = read(await pages({ ...event(root, {}), httpMethod: 'GET', body: undefined }));
        read(await pages(event(`${root}/pages/${assignment.pageId}/delete`, { expectedRevision: listed.revision, expectedHotspotRevision: listed.hotspotRevision, clientMutationId: randomUUID(), metadata: {} })));
        read(await pages(event(`${root}/pages/${assignment.pageId}/restore`, { expectedRevision: await revisions(assignment.component), clientMutationId: randomUUID(), metadata: {} })));
        const replacementRevision = await revisions(assignment.component), replacementMutation = randomUUID(), restored = await page(assignment.component);
        const replacement = read(await pages(event(`${root}/assets/prepare`, { mode: 'replace', pageId: assignment.pageId, expectedRevision: replacementRevision, clientMutationId: replacementMutation,
          metadata: { label: restored.label, printedLabel: restored.source_metadata.printed_label || '', sortOrder: restored.sort_order, unitId: restored.unit_id }, file: { name: 'new-image.png', type: 'image/png', size: replacementBytes.length } })));
        const replacementStaging = (await client.query('select staging_object_key from builder_component_page_upload_sessions where id=$1', [replacement.uploadId])).rows[0];
        media.set(replacementStaging.staging_object_key, replacementBytes);
        read(await pages(event(`${root}/assets/finalize`, { uploadId: replacement.uploadId, expectedRevision: replacementRevision, clientMutationId: replacementMutation })));
      }
      const fourth = await prepare(); await publish(fourth, 2);
      for (const assignment of assignments) {
        const entry = (await current()).find((item) => item.componentSlug === assignment.component);
        const image = entry.pages.find((item) => item.id === assignment.pageId).image;
        const delivered = await getPublishedReleaseAsset(sql, { bookSlug: book, componentSlug: assignment.component, releaseId: entry.releaseId, sha256: image.sha256, extension: 'png' }, { storage: { ...storage, openReadStream: async ({ objectKey }) => ({ body: new Response(media.get(objectKey)).body, byteSize: replacementBytes.length, contentType: 'image/png', checksumSha256: image.sha256, contentRange: null }) } });
        assert.equal(delivered.status, 200); assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), replacementBytes);
        const resolved = await listAssignmentsForStudent(sql, student.id, student, { assignmentId: assignment.id, includeBook: true });
        assert.equal(resolved[0].book.releaseId, assignment.releaseId);
        assert.equal(resolved[0].book.pages.find((item) => item.id === assignment.pageId).unitNumber, 2);
        const historicalImage = resolved[0].book.pages.find((item) => item.id === assignment.pageId).image;
        assert.notEqual(historicalImage.sha256, image.sha256);
        const historicalDelivery = await getPublishedReleaseAsset(sql, { bookSlug: book, componentSlug: assignment.component, releaseId: assignment.releaseId, sha256: historicalImage.sha256, extension: 'png' }, { storage: { ...storage, openReadStream: async ({ objectKey }) => ({ body: new Response(media.get(objectKey)).body, byteSize: pageBytes.length, contentType: 'image/png', checksumSha256: historicalImage.sha256, contentRange: null }) } });
        assert.equal(historicalDelivery.status, 200); assert.deepEqual(Buffer.from(await historicalDelivery.arrayBuffer()), pageBytes);
      }
      assert.deepEqual((await client.query("select id,unit_id,page_id,object_key,checksum_sha256,source_metadata from book_assets where asset_role='page_image' order by id")).rows.filter((row) => originalAssets.some((old) => old.id === row.id)), originalAssets);
      assert.deepEqual((await immutable()).releases.filter((row) => frozen.releases.some((old) => old.id === row.id)), frozen.releases);
      assert.deepEqual((await immutable()).pins.filter((row) => frozen.pins.some((old) => old.component_release_id === row.component_release_id && old.pin_sha256 === row.pin_sha256)), frozen.pins);
    } finally { await client.query('rollback'); client.release(); }
  });
}
