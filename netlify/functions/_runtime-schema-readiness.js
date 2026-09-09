import { runtimeSchemaContract } from "./_runtime-schema-contract.js";

const successCache = new WeakMap();
const pendingChecks = new WeakMap();
const defaultCacheTtlMs = 60_000;
const schemaErrorCodes = new Set(["42P01", "42703", "3F000"]);

export function schemaNotReadyResponse(extraHeaders = {}) {
  return {
    statusCode: 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": "60",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
    body: JSON.stringify({
      error: "Service temporarily unavailable",
      code: "SCHEMA_NOT_READY",
    }),
  };
}

export function isClearSchemaError(error) {
  return schemaErrorCodes.has(String(error?.code || ""));
}

export function schemaFailureResponse(error, extraHeaders = {}) {
  return isClearSchemaError(error) ? schemaNotReadyResponse(extraHeaders) : null;
}

function failure(reason, details = {}) {
  return { ready: false, reason, ...details };
}

async function inspectRuntimeSchema(sql, contract) {
  let historyState;
  try {
    historyState = await sql`
      select to_regclass(current_schema() || '.eduforge_migration_history') is not null as history_exists
    `;
  } catch (error) {
    if (error?.code === "42501" || isClearSchemaError(error)) {
      return failure("HISTORY_UNREADABLE");
    }
    throw error;
  }
  if (!historyState[0]?.history_exists) return failure("HISTORY_MISSING");

  let history;
  try {
    history = await sql`
      select filename, checksum_sha256
      from eduforge_migration_history
    `;
  } catch (error) {
    if (error?.code === "42501" || isClearSchemaError(error)) {
      return failure("HISTORY_UNREADABLE");
    }
    throw error;
  }

  const applied = new Map();
  for (const row of history) {
    if (!applied.has(row.filename)) applied.set(row.filename, []);
    applied.get(row.filename).push(String(row.checksum_sha256 || "").toLowerCase());
  }
  for (const expected of contract.expectedMigrations) {
    const checksums = applied.get(expected.filename);
    // Additive publication capability has its own bounded readiness probe.
    // Existing B2/authentication remain available before the feature migration.
    if (!checksums?.length && expected.featureOptional === true) continue;
    if (!checksums?.length) return failure("EXPECTED_MIGRATION_MISSING", { migration: expected.filename });
    if (checksums.length !== 1 || !expected.compatibleChecksums.includes(checksums[0])) {
      return failure("EXPECTED_MIGRATION_CHECKSUM_MISMATCH", { migration: expected.filename });
    }
  }

  const requiredTables = contract.requiredTables.map(({ table }) => table);
  let columns;
  try {
    columns = await sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = any(${requiredTables}::text[])
    `;
  } catch (error) {
    if (error?.code === "42501" || isClearSchemaError(error)) {
      return failure("SCHEMA_CATALOG_UNREADABLE");
    }
    throw error;
  }
  const present = new Map();
  for (const row of columns) {
    if (!present.has(row.table_name)) present.set(row.table_name, new Set());
    present.get(row.table_name).add(row.column_name);
  }
  for (const required of contract.requiredTables) {
    if (!present.has(required.table)) return failure("REQUIRED_TABLE_MISSING", { table: required.table });
    for (const column of required.columns) {
      if (!present.get(required.table).has(column)) {
        return failure("REQUIRED_COLUMN_MISSING", { table: required.table, column });
      }
    }
  }
  return {
    ready: true,
    expectedMigrationCount: contract.expectedMigrationCount,
    latestMigration: contract.latestMigration,
    manifestFingerprint: contract.manifestFingerprint,
  };
}

export async function checkRuntimeSchemaReadiness(sql, {
  contract = runtimeSchemaContract,
  now = Date.now,
  cacheTtlMs = defaultCacheTtlMs,
} = {}) {
  const cachedUntil = successCache.get(sql) || 0;
  if (cachedUntil > now()) return { ready: true, cached: true };
  if (pendingChecks.has(sql)) return pendingChecks.get(sql);

  const check = inspectRuntimeSchema(sql, contract)
    .then((result) => {
      if (result.ready) successCache.set(sql, now() + cacheTtlMs);
      return result;
    })
    .finally(() => pendingChecks.delete(sql));
  pendingChecks.set(sql, check);
  return check;
}

export async function requireRuntimeSchema(sql, options) {
  const result = await checkRuntimeSchemaReadiness(sql, options);
  return result.ready ? null : schemaNotReadyResponse();
}

export function resetRuntimeSchemaReadinessCache(sql) {
  if (sql) {
    successCache.delete(sql);
    pendingChecks.delete(sql);
    return;
  }
  // WeakMaps cannot be cleared; tests reset known SQL abstractions explicitly.
}
