import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import { applyCanonicalProductionMigrations } from './_migration-test-helpers.mjs';
import { createBuilderPagesHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js';
import { createBuilderProductPublicationHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js';
import { resolveBuilderContentResource } from '../../netlify-sites/ultimate-b2-builder/server/_builder-content-registry.js';
import { saveBuilderComponentDocument } from '../../netlify-sites/ultimate-b2-builder/server/_builder-content-store.js';
import { resolvePublicationCompiler, verifyImmutableComponentRelease } from '../../netlify-sites/ultimate-b2-builder/server/_builder-publication-compilers.js';
import { productPublicationDatabaseReady, createProductRelease } from '../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication-store.js';
import { createComponentRelease } from '../../netlify-sites/ultimate-b2-builder/server/_builder-publication-store.js';
import { routePublishedBookRead } from '../../netlify/functions/_book-content/publication-read-routes.js';
import { builderDocumentSha256, stableBuilderJson } from '../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js';
import { newManagedPublicationComponents } from '../../src/data/publicationRegistry.js';
import { publishedManagedBookFixture, publishedManagedPageBytes } from '../fixtures/published-managed-book.js';
import { listPublishedBooks, getPublishedBookActivity } from '../../netlify/functions/_book-content/published-book-actions.js';
import { createAssignment, listAssignmentsForStudent } from '../../netlify/functions/_book-content/assignment-actions.js';
import { captureStudentsBookPreservation, assertStudentsBookDatabasePreserved, seedStudentsBookPreservation } from './_students-book-preservation.mjs';
import { addManagedImageFixture } from './_b1-publication-assets.mjs';
import { getPublishedNativeTeacherAnswer, getPublishedReleaseAsset } from '../../netlify/functions/_book-content/publication-actions.js';
import { publicationAssetPinFingerprint } from '../../netlify-sites/ultimate-b2-builder/server/_builder-publication-pins.js';
import { verifyB1PagePlacement } from './_b1-page-placement-regression.mjs';
import { verifyB1LockOrder } from './_b1-lock-regression.mjs';
import { verifyB1PublicationConcurrency } from './_b1-publication-concurrency.mjs';
import { verifyB1ImmutableUi } from './_b1-immutable-ui-regression.mjs';

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_DATABASE_CONFIRMATION === 'isolated-test-database';
const event = (path, body) => ({ path, httpMethod: body ? 'POST' : 'GET', headers: { host: 'builder.example', origin: 'https://builder.example', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
function response(value, status = 200) { assert.equal(value.statusCode, status, value.body); return JSON.parse(value.body); }

test('062 upgrades an existing B2 historical release, head, assignment and submission without changing any bytes', { skip: !enabled }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const schema = `b1_upgrade_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url.toString(), max: 1 }); await admin.query(`create schema "${schema}"`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool, { through: '061_students_book_publication_v3.sql' });
  const seeded = await seedStudentsBookPreservation(pool);
  await pool.query('insert into book_component_publication_heads(book_component_id,book_package_id,release_id,head_revision,published_by_builder_user_id) values($1,$2,$3,1,$4)', [seeded.scope.component_id, seeded.scope.package_id, seeded.releaseId, seeded.actor]);
  await pool.query('insert into book_component_publication_events(book_component_id,book_package_id,release_id,expected_head_revision,resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id) values($1,$2,$3,0,1,$4,$5,$6)', [seeded.scope.component_id, seeded.scope.package_id, seeded.releaseId, 'a'.repeat(64), randomUUID(), seeded.actor]);
  const row = (await pool.query('select * from book_component_releases where id=$1', [seeded.releaseId])).rows[0];
  const original = verifyImmutableComponentRelease(row);
  const before = await captureStudentsBookPreservation(pool);
  const migrations = await applyCanonicalProductionMigrations(pool, { through: '062_b1_managed_publication.sql' });
  assertStudentsBookDatabasePreserved(before, await captureStudentsBookPreservation(pool), { migration: migrations.at(-1) });
  const beforeUi = await captureStudentsBookPreservation(pool);
  const uiMigrations = await applyCanonicalProductionMigrations(pool);
  assertStudentsBookDatabasePreserved(beforeUi, await captureStudentsBookPreservation(pool), { migration: uiMigrations.at(-1) });
  assert.deepEqual(verifyImmutableComponentRelease((await pool.query('select * from book_component_releases where id=$1', [seeded.releaseId])).rows[0]), original);
});

test('B1/B1 Plus real managed publication: all members, SQL parity, immutable R1/R2 and independent entitled discovery', { skip: !enabled }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const schema = `b1_publication_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await admin.query(`create schema "${schema}"`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  const sql = async (strings, ...values) => (await pool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  await applyCanonicalProductionMigrations(pool, { through: '061_students_book_publication_v3.sql' });
  assert.equal(await productPublicationDatabaseReady(sql, 'ultimate-b2'), true);
  assert.equal(await productPublicationDatabaseReady(sql, 'ultimate-b1'), false);
  const before = await captureStudentsBookPreservation(pool);
  const migrations = await applyCanonicalProductionMigrations(pool, { through: '062_b1_managed_publication.sql' });
  assertStudentsBookDatabasePreserved(before, await captureStudentsBookPreservation(pool), { migration: migrations.at(-1) });
  const beforeUi = await captureStudentsBookPreservation(pool);
  const uiMigrations = await applyCanonicalProductionMigrations(pool);
  assertStudentsBookDatabasePreserved(beforeUi, await captureStudentsBookPreservation(pool), { migration: uiMigrations.at(-1) });
  assert.equal(await productPublicationDatabaseReady(sql, 'ultimate-b1'), true);
  for (const sample of [{ a: 1, z: [0.0000001, 0.000001, 1e21, 1.23, 'Ελληνικά\n"'] }, { z: true, a: null }]) {
    const actual = (await pool.query('select builder_publication_stable_json($1::jsonb) value', [JSON.stringify(sample)])).rows[0].value;
    assert.equal(actual, stableBuilderJson(sample));
  }
  const actor = randomUUID();
  const pageBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#246789' } }).png().toBuffer();
  await pool.query("insert into builder_users(id,full_name,email,password_hash) values($1,'B1 fixture',$2,'synthetic')", [actor, `${actor}@example.test`]);
  const media = new Map();
  const storage = {
    bucket: () => 'private-assets', signedPutUrl: async ({ objectKey }) => ({ url: `https://isolated.invalid/${objectKey}`, headers: {} }),
    upload: async ({ objectKey, body }) => { media.set(objectKey, Buffer.from(body)); },
    delete: async ({ objectKey }) => { media.delete(objectKey); },
    download: async ({ objectKey }) => { assert.ok(media.has(objectKey)); return media.get(objectKey); },
    head: async ({ objectKey }) => { const bytes = media.get(objectKey); assert.ok(bytes, objectKey); return { byteSize: bytes.length, contentType: objectKey.endsWith('.wav') ? 'audio/wav' : 'image/png', checksumSha256: createHash('sha256').update(bytes).digest('hex') }; },
  };
  const authorize = async () => ({ builderUser: { id: actor } });
  const pagesHandler = createBuilderPagesHandler({ getDatabase: () => sql, authorize, storage: () => storage });
  let lastInput;
  const publication = createBuilderProductPublicationHandler({ getDatabase: () => sql, authorize, storage: () => storage,
    create: async (database, input) => { lastInput = input; return createProductRelease(database, input); } });
  const endpoint = (book, action = '') => `/builder/api/publication/books/${book}${action ? '/' + action : ''}`;
  const prepare = async (book) => response(await publication(event(endpoint(book, 'prepare'), { clientMutationId: randomUUID(), releaseNote: 'Synthetic only' })));
  const publish = async (book, candidate, revision) => response(await publication(event(endpoint(book, 'publish'), { productReleaseId: candidate.productReleaseId, expectedHeadRevision: revision, clientMutationId: randomUUID() })));
  const drafts = new Map();
  async function save(book, component, resourceName, document, activityId = null) {
    const resource = await resolveBuilderContentResource(book, component, resourceName, activityId);
    const normalized = resource.validate(document);
    const current = (await pool.query('select revision from builder_component_documents where book_component_id=(select id from book_components where slug=$1) and document_type=$2 and document_key=$3', [component, resource.documentType, resource.documentKey])).rows[0];
    const result = await saveBuilderComponentDocument(sql, { resource, expectedRevision: Number(current?.revision || 0), clientMutationId: randomUUID(), document: normalized, payloadSha256: builderDocumentSha256(normalized), builderUserId: actor });
    assert.equal(result.outcome, 'saved');
  }
  for (const registration of newManagedPublicationComponents) {
    const { bookSlug: book, componentSlug: component } = registration;
    const initial = response(await publication(event(endpoint(book))));
    assert.equal(initial.published, null);
    assert.equal(initial.components.length, 2);
    const units = (await pool.query('select * from units where book_component_id=(select id from book_components where slug=$1) order by unit_number', [component])).rows;
    const pageIds = [];
    for (let index = 0; index < 3; index++) {
      const mutation = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const prefix = `/builder/api/pages/books/${book}/components/${component}/assets`;
      const prepared = response(await pagesHandler(event(`${prefix}/prepare`, { mode: 'create', pageId: '', expectedRevision: index, clientMutationId: mutation,
        metadata: { unitId: units[index < 2 ? 0 : 1].id, label: `Fixture ${index + 1}`, printedLabel: String(index + 4), sortOrder: [20, 40, 5][index] },
        file: { name: 'fixture.png', type: 'image/png', size: pageBytes.length } })));
      assert.equal(prepared.pageId, `${registration.pagePrefix}-page-${mutation.replaceAll('-', '')}`);
      const session = (await pool.query('select staging_object_key from builder_component_page_upload_sessions where id=$1', [prepared.uploadId])).rows[0];
      media.set(session.staging_object_key, pageBytes);
      response(await pagesHandler(event(`${prefix}/finalize`, { uploadId: prepared.uploadId, expectedRevision: index, clientMutationId: mutation })));
      pageIds.push(prepared.pageId);
    }
    const fixture = publishedManagedBookFixture(component, { pageIds, pageLayout: [{ unitNumber: 1, sortOrder: 20 }, { unitNumber: 1, sortOrder: 40 }, { unitNumber: 2, sortOrder: 5 }] });
    const native = Object.entries(fixture.publicProjection.nativeActivities);
    const index = { schemaVersion: '1.0', activities: native.map(([activityId, entry], i) => ({ activityId, kind: entry.kind, placement: entry.document.placement, sortOrder: i + 1 })) };
    await save(book, component, 'native-activity-index', index);
    for (const [id, entry] of native) {
      await save(book, component, 'native-activity-public', entry.document, id);
      await save(book, component, 'native-activity-teacher', fixture.teacherProjection.nativeActivities[id].document, id);
    }
    const image = await addManagedImageFixture({ pool, sql, actor, book, component, pageId: pageIds[2], save, media, bytes: pageBytes });
    fixture.publicProjection.hotspots.pages[pageIds[2]].push({ id: 'image-hotspot', pageId: pageIds[2], unitNumber: 2, left: 55, top: 60, width: 20, height: 20, label: 'Published image', actionType: 'normalized_activity', activityKey: image.activityId });
    await save(book, component, 'hotspots', fixture.publicProjection.hotspots);
    index.activities = (await pool.query("select payload from builder_component_documents where book_component_id=(select id from book_components where slug=$1) and document_type='native_activity_index'", [component])).rows[0].payload.activities;
    const compiler = resolvePublicationCompiler(registration.compilerId);
    const compiled = compiler.compile(await compiler.collect(sql));
    const componentId = (await pool.query('select id from book_components where slug=$1', [component])).rows[0].id;
    assert.deepEqual((await pool.query('select builder_b1_managed_page_snapshot($1) value', [componentId])).rows[0].value, { units: compiled.publicProjection.units, pages: compiled.publicProjection.pages });
    drafts.set(component, { fixture, pageIds, componentId, index, image });
  }
  await verifyB1ImmutableUi({ pool, actor, save, media, publication });
  const teacher = { ...(await pool.query("select * from app_users where role='teacher' and school_id is not null limit 1")).rows[0] };
  const student = { ...(await pool.query("select * from app_users where role='student' and school_id=$1 limit 1", [teacher.school_id])).rows[0] };
  await pool.query("update app_users set status='active' where id=$1", [student.id]); student.status = 'active';
  const packages = (await pool.query("select id,slug from book_packages where slug in ('ultimate-b1','ultimate-b1-plus')")).rows;
  for (const pack of packages) await pool.query("insert into book_access(user_id,book_package_id,role_scope) values($1,$2,'teacher'),($3,$2,'student') on conflict do nothing", [teacher.id, pack.id, student.id]);
  assert.deepEqual(response(await listPublishedBooks(sql, student)).books, []);
  await verifyB1PagePlacement({ t, pool, actor, teacher, student, storage, media, pageBytes, drafts });
  const r1 = await prepare('ultimate-b1');
  const r1Input = structuredClone(lastInput);
  for (const member of r1Input.members) {
    const query = { bookSlug: 'ultimate-b1', componentSlug: member.componentSlug, releaseId: member.releaseId, activityId: drafts.get(member.componentSlug).image.activityId, sha256: drafts.get(member.componentSlug).image.sha256, extension: 'png' };
    assert.equal((await routePublishedBookRead(sql, student, { httpMethod: 'GET' }, { ...query, action: 'published-book-activity' }, {})).statusCode, 404, 'Inactive candidate cannot be read by a Student');
    assert.equal((await getPublishedReleaseAsset(sql, query, { storage })).statusCode, 404, 'Inactive candidate assets are not published');
  }
  const replay = await createProductRelease(sql, r1Input);
  assert.equal(replay.outcome, 'idempotent'); assert.equal(replay.productReleaseId, r1.productReleaseId);
  assert.equal((await createProductRelease(sql, { ...r1Input, requestSha256: '0'.repeat(64) })).outcome, 'mutation_id_conflict');
  const freshInput = () => ({ ...structuredClone(r1Input), productReleaseId: randomUUID(), clientMutationId: randomUUID(), members: r1Input.members.map((member) => ({ ...structuredClone(member), releaseId: randomUUID() })) });
  const countCandidates = async () => (await pool.query('select count(*)::int count from book_product_releases')).rows[0].count;
  const candidateCount = await countCandidates();
  for (const transform of [
    (input) => { input.members.reverse(); },
    (input) => { input.members[0].componentSlug = 'ultimate-b1-plus-students-book'; },
    (input) => { input.members[0].assetPins = structuredClone(input.members[1].assetPins); },
    (input) => { const pins = input.members[0].assetPins; const answer = pins.find((pin) => pin.role === 'native_teacher_answer'); const artwork = pins.find((pin) => pin.role === 'activity_artwork'); Object.assign(answer, artwork, { role: 'native_teacher_answer' }); answer.pinSha256 = createHash('sha256').update(publicationAssetPinFingerprint(answer)).digest('hex'); },
  ]) {
    const input = freshInput(); transform(input);
    await assert.rejects(createProductRelease(sql, input));
    assert.equal(await countCandidates(), candidateCount, 'A rejected family rolls back every member and pin');
  }
  const missing = freshInput(); missing.members.pop();
  assert.equal((await createProductRelease(sql, missing)).outcome, 'invalid_request');
  assert.equal((await createProductRelease(sql, { ...freshInput(), builderUserId: randomUUID() })).outcome, 'unauthorized_actor');
  const raceComponent = drafts.get('ultimate-b1-students-book').componentId;
  const race = createBuilderProductPublicationHandler({ getDatabase: () => sql, authorize, storage: () => storage, logger: { error() {} },
    create: async (database, input) => {
      await pool.query("update units set title='Changed after freeze' where book_component_id=$1 and unit_number=1", [raceComponent]);
      return createProductRelease(database, input);
    },
  });
  assert.equal(response(await race(event(endpoint('ultimate-b1', 'prepare'), { clientMutationId: randomUUID(), releaseNote: 'Race fixture' })), 409).error, 'stale_release_preview');
  assert.equal(await countCandidates(), candidateCount, 'Source mutation after asset freeze rolls back PREPARE');
  await pool.query("update units set title='Unit 1' where book_component_id=$1 and unit_number=1", [raceComponent]);
  assert.deepEqual(response(await listPublishedBooks(sql, student)).books, [], 'PREPARE cannot activate content');
  await publish('ultimate-b1', r1, 0);
  const publishReplay = (await pool.query('select * from book_product_publication_mutations where product_release_id=$1', [r1.productReleaseId])).rows[0];
  assert.equal((await pool.query("select outcome from publish_builder_product_release('ultimate-b1',$1,0,$2,$3,$4)", [r1.productReleaseId, publishReplay.request_sha256, actor, publishReplay.client_mutation_id])).rows[0].outcome, 'idempotent');
  assert.equal((await pool.query("select outcome from publish_builder_product_release('ultimate-b1',$1,0,$2,$3,$4)", [r1.productReleaseId, 'e'.repeat(64), actor, randomUUID()])).rows[0].outcome, 'head_conflict');
  assert.equal((await pool.query("select outcome from publish_builder_product_release('ultimate-b1',$1,1,$2,$3,$4)", [r1.productReleaseId, 'e'.repeat(64), randomUUID(), randomUUID()])).rows[0].outcome, 'unauthorized_actor');
  const initialBooks = response(await listPublishedBooks(sql, student)).books;
  assert.equal(initialBooks.length, 2, 'Unpublished B1 Plus does not hide B1');
  const plus = await prepare('ultimate-b1-plus'); await publish('ultimate-b1-plus', plus, 0);
  assert.equal(response(await listPublishedBooks(sql, student)).books.length, 4);
  for (const book of response(await listPublishedBooks(sql, student)).books) {
    const image = drafts.get(book.componentSlug).image;
    const query = { bookSlug: book.bookSlug, componentSlug: book.componentSlug, releaseId: book.releaseId, activityId: image.activityId, sha256: image.sha256, extension: 'png' };
    const pins = (await pool.query('select asset_role,book_asset_id,object_key from book_component_release_asset_pins where component_release_id=$1 and checksum_sha256=$2', [book.releaseId, image.sha256])).rows;
    assert.deepEqual(pins.map((pin) => pin.asset_role).sort(), ['activity_artwork', 'managed_page_image', 'native_teacher_answer']);
    assert.equal(new Set(pins.map((pin) => pin.book_asset_id)).size, 3);
    assert.equal(new Set(pins.map((pin) => pin.object_key)).size, 3);
    assert.ok(!JSON.stringify(book).includes('PRIVATE_IMAGE_DESCRIPTION'));
    const answer = await getPublishedNativeTeacherAnswer(sql, query, { storage });
    assert.equal(answer.statusCode, 200, answer.body);
    assert.deepEqual(Buffer.from(answer.body, 'base64'), pageBytes);
    assert.equal((await routePublishedBookRead(sql, student, { httpMethod: 'GET' }, { ...query, action: 'published-native-answer-asset' }, {})).statusCode, 403);
    const requestedKeys = [];
    const publicAsset = await getPublishedReleaseAsset(sql, query, { storage: { ...storage, openReadStream: async (input) => {
      requestedKeys.push(input.objectKey); const bytes = await storage.download(input);
      return { body: new Response(bytes).body, byteSize: bytes.length, checksumSha256: image.sha256, contentType: 'image/png', contentRange: null };
    } } });
    assert.equal(publicAsset.status, 200);
    assert.deepEqual(Buffer.from(await publicAsset.arrayBuffer()), pageBytes);
    assert.ok(requestedKeys.length && requestedKeys.every((key) => !key.includes('/teacher-answers/')));
  }
  // A truthful historical component-only B2 publication must survive new empty/entitled namespaces.
  const historical = publishedManagedBookFixture('ultimate-b2-workbook');
  const legacy = await createComponentRelease(sql, { ...historical, bookSlug: 'ultimate-b2', componentSlug: 'ultimate-b2-workbook', requestSha256: historical.releaseSha256, clientMutationId: randomUUID(), builderUserId: actor, releaseNote: 'Historical fixture' });
  assert.equal(legacy.outcome, 'created');
  const b2Scope = (await pool.query("select id,book_package_id from book_components where slug='ultimate-b2-workbook'")).rows[0];
  await pool.query('insert into book_component_publication_heads(book_component_id,book_package_id,release_id,head_revision,published_by_builder_user_id) values($1,$2,$3,1,$4)', [b2Scope.id, b2Scope.book_package_id, legacy.releaseId, actor]);
  await pool.query('insert into book_component_publication_events(book_component_id,book_package_id,release_id,expected_head_revision,resulting_head_revision,request_sha256,client_mutation_id,published_by_builder_user_id) values($1,$2,$3,0,1,$4,$5,$6)', [b2Scope.id, b2Scope.book_package_id, legacy.releaseId, historical.releaseSha256, randomUUID(), actor]);
  const allPackages = [...packages, { id: b2Scope.book_package_id, slug: 'ultimate-b2' }];
  const entitlementBooks = response(await listPublishedBooks(sql, student)).books;
  assert.equal(entitlementBooks.length, 4);
  const accessUser = { id: randomUUID(), school_id: student.school_id, role: 'student', status: 'active' };
  await pool.query("insert into app_users(id,school_id,role,full_name,email,password_hash,status) values($1,$2,'student','Entitlement fixture',$3,'synthetic','active')", [accessUser.id, accessUser.school_id, `${accessUser.id}@example.test`]);
  for (let mask = 0; mask < 8; mask++) {
    await pool.query('delete from book_access where user_id=$1', [accessUser.id]);
    const entitled = allPackages.filter((_pack, index) => mask & (1 << index));
    for (const pack of entitled) await pool.query("insert into book_access(user_id,book_package_id,role_scope) values($1,$2,'student')", [accessUser.id, pack.id]);
    const visible = response(await listPublishedBooks(sql, accessUser)).books;
    assert.deepEqual([...new Set(visible.map((book) => book.bookSlug))].sort(), entitled.map((pack) => pack.slug).sort());
    for (const book of entitlementBooks) {
      const query = { bookSlug: book.bookSlug, componentSlug: book.componentSlug, releaseId: book.releaseId, activityId: book.pages[0].hotspots[0].activityId, sha256: book.pages[0].image.sha256, extension: 'png' };
      if (!entitled.some((pack) => pack.slug === book.bookSlug)) for (const action of ['active-component-release', 'published-book-activity', 'published-release-asset']) {
        assert.equal((await routePublishedBookRead(sql, accessUser, { httpMethod: 'GET' }, { ...query, action }, {})).statusCode, 403, action);
      }
      for (const action of ['published-native-teacher', 'published-native-answer-asset']) assert.equal((await routePublishedBookRead(sql, accessUser, { httpMethod: 'GET' }, { ...query, action }, {})).statusCode, 403, action);
    }
  }
  const sb = initialBooks.find((book) => book.componentSlug === 'ultimate-b1-students-book');
  const otherHeads = async () => ({
    products: (await pool.query("select * from book_product_publication_heads where book_package_id<>(select id from book_packages where slug='ultimate-b1') order by book_package_id")).rows,
    components: (await pool.query("select * from book_component_publication_heads where book_package_id<>(select id from book_packages where slug='ultimate-b1') order by book_component_id")).rows,
  });
  const originalOtherHeads = await otherHeads();
  const absent = await pool.connect();
  try {
    await absent.query('begin');
    await absent.query("delete from book_product_publication_heads where book_package_id in (select id from book_packages where slug in ('ultimate-b1','ultimate-b1-plus'))");
    const isolatedSql = async (strings, ...values) => (await absent.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
    assert.deepEqual(response(await listPublishedBooks(isolatedSql, accessUser)).books.map((book) => book.componentSlug), ['ultimate-b2-workbook'], 'Missing new publications preserve healthy entitled B2 and never fall back to new component heads');
  } finally { await absent.query('rollback'); absent.release(); }
  const corruptRead = async (strings, ...values) => (await sql(strings, ...values)).map((row) => row.compiler_id === 'ultimate-b1-students-book-v2' && row.public_projection ? { ...row, public_projection_sha256: '0'.repeat(64) } : row);
  assert.equal(response(await listPublishedBooks(corruptRead, accessUser), 503).error, 'publication_catalog_unavailable', 'Corruption is distinguishable from an unpublished book');
  assert.deepEqual(sb.pages.map((page) => page.id), drafts.get(sb.componentSlug).pageIds);
  assert.ok(!JSON.stringify(initialBooks).includes('PUBLISHED_BOOK_PRIVATE_TEACHER_SENTINEL'));
  const activity = sb.pages[0].hotspots[0].target;
  const classId = randomUUID();
  await pool.query("insert into classes(id,school_id,teacher_id,name,slug,book_package_id,status,invite_code) values($1,$2,$3,'B1 fixture',$4,$5,'active',$4)", [classId, teacher.school_id, teacher.id, classId, packages.find((pack) => pack.slug === 'ultimate-b1').id]);
  await pool.query("insert into class_students(class_id,student_id,status) values($1,$2,'active')", [classId, student.id]);
  const assignment = response(await createAssignment(sql, { target: activity, classIds: [classId], idempotencyKey: randomUUID() }, teacher)).assignment;
  assert.ok(assignment);
  const originalAssignment = (await pool.query('select * from activity_assignments where id=$1', [assignment.id])).rows[0];
  const draft = drafts.get(sb.componentSlug);
  const hotspots = structuredClone(draft.fixture.publicProjection.hotspots);
  const first = hotspots.pages[draft.pageIds[0]][0];
  const originalId = first.activityKey;
  const addedId = originalId.replace(/-o1$/, '-o2');
  const addedPublic = structuredClone(draft.fixture.publicProjection.nativeActivities[originalId].document);
  const addedTeacher = structuredClone(draft.fixture.teacherProjection.nativeActivities[originalId].document);
  addedPublic.activityId = addedId; addedTeacher.activityId = addedId;
  const newIndex = structuredClone(draft.index);
  newIndex.activities.push({ activityId: addedId, kind: 'open-response', placement: addedPublic.placement, sortOrder: 4 });
  await save('ultimate-b1', sb.componentSlug, 'native-activity-index', newIndex);
  await save('ultimate-b1', sb.componentSlug, 'native-activity-public', addedPublic, addedId);
  await save('ultimate-b1', sb.componentSlug, 'native-activity-teacher', addedTeacher, addedId);
  hotspots.pages[draft.pageIds[0]].push({ ...first, id: 'new-hotspot', top: 45 });
  first.activityKey = addedId;
  hotspots.pages[draft.pageIds[1]][0].left = 21;
  delete hotspots.pages[draft.pageIds[2]];
  await save('ultimate-b1', sb.componentSlug, 'hotspots', hotspots);
  const doc = structuredClone(draft.fixture.publicProjection.nativeActivities[originalId].document);
  doc.metadata.title = 'R2 activity'; await save('ultimate-b1', sb.componentSlug, 'native-activity-public', doc, originalId);
  await pool.query('update book_pages set sort_order=1 where book_component_id=$1 and stable_key=$2', [draft.componentId, `${sb.componentSlug}/pages/${draft.pageIds[1]}`]);
  assert.deepEqual(response(await listPublishedBooks(sql, student)).books.filter((book) => book.bookSlug === 'ultimate-b1'), initialBooks);
  const stale = await prepare('ultimate-b1');
  assert.deepEqual(response(await listPublishedBooks(sql, student)).books.filter((book) => book.bookSlug === 'ultimate-b1'), initialBooks);
  await pool.query("update units set title='Unit edited after PREPARE' where book_component_id=$1 and unit_number=1", [draft.componentId]);
  assert.equal((await pool.query("select outcome from publish_builder_product_release('ultimate-b1',$1,1,$2,$3,$4)", [stale.productReleaseId, 'c'.repeat(64), actor, randomUUID()])).rows[0].outcome, 'stale_release_preview', 'SQL rechecks freshness without a prior frontend GET');
  response(await publication(event(endpoint('ultimate-b1', 'publish'), { productReleaseId: stale.productReleaseId, expectedHeadRevision: 1, clientMutationId: randomUUID() })), 409);
  const current = await prepare('ultimate-b1'); await publish('ultimate-b1', current, 1);
  const latest = response(await listPublishedBooks(sql, student)).books;
  const latestSb = latest.find((book) => book.componentSlug === sb.componentSlug);
  assert.deepEqual(latestSb.pages.map((page) => page.id), [draft.pageIds[1], draft.pageIds[0], draft.pageIds[2]]);
  assert.equal(latestSb.pages[2].hotspots.length, 0);
  assert.equal(latestSb.pages[1].hotspots.length, 2);
  assert.equal(latestSb.pages[1].hotspots[0].target.nativeActivityId, addedId);
  assert.equal(latestSb.pages[1].hotspots[1].target.nativeActivityId, originalId);
  assert.equal(latestSb.pages[0].hotspots[0].left, 21);
  assert.equal(latest.find((book) => book.bookSlug === 'ultimate-b1-plus').productReleaseId, plus.productReleaseId);
  assert.deepEqual(await otherHeads(), originalOtherHeads, 'B1 R2 does not change any B1 Plus or B2 publication head');
  const currentActivity = response(await getPublishedBookActivity(sql, student, { bookSlug: 'ultimate-b1', componentSlug: sb.componentSlug, releaseId: latestSb.releaseId, activityId: originalId }));
  assert.equal(currentActivity.target.entry.document.metadata.title, 'R2 activity');
  assert.deepEqual((await pool.query('select * from activity_assignments where id=$1', [assignment.id])).rows[0], originalAssignment);
  const oldActivity = response(await getPublishedBookActivity(sql, student, { bookSlug: 'ultimate-b1', componentSlug: sb.componentSlug, releaseId: activity.releaseId, activityId: activity.nativeActivityId }));
  assert.ok(!JSON.stringify(oldActivity).includes('R2 activity'));
  const assignments = await listAssignmentsForStudent(sql, student.id, student, { assignmentId: assignment.id, includeBook: true });
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].book.releaseId, activity.releaseId);
  assert.deepEqual(assignments[0].book.pages.map((page) => page.id), sb.pages.map((page) => page.id));
  assert.equal(assignments[0].book.pages[0].hotspots.find((hotspot) => hotspot.id === activity.locator.hotspotId).target.nativeActivityId, originalId);
  for (const release of (await pool.query('select * from book_component_releases')).rows) verifyImmutableComponentRelease(release);
  if (process.env.B1_PUBLICATION_BROWSER === '1') {
    const { verifyB1PublicationBrowser } = await import('./_b1-publication-browser.mjs');
    await verifyB1PublicationBrowser({ pool, sql, actor, teacher, student, media });
  }
  await verifyB1PublicationConcurrency({ t, pool, sql, actor, storage, drafts });
  await verifyB1LockOrder({ t, pool, sql, actor, drafts });
});
