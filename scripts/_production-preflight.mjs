import pg from "pg";
import { databaseFingerprint, databaseIdentity, parseDatabaseTarget } from "./_database-identity.mjs";
import {
  assertMigrationHistoryReady,
  compareMigrationHistory,
  loadProductionMigrationManifest,
  migrationManifestSummary,
} from "./_migration-readiness.mjs";

const { Pool } = pg;
const placeholderPattern = /(replace|placeholder|example\.invalid|changeme|change-me|your[_-]|dummy|secret123)/i;
const nonProductionMarker = /(^|[._/-])(staging|stage|test|testing|preview|sandbox|qa|quality-assurance)([._/-]|$)/i;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const criticalTables = Object.freeze([
  "schools",
  "app_users",
  "auth_sessions",
  "auth_login_attempts",
  "platform_admins",
  "platform_admin_sessions",
  "platform_admin_audit_log",
  "platform_admin_login_attempts",
  "account_tokens",
  "account_email_outbox",
  "book_packages",
  "activity_assignments",
  "activity_submissions",
]);

function productionError(message) {
  const error = new Error(message);
  error.operatorSafe = true;
  return error;
}

function parseUrl(value, name, protocols) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw productionError(`${name} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol)) throw productionError(`${name} uses an unsupported protocol`);
  return url;
}

export function productionDatabaseIdentity(value) {
  return databaseIdentity(value);
}

export function productionDatabaseFingerprint(value) {
  return databaseFingerprint(value);
}

export function validateProductionEnvironment(environment = process.env) {
  const required = [
    "DATABASE_URL",
    "PRODUCTION_DATABASE_FINGERPRINT",
    "PRODUCTION_ENVIRONMENT_CONFIRMATION",
    "PRODUCTION_DATABASE_CONFIRMATION",
    "PRODUCTION_APP_URL",
  ];
  const missing = required.filter((name) => !String(environment[name] || "").trim());
  if (missing.length) throw productionError(`Missing required production variables: ${missing.join(", ")}`);
  if (environment.PRODUCTION_ENVIRONMENT_CONFIRMATION !== "hosted-production") {
    throw productionError("PRODUCTION_ENVIRONMENT_CONFIRMATION must equal hosted-production");
  }
  if (environment.PRODUCTION_DATABASE_CONFIRMATION !== "read-only-production-preflight") {
    throw productionError("PRODUCTION_DATABASE_CONFIRMATION must equal read-only-production-preflight");
  }

  const target = parseDatabaseTarget(environment.DATABASE_URL);
  const identity = target.identity;
  if (loopbackHosts.has(target.host) || target.host.startsWith("127.")) {
    throw productionError("DATABASE_URL must not identify a loopback database");
  }
  if (nonProductionMarker.test(identity)) {
    throw productionError("DATABASE_URL appears to identify a non-production database");
  }
  const configuredFingerprint = String(environment.PRODUCTION_DATABASE_FINGERPRINT).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(configuredFingerprint) || placeholderPattern.test(configuredFingerprint)) {
    throw productionError("PRODUCTION_DATABASE_FINGERPRINT must be a SHA-256 database identity fingerprint");
  }
  if (productionDatabaseFingerprint(environment.DATABASE_URL) !== configuredFingerprint) {
    throw productionError("Production database fingerprint does not match DATABASE_URL");
  }

  const appUrl = parseUrl(environment.PRODUCTION_APP_URL, "PRODUCTION_APP_URL", ["https:"]);
  if (
    !appUrl.hostname
    || appUrl.username
    || appUrl.password
    || placeholderPattern.test(environment.PRODUCTION_APP_URL)
    || nonProductionMarker.test(appUrl.hostname)
  ) {
    throw productionError("PRODUCTION_APP_URL must identify the hosted production application");
  }

  return {
    connectionString: target.connectionString,
    appOrigin: appUrl.origin,
    fingerprintPrefix: configuredFingerprint.slice(0, 12),
  };
}

function readinessError(result) {
  try {
    assertMigrationHistoryReady(result);
  } catch (error) {
    throw productionError(error.message);
  }
}

export async function checkProductionDatabase({
  environment = process.env,
  createPool = (connectionString) => new Pool({ connectionString }),
  migrations,
} = {}) {
  const target = validateProductionEnvironment(environment);
  let pool;
  let client;
  let began = false;

  try {
    const expected = migrations || await loadProductionMigrationManifest();
    const manifest = migrationManifestSummary(expected);
    pool = createPool(target.connectionString);
    client = await pool.connect();
    await client.query("begin read only");
    began = true;
    await client.query("set local statement_timeout = '15s'");
    await client.query("set local lock_timeout = '2s'");
    await client.query("set local idle_in_transaction_session_timeout = '20s'");

    const objects = (await client.query(`
      select
        to_regclass(current_schema() || '.schools') is not null as schema_exists,
        to_regclass(current_schema() || '.eduforge_migration_history') is not null as history_exists
    `)).rows[0];
    if (!objects.history_exists) {
      if (objects.schema_exists) throw productionError("Production schema exists without verified migration history");
      throw productionError("Production migration history table is missing");
    }

    const history = (await client.query(
      "select filename,checksum_sha256,applied_at from eduforge_migration_history order by applied_at,filename",
    )).rows;
    const readiness = compareMigrationHistory(expected, history);
    if (!readiness.ready) readinessError(readiness);

    const tableRows = (await client.query(`
      select table_name
      from information_schema.tables
      where table_schema=current_schema() and table_name=any($1::text[])
    `, [criticalTables])).rows;
    const existingTables = new Set(tableRows.map(({ table_name }) => table_name));
    const missingTables = criticalTables.filter((table) => !existingTables.has(table));
    if (missingTables.length) throw productionError(`Production schema is missing critical tables: ${missingTables.join(", ")}`);

    let tenantIssues = [];
    if (manifest.requiresTenantIntegrityView) {
      const viewExists = (await client.query(
        "select to_regclass(current_schema() || '.tenant_integrity_issues') is not null as exists",
      )).rows[0].exists;
      if (!viewExists) throw productionError("Production schema is missing required tenant_integrity_issues");
      tenantIssues = (await client.query(
        "select table_name,null_school_rows from tenant_integrity_issues where null_school_rows<>0 order by table_name",
      )).rows.map((row) => ({
        category: /^[a-z0-9_]{1,64}$/.test(row.table_name) ? row.table_name : "invalid_category",
        count: Number(row.null_school_rows),
      }));
      if (tenantIssues.length) {
        throw productionError(`Production tenant integrity failed: ${tenantIssues.map(({ category, count }) => `${category}=${count}`).join(", ")}`);
      }
    }

    return {
      ...readiness,
      tenantIntegrityClean: true,
      criticalTableCount: criticalTables.length,
      fingerprintPrefix: target.fingerprintPrefix,
    };
  } catch (error) {
    if (error.operatorSafe) throw error;
    throw productionError("Production database preflight could not be completed");
  } finally {
    if (began) await client.query("rollback").catch(() => {});
    if (client) client.release();
    if (pool) await pool.end().catch(() => {});
  }
}

export { criticalTables };
