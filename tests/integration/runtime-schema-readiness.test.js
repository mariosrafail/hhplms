import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import pg from "pg";
import { setSqlForTests } from "../../netlify/functions/_auth-utils.js";
import {
  checkRuntimeSchemaReadiness,
  resetRuntimeSchemaReadinessCache,
} from "../../netlify/functions/_runtime-schema-readiness.js";
import { handler as authMe } from "../../netlify/functions/auth-me.js";
import { handler as signIn } from "../../netlify/functions/auth-signin.js";
import { handler as signOut } from "../../netlify/functions/auth-signout.js";
import { handler as users } from "../../netlify/functions/users.js";
import {
  compareMigrationHistory,
  loadProductionMigrationManifest,
} from "../../scripts/_migration-readiness.mjs";
import { applyCanonicalProductionMigrations } from "./_migration-test-helpers.mjs";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL || "";
const enabled = Boolean(databaseUrl)
  && process.env.TEST_DATABASE_CONFIRMATION === "isolated-test-database";

function scoped(base, schema, credentials = {}) {
  const url = new URL(base);
  if (credentials.username) url.username = credentials.username;
  if (credentials.password) url.password = credentials.password;
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function tag(pool) {
  const queryTemplate = (queryable) => async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) {
      text += `$${index + 1}${strings[index + 1]}`;
    }
    return (await queryable.query(text, values)).rows;
  };
  const sql = queryTemplate(pool);
  sql.authLoginTransaction = async (lockValues, callback) => {
    const client = await pool.connect();
    const transactionSql = queryTemplate(client);
    try {
      await client.query("begin");
      await transactionSql`
        select pg_advisory_xact_lock(lock_key)
        from (
          select distinct hashtextextended(value, 0) lock_key
          from unnest(${lockValues}::text[]) value
        ) locks
        order by lock_key
      `;
      const result = await callback(transactionSql);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  return sql;
}

function parse(response) {
  return {
    status: response.statusCode,
    body: JSON.parse(response.body || "{}"),
    headers: response.headers || {},
  };
}

async function expectDenied(pool, sql) {
  await pool.query("begin");
  try {
    await assert.rejects(pool.query(sql), (error) =>
      ["42501", "55000"].includes(error.code));
  } finally {
    await pool.query("rollback").catch(() => {});
  }
}

test("runtime readiness recovers, remains forward-compatible, and works through a DML-only role", {
  skip: !enabled,
  timeout: 180_000,
}, async (t) => {
  const suffix = randomBytes(6).toString("hex");
  const schema = `runtime_ready_${suffix}`;
  const role = `runtime_role_${suffix}`;
  const rolePassword = randomBytes(24).toString("hex");
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema "${schema}"`);
  const setup = new Pool({ connectionString: scoped(databaseUrl, schema) });
  let runtimePool;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousLocalConfirmation = process.env.LOCAL_DATABASE_CONFIRMATION;

  t.after(async () => {
    setSqlForTests(null);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalConfirmation === undefined) delete process.env.LOCAL_DATABASE_CONFIRMATION;
    else process.env.LOCAL_DATABASE_CONFIRMATION = previousLocalConfirmation;
    await runtimePool?.end();
    await setup.end();
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.query(`drop owned by "${role}" cascade`);
    await admin.query(`drop role if exists "${role}"`);
    await admin.end();
  });

  const migrations = await applyCanonicalProductionMigrations(setup);
  const readinessSql = tag(setup);
  assert.equal((await checkRuntimeSchemaReadiness(readinessSql)).ready, true);
  const canonicalRows = (await setup.query(
    "select filename,checksum_sha256 from eduforge_migration_history order by applied_at,filename",
  )).rows;
  assert.deepEqual(
    canonicalRows.map(({ filename }) => filename),
    migrations.map(({ filename }) => filename),
  );

  // 062 is an optional feature capability; loss of required history still blocks auth.
  const latest = migrations.find((migration) => migration.filename === '061_students_book_publication_v3.sql');
  await setup.query("delete from eduforge_migration_history where filename=$1", [latest.filename]);
  resetRuntimeSchemaReadinessCache(readinessSql);
  assert.equal((await checkRuntimeSchemaReadiness(readinessSql)).ready, false);
  await setup.query(
    "insert into eduforge_migration_history(filename,checksum_sha256) values($1,$2)",
    [latest.filename, latest.checksum],
  );
  assert.equal((await checkRuntimeSchemaReadiness(readinessSql)).ready, true);

  const feature = migrations.find((migration) => migration.filename === '062_b1_managed_publication.sql');
  if (feature) {
    await setup.query('update eduforge_migration_history set checksum_sha256=$2 where filename=$1', [feature.filename, '0'.repeat(64)]);
    // The canonical fresh-check boundary clears the successful cache above;
    // cacheTtlMs controls newly cached results, not an earlier cache entry.
    resetRuntimeSchemaReadinessCache(readinessSql);
    assert.equal((await checkRuntimeSchemaReadiness(readinessSql, { cacheTtlMs: 0 })).ready, false);
    await setup.query('update eduforge_migration_history set checksum_sha256=$2 where filename=$1', [feature.filename, feature.checksum]);
    resetRuntimeSchemaReadinessCache(readinessSql);
    assert.equal((await checkRuntimeSchemaReadiness(readinessSql, { cacheTtlMs: 0 })).ready, true);
  }

  await setup.query(
    "update eduforge_migration_history set checksum_sha256=$2 where filename=$1",
    [migrations[2].filename, "0".repeat(64)],
  );
  resetRuntimeSchemaReadinessCache(readinessSql);
  assert.equal((await checkRuntimeSchemaReadiness(readinessSql)).ready, false);
  await setup.query(
    "update eduforge_migration_history set checksum_sha256=$2 where filename=$1",
    [migrations[2].filename, migrations[2].checksum],
  );

  await setup.query(
    "insert into eduforge_migration_history(filename,checksum_sha256) values('999_future_expand.sql',$1)",
    ["f".repeat(64)],
  );
  resetRuntimeSchemaReadinessCache(readinessSql);
  assert.equal((await checkRuntimeSchemaReadiness(readinessSql)).ready, true);
  const withFuture = (await setup.query(
    "select filename,checksum_sha256 from eduforge_migration_history",
  )).rows;
  assert.equal(compareMigrationHistory(migrations, withFuture).ready, false);
  assert.deepEqual(compareMigrationHistory(migrations, withFuture).unknown, ["999_future_expand.sql"]);
  await setup.query("delete from eduforge_migration_history where filename='999_future_expand.sql'");

  const school = (await setup.query(
    "insert into schools(name) values('Runtime Role School') returning id",
  )).rows[0];
  const password = `Runtime-${suffix}-Password!`;
  const passwordHash = await bcrypt.hash(password, 4);
  const adminUser = (await setup.query(`
    insert into app_users(school_id,full_name,email,role,status,password_hash,auth_provider)
    values($1,'Runtime Admin',$2,'admin','active',$3,'password')
    returning id,email
  `, [school.id, `runtime-${suffix}@example.test`, passwordHash])).rows[0];

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  await admin.query(`create role "${role}" login password '${rolePassword}' nosuperuser nocreatedb nocreaterole nobypassrls`);
  await admin.query(`grant connect on database "${databaseName.replaceAll('"', '""')}" to "${role}"`);
  await setup.query(`grant usage on schema "${schema}" to "${role}"`);
  await setup.query(`revoke create on schema "${schema}" from "${role}"`);
  await setup.query(`grant select,insert,update,delete on all tables in schema "${schema}" to "${role}"`);
  await setup.query(`grant usage,select,update on all sequences in schema "${schema}" to "${role}"`);
  await setup.query(`grant execute on all functions in schema "${schema}" to "${role}"`);

  const attributes = (await admin.query(
    "select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname=$1",
    [role],
  )).rows[0];
  assert.deepEqual(attributes, {
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolbypassrls: false,
  });
  assert.equal((await setup.query(
    "select has_schema_privilege($1,current_schema(),'create') allowed",
    [role],
  )).rows[0].allowed, false);

  runtimePool = new Pool({
    connectionString: scoped(databaseUrl, schema, { username: role, password: rolePassword }),
  });
  await expectDenied(runtimePool, "create table forbidden_runtime_table(id integer)");
  await expectDenied(runtimePool, "alter table app_users add column forbidden_runtime_column text");
  await expectDenied(runtimePool, "create index forbidden_runtime_index on app_users(id)");
  await expectDenied(runtimePool, "drop table auth_sessions");
  await expectDenied(runtimePool, "create extension if not exists hstore");

  const runtimeSql = tag(runtimePool);
  setSqlForTests(runtimeSql);
  process.env.DATABASE_URL = scoped(databaseUrl, schema, { username: role, password: rolePassword });
  process.env.LOCAL_DATABASE_CONFIRMATION = "isolated-local-pilot";
  const signin = parse(await signIn({
    httpMethod: "POST",
    headers: { host: "localhost:8888", "x-nf-client-connection-ip": "127.0.21.1" },
    body: JSON.stringify({ email: adminUser.email, password }),
  }));
  assert.equal(signin.status, 200);
  const cookie = signin.headers["Set-Cookie"].split(";")[0];
  assert.equal(parse(await authMe({
    httpMethod: "GET",
    headers: { host: "localhost:8888", cookie },
  })).status, 200);
  assert.equal(parse(await users({
    httpMethod: "GET",
    headers: { host: "localhost:8888", cookie },
  })).status, 200);
  assert.equal(parse(await signOut({
    httpMethod: "POST",
    headers: { host: "localhost:8888", cookie },
  })).status, 200);
  assert.equal(Number((await setup.query(
    "select count(*) count from auth_login_attempts where user_id=$1",
    [adminUser.id],
  )).rows[0].count) > 0, true);
  assert.equal(Number((await setup.query(
    "select count(*) count from auth_sessions where user_id=$1",
    [adminUser.id],
  )).rows[0].count), 0);

  resetRuntimeSchemaReadinessCache(readinessSql);
  const before = {
    history: Number((await setup.query("select count(*) count from eduforge_migration_history")).rows[0].count),
    users: Number((await setup.query("select count(*) count from app_users")).rows[0].count),
    sessions: Number((await setup.query("select count(*) count from auth_sessions")).rows[0].count),
  };
  assert.equal((await checkRuntimeSchemaReadiness(readinessSql)).ready, true);
  const after = {
    history: Number((await setup.query("select count(*) count from eduforge_migration_history")).rows[0].count),
    users: Number((await setup.query("select count(*) count from app_users")).rows[0].count),
    sessions: Number((await setup.query("select count(*) count from auth_sessions")).rows[0].count),
  };
  assert.deepEqual(after, before);

  await setup.query("alter table app_users drop column auth_provider");
  resetRuntimeSchemaReadinessCache(readinessSql);
  assert.equal((await checkRuntimeSchemaReadiness(readinessSql)).reason, "REQUIRED_COLUMN_MISSING");
  await setup.query("alter table app_users add column auth_provider text default 'password'");
  await setup.query("drop table auth_sessions");
  resetRuntimeSchemaReadinessCache(readinessSql);
  assert.equal((await checkRuntimeSchemaReadiness(readinessSql)).reason, "REQUIRED_TABLE_MISSING");
});
