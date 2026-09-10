import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { applyCanonicalProductionMigrations } from './_migration-test-helpers.mjs';
import { loadProductionMigrationManifest } from '../../scripts/_migration-readiness.mjs';
import { applyProductionMigration } from '../../scripts/_migration-transaction.mjs';

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.TEST_DATABASE_CONFIRMATION === 'isolated-test-database';
test('062 DDL and history share the runner transaction: both fault stages roll back and retry verifies', { skip: !enabled }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /test/i);
  const schema = `b1_atomic_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await admin.query(`create schema "${schema}"`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  t.after(async () => { await pool.end(); await admin.query(`drop schema "${schema}" cascade`); await admin.end(); });
  await applyCanonicalProductionMigrations(pool, { through: '061_students_book_publication_v3.sql' });
  const migration = (await loadProductionMigrationManifest()).find((entry) => entry.filename === '062_b1_managed_publication.sql');
  const state = async () => ({
    functions: (await pool.query(`select proname, pg_get_function_identity_arguments(oid) args, pg_get_functiondef(oid) definition, proacl
      from pg_proc where pronamespace=current_schema()::regnamespace and prokind='f' order by proname,args`)).rows,
    triggers: (await pool.query(`select tgname,pg_get_triggerdef(oid) definition from pg_trigger
      where tgrelid in (select oid from pg_class where relnamespace=current_schema()::regnamespace) and not tgisinternal order by tgname`)).rows,
    history: (await pool.query('select * from eduforge_migration_history order by filename')).rows,
  });
  const run = async (value) => { const client = await pool.connect(); try { return await applyProductionMigration(client, value); } finally { client.release(); } };
  await pool.query(`create function reject_test_history() returns trigger language plpgsql as $$ begin
    if new.filename='062_b1_managed_publication.sql' then raise exception 'injected_history_failure'; end if; return new; end $$;
    create trigger test_history_failure before insert on eduforge_migration_history for each row execute function reject_test_history()`);
  const before = await state();
  await assert.rejects(run(migration), /injected_history_failure/);
  assert.deepEqual(await state(), before, 'New helpers/triggers vanish and every replaced function, ACL and history row is restored');
  await pool.query('drop trigger test_history_failure on eduforge_migration_history; drop function reject_test_history()');
  const clean = await state();
  await assert.rejects(run({ ...migration, sql: migration.sql + "\ndo $$ begin raise exception 'injected_install_failure'; end $$;" }), /injected_install_failure/);
  assert.deepEqual(await state(), clean, 'Installation failure before history also rolls back all DDL');
  assert.equal(await run(migration), 'applied');
  const installed = await state();
  assert.deepEqual(installed.history.filter((row) => row.filename === migration.filename).map((row) => row.checksum_sha256), [migration.checksum]);
  assert.equal(installed.triggers.filter((row) => /^(units|pages|assets|documents)_b1_publication_lock$/.test(row.tgname)).length, 4);
  assert.ok(installed.functions.some((row) => row.proname === 'builder_b1_publication_contract'));
  assert.equal(await run(migration), 'verified');
  assert.deepEqual(await state(), installed, 'Verified replay executes no DDL and changes no history');
});
