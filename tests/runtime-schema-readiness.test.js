import assert from "node:assert/strict";
import test from "node:test";
import { runtimeSchemaContract } from "../netlify/functions/_runtime-schema-contract.js";
import {
  checkRuntimeSchemaReadiness,
  requireRuntimeSchema,
  resetRuntimeSchemaReadinessCache,
  schemaFailureResponse,
  schemaNotReadyResponse,
} from "../netlify/functions/_runtime-schema-readiness.js";

function readyState(overrides = {}) {
  return {
    historyExists: true,
    history: runtimeSchemaContract.expectedMigrations.map(({ filename, compatibleChecksums }) => ({
      filename,
      checksum_sha256: compatibleChecksums[0],
    })),
    columns: runtimeSchemaContract.requiredTables.flatMap(({ table, columns }) =>
      columns.map((column_name) => ({ table_name: table, column_name }))),
    delay: 0,
    ...overrides,
  };
}

function fakeSql(state, counts = { queries: 0 }) {
  return Object.assign(async (strings) => {
    counts.queries += 1;
    if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
    const query = strings.join("?");
    if (query.includes("to_regclass")) {
      if (state.historyError) throw state.historyError;
      return [{ history_exists: state.historyExists }];
    }
    if (query.includes("from eduforge_migration_history")) {
      if (state.historyReadError) throw state.historyReadError;
      return state.history;
    }
    if (query.includes("information_schema.columns")) return state.columns;
    throw new Error(`Unexpected readiness query: ${query}`);
  }, { counts });
}

test("runtime readiness requires expected history but allows forward-compatible extras", async () => {
  const exactSql = fakeSql(readyState());
  assert.equal((await checkRuntimeSchemaReadiness(exactSql)).ready, true);

  const futureSql = fakeSql(readyState({
    history: [
      ...readyState().history,
      { filename: "999_future_expand.sql", checksum_sha256: "f".repeat(64) },
    ],
  }));
  assert.equal((await checkRuntimeSchemaReadiness(futureSql)).ready, true);

  for (const missingIndex of [0, 5, runtimeSchemaContract.expectedMigrations.findLastIndex((entry) => !entry.featureOptional)]) {
    const history = readyState().history.filter((_row, index) => index !== missingIndex);
    const result = await checkRuntimeSchemaReadiness(fakeSql(readyState({ history })));
    assert.equal(result.ready, false);
    assert.equal(result.reason, "EXPECTED_MIGRATION_MISSING");
  }

  const optional = runtimeSchemaContract.expectedMigrations.filter((entry) => entry.featureOptional).map((entry) => entry.filename);
  assert.deepEqual(optional, ["062_b1_managed_publication.sql", "063_b1_immutable_package_ui.sql", "064_teacher_overview_ui.sql", "065_teacher_overview_managed_font.sql"]);
  assert.equal((await checkRuntimeSchemaReadiness(fakeSql(readyState({ history: readyState().history.filter((row) => !optional.includes(row.filename)) })))).ready, true);
  assert.equal((await checkRuntimeSchemaReadiness(fakeSql(readyState({ history: readyState().history.map((row) => optional.includes(row.filename) ? { ...row, checksum_sha256: "0".repeat(64) } : row) })))).ready, false);

  const corrupt = readyState().history.map((row, index) =>
    index === 2 ? { ...row, checksum_sha256: "0".repeat(64) } : row);
  assert.equal(
    (await checkRuntimeSchemaReadiness(fakeSql(readyState({ history: corrupt })))).reason,
    "EXPECTED_MIGRATION_CHECKSUM_MISMATCH",
  );
});

test("history and required schema failures are safe and specific internally", async () => {
  assert.equal(
    (await checkRuntimeSchemaReadiness(fakeSql(readyState({ historyExists: false })))).reason,
    "HISTORY_MISSING",
  );
  assert.equal(
    (await checkRuntimeSchemaReadiness(fakeSql(readyState({
      historyReadError: Object.assign(new Error("private database detail"), { code: "42501" }),
    })))).reason,
    "HISTORY_UNREADABLE",
  );

  const withoutTable = readyState().columns.filter(({ table_name }) => table_name !== "auth_sessions");
  assert.equal(
    (await checkRuntimeSchemaReadiness(fakeSql(readyState({ columns: withoutTable })))).reason,
    "REQUIRED_TABLE_MISSING",
  );
  const withoutColumn = readyState().columns.filter(
    ({ table_name, column_name }) => !(table_name === "app_users" && column_name === "auth_provider"),
  );
  assert.equal(
    (await checkRuntimeSchemaReadiness(fakeSql(readyState({ columns: withoutColumn })))).reason,
    "REQUIRED_COLUMN_MISSING",
  );
});

test("success caches, failures retry, expiry works, and concurrent checks coalesce", async () => {
  let now = 1_000;
  const counts = { queries: 0 };
  const sql = fakeSql(readyState(), counts);
  assert.equal((await checkRuntimeSchemaReadiness(sql, { now: () => now, cacheTtlMs: 50 })).ready, true);
  assert.equal(counts.queries, 3);
  assert.equal((await checkRuntimeSchemaReadiness(sql, { now: () => now, cacheTtlMs: 50 })).cached, true);
  assert.equal(counts.queries, 3);
  now += 51;
  assert.equal((await checkRuntimeSchemaReadiness(sql, { now: () => now, cacheTtlMs: 50 })).ready, true);
  assert.equal(counts.queries, 6);
  resetRuntimeSchemaReadinessCache(sql);
  await checkRuntimeSchemaReadiness(sql, { now: () => now, cacheTtlMs: 50 });
  assert.equal(counts.queries, 9);

  const failingCounts = { queries: 0 };
  const failingSql = fakeSql(readyState({ historyExists: false }), failingCounts);
  await checkRuntimeSchemaReadiness(failingSql);
  await checkRuntimeSchemaReadiness(failingSql);
  assert.equal(failingCounts.queries, 2);

  const concurrentCounts = { queries: 0 };
  const concurrentSql = fakeSql(readyState({ delay: 5 }), concurrentCounts);
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    checkRuntimeSchemaReadiness(concurrentSql)));
  assert.equal(results.every(({ ready }) => ready), true);
  assert.equal(concurrentCounts.queries, 3);
});

test("public schema response is stable, redacted, and limited to clear PostgreSQL schema races", async () => {
  const response = schemaNotReadyResponse();
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), {
    error: "Service temporarily unavailable",
    code: "SCHEMA_NOT_READY",
  });
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["Retry-After"], "60");
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(JSON.stringify(response).includes("migration"), false);

  assert.equal(schemaFailureResponse({ code: "42P01", message: "secret table" }).statusCode, 503);
  assert.equal(schemaFailureResponse({ code: "42703" }).statusCode, 503);
  assert.equal(schemaFailureResponse({ code: "3F000" }).statusCode, 503);
  assert.equal(schemaFailureResponse({ code: "40P01" }), null);

  const error = await requireRuntimeSchema(fakeSql(readyState({ historyExists: false })));
  assert.equal(error.statusCode, 503);
  assert.equal(error.body.includes("eduforge_migration_history"), false);
});
