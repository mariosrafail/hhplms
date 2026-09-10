import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBuilderPagesHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-pages.js';
import { createBuilderProductPublicationHandler } from '../../netlify-sites/ultimate-b2-builder/server/_builder-product-publication.js';
import { clientSql } from './_b1-page-placement-regression.mjs';
import { waitForBlock } from './_b1-lock-regression.mjs';

const event = (path, body) => ({ path, httpMethod: 'POST', headers: { host: 'builder.example', origin: 'https://builder.example', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const read = (response, status = 200) => { assert.equal(response.statusCode, status, response.body); return JSON.parse(response.body); };
export async function verifyB1PublicationConcurrency({ t, pool, sql, actor, storage, drafts }) {
  const authorize = async () => ({ builderUser: { id: actor } });
  const handler = (database) => createBuilderProductPublicationHandler({ getDatabase: () => database, authorize, storage: () => storage });
  for (const [component, draft] of drafts) for (const action of ['prepare', 'publish']) for (const first of ['source', 'publication']) {
    const book = component.replace(/-(students-book|workbook)$/, '');
    await t.test(`${component}: ${action}, ${first} first serializes real page placement and stale checks`, async () => {
      const prepareEvent = event(`/builder/api/publication/books/${book}/prepare`, { clientMutationId: randomUUID(), releaseNote: 'Concurrent fixture' });
      const candidate = action === 'publish' ? read(await handler(sql)(prepareEvent)) : null;
      const heads = async () => (await pool.query('select * from book_product_publication_heads order by book_package_id')).rows;
      const beforeHeads = await heads();
      const revision = (await pool.query('select head_revision from book_product_publication_heads where book_package_id=(select id from book_packages where slug=$1)', [book])).rows[0].head_revision;
      const row = (await pool.query('select page.*,revision.revision,unit.id next_unit from book_pages page join builder_component_page_revisions revision on revision.book_component_id=page.book_component_id join units unit on unit.book_component_id=page.book_component_id and unit.unit_number=case when (select unit_number from units where id=page.unit_id)=3 then 1 else 3 end where page.stable_key=$1', [`${component}/pages/${draft.pageIds[0]}`])).rows[0];
      const source = await pool.connect(), publisher = await pool.connect(), observer = await pool.connect();
      let pending;
      try {
        await source.query("begin; set local statement_timeout='5s'"); await publisher.query("begin; set local statement_timeout='5s'");
        const pages = createBuilderPagesHandler({ getDatabase: () => clientSql(source), authorize, storage: () => storage });
        const write = () => pages(event(`/builder/api/pages/books/${book}/components/${component}/pages/${draft.pageIds[0]}/metadata`, {
          expectedRevision: Number(row.revision), clientMutationId: randomUUID(), metadata: { label: row.label, sortOrder: row.sort_order, printedLabel: row.source_metadata.printed_label || '', unitId: row.next_unit },
        }));
        // Direct canonical PUBLISH SQL proves freshness independent of frontend
        // preflight. PREPARE runs the real HTTP compiler/pins/SQL path.
        const publish = async () => action === 'prepare' ? handler(clientSql(publisher))(prepareEvent)
          : (await publisher.query('select * from publish_builder_product_release($1,$2,$3,$4,$5,$6)', [book, candidate.productReleaseId, revision, 'a'.repeat(64), actor, randomUUID()])).rows[0];
        if (first === 'source') {
          read(await write());
          pending = publish();
          await waitForBlock(observer, publisher, source);
          await source.query('commit');
          const result = await pending;
          if (action === 'prepare') assert.equal(read(result, 409).error, 'stale_release_preview');
          else assert.equal(result.outcome, 'stale_release_preview');
          await publisher.query('rollback');
          assert.deepEqual(await heads(), beforeHeads);
        } else {
          const result = await publish();
          const preparedId = action === 'prepare' ? read(result).productReleaseId : candidate.productReleaseId;
          if (action === 'publish') assert.equal(result.outcome, 'published');
          pending = write();
          await waitForBlock(observer, source, publisher);
          // A distinct book/component lock remains independently available.
          const other = [...drafts].find(([name]) => name.replace(/-(students-book|workbook)$/, '') !== book)[1];
          await observer.query("begin; set local statement_timeout='500ms'");
          await observer.query('select lock_builder_b1_component_source($1)', [other.componentId]);
          await observer.query('rollback');
          await publisher.query('commit');
          read(await pending); await source.query('commit');
          assert.equal((await pool.query('select builder_product_release_sources_are_current($1) current', [preparedId])).rows[0].current, false);
          if (action === 'prepare') assert.deepEqual(await heads(), beforeHeads);
          else {
            const after = await heads();
            assert.equal(after.find((head) => head.product_release_id === preparedId)?.head_revision, String(Number(revision) + 1));
            assert.deepEqual(after.filter((head) => head.product_release_id !== preparedId), beforeHeads.filter((head) => head.book_package_id !== row.book_package_id));
          }
        }
      } finally { await pending?.catch(() => {}); await source.query('rollback'); await publisher.query('rollback'); await observer.query('rollback'); source.release(); publisher.release(); observer.release(); }
    });
  }
}
