import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createBuilderNativeActivitiesHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-native-activities.js';
import { builderDocumentSha256 } from '../../netlify-sites/ultimate-b2-builder/server/_builder-content-security.js';
import { buildNativeActivityAssetObjectKey } from '../../lib/book-assets/object-keys.js';
import { clientSql } from './_b1-page-placement-regression.mjs';

export async function waitForBlock(observer, client, blocker) {
  const pid = client.processID, blockerPid = blocker.processID;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = (await observer.query('select $2::int=any(pg_blocking_pids($1)) blocked', [pid, blockerPid])).rows[0];
    if (row.blocked) return;
    await delay(5);
  }
  assert.fail(`Expected backend ${pid} to wait for ${blockerPid}`);
}
const nativeEvent = (book, component, body) => ({ httpMethod: 'POST', path: `/builder/api/native-activities/books/${book}/components/${component}/create`, headers: { host: 'builder.example', origin: 'https://builder.example', 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function retirement(client, book, component, activityId, actor) {
  const docs = (await client.query("select document_type,payload,revision from builder_component_documents where book_component_id=(select id from book_components where slug=$1) and document_type in ('native_activity_index','hotspots')", [component])).rows;
  const index = docs.find((row) => row.document_type === 'native_activity_index'), hotspots = docs.find((row) => row.document_type === 'hotspots');
  const payload = { ...index.payload, activities: index.payload.activities.filter((entry) => entry.activityId !== activityId) };
  // The temporary activity is deliberately unlinked, so the unchanged hotspot
  // document is the canonical retirement candidate with removed count zero.
  return (await client.query('select * from delete_builder_native_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$7,false,0,$6,$11,$12)',
    [book, component, activityId, index.revision, payload, builderDocumentSha256(payload), '1.0', hotspots.revision, hotspots.payload, builderDocumentSha256(hotspots.payload), actor, randomUUID()])).rows[0];
}

export async function verifyB1LockOrder({ t, pool, sql, actor, drafts }) {
  await pool.query(`create function b1_test_edition_barrier() returns trigger language plpgsql as $$ begin
    if current_setting('b1_test.pause_upload',true)='on' then perform pg_advisory_xact_lock(hashtextextended('b1-test-edition-barrier',0)); end if; return new; end $$;
    create trigger b1_test_edition_barrier before insert on book_editions for each row execute function b1_test_edition_barrier()`);
  try {
    for (const [component, draft] of drafts) for (const purpose of ['native-asset', 'teacher-answer']) for (const first of ['upload', 'retirement']) {
      const book = component.replace(/-(students-book|workbook)$/, '');
      await t.test(`${component} ${purpose}: ${first} first uses real finalization/retirement without deadlock`, async () => {
        const create = createBuilderNativeActivitiesHandler({ getDatabase: () => sql, authorize: async () => ({ builderUser: { id: actor } }) });
        const created = await create(nativeEvent(book, component, { kind: 'image', pageId: draft.pageIds[0], title: 'Concurrency fixture', clientMutationId: randomUUID() }));
        assert.equal(created.statusCode, 200, created.body);
        const activityId = JSON.parse(created.body).activityId, uploadId = randomUUID(), mutation = randomUUID();
        const checksum = createHash('sha256').update(`${component}:${purpose}:${first}`).digest('hex');
        const objectKey = buildNativeActivityAssetObjectKey({ bookSlug: book, componentSlug: component, activityId, checksum, extension: '.png', purpose });
        const prepared = (await pool.query("select * from prepare_builder_native_asset_upload($1,$2,$3,'race-asset',$4,$5,$6,$7,$8,$9,now()+interval '10 minutes')", [book, component, activityId, mutation, uploadId, checksum, { purpose, name: 'fixture.png', type: 'image/png', size: 128 }, `synthetic-staging/${uploadId}`, actor])).rows[0];
        assert.equal(prepared.outcome, 'prepared');
        assert.equal((await pool.query('select * from claim_builder_native_asset_upload($1,$2,$3)', [uploadId, mutation, actor])).rows[0].outcome, 'claimed');
        const control = await pool.connect(), upload = await pool.connect(), retire = await pool.connect(), observer = await pool.connect();
        const complete = () => upload.query("select complete_builder_native_asset_upload($1,$2,$3,'private-assets','image/png',128,$4,64,64) id", [uploadId, actor, objectKey, checksum]);
        let uploading, retiring;
        const caught = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
        try {
          await upload.query("begin; set local statement_timeout='5s'; set local deadlock_timeout='100ms'");
          await retire.query("begin; set local statement_timeout='5s'; set local deadlock_timeout='100ms'");
          if (first === 'upload') {
            await control.query("select pg_advisory_lock(hashtextextended('b1-test-edition-barrier',0))");
            await upload.query("set local b1_test.pause_upload='on'");
            uploading = caught(complete());
            await waitForBlock(observer, upload, control);
            retiring = caught(retirement(retire, book, component, activityId, actor));
            await waitForBlock(observer, retire, upload);
            // Corrected upload owns publication before native-assets. In the old
            // schema retirement instead owned publication while awaiting assets;
            // releasing this barrier caused the actual asset INSERT deadlock.
            await control.query("select pg_advisory_unlock(hashtextextended('b1-test-edition-barrier',0))");
            const completed = await uploading; assert.ifError(completed.error); assert.ok(completed.value.rows[0].id);
            await upload.query('commit');
            const retired = await retiring; assert.ifError(retired.error); assert.equal(retired.value.outcome, 'deleted');
            await retire.query('commit');
            assert.equal((await observer.query('select state from builder_native_asset_upload_sessions where id=$1', [uploadId])).rows[0].state, 'completed');
            assert.equal((await observer.query('select count(*)::int count from book_assets where object_key=$1', [objectKey])).rows[0].count, 1);
          } else {
            // Stop real retirement between publication and native-assets locks.
            const assetLock = `builder-native-assets:${draft.componentId}:${activityId}`;
            await control.query('select pg_advisory_lock(hashtextextended($1,0))', [assetLock]);
            retiring = caught(retirement(retire, book, component, activityId, actor));
            await waitForBlock(observer, retire, control);
            uploading = caught(complete());
            await waitForBlock(observer, upload, retire);
            await control.query('select pg_advisory_unlock(hashtextextended($1,0))', [assetLock]);
            const retired = await retiring; assert.ifError(retired.error); assert.equal(retired.value.outcome, 'deleted');
            await retire.query('commit');
            const completed = await uploading;
            assert.equal(completed.error?.code, '23514');
            assert.match(completed.error.message, /native activity is not active/);
            await upload.query('rollback');
            assert.equal((await observer.query('select state from builder_native_asset_upload_sessions where id=$1', [uploadId])).rows[0].state, 'finalizing');
            assert.equal((await observer.query('select count(*)::int count from book_assets where object_key=$1', [objectKey])).rows[0].count, 0);
          }
          assert.equal((await observer.query('select builder_native_activity_is_active($1,$2) active', [draft.componentId, activityId])).rows[0].active, false);
        } finally {
          await control.query('select pg_advisory_unlock_all()');
          await Promise.all([uploading, retiring]);
          await upload.query('rollback'); await retire.query('rollback');
          control.release(); upload.release(); retire.release(); observer.release();
        }
      });
    }
  } finally { await pool.query('drop trigger b1_test_edition_barrier on book_editions; drop function b1_test_edition_barrier()'); }
}
