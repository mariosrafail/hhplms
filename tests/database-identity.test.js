import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import net from "node:net";
import pg from "pg";
import { databaseFingerprint, databaseIdentity, parseDatabaseTarget } from "../scripts/_database-identity.mjs";
import { createSafePool, requireSafeDatabase } from "../scripts/_staging-db.mjs";
import { checkStagingDeployment, openVerifiedStagingMigrationPool } from "../scripts/_staging-preflight.mjs";
import { checkProductionDatabase, productionDatabaseFingerprint, productionDatabaseIdentity, validateProductionEnvironment } from "../scripts/_production-preflight.mjs";
import { validateDemoEntitlementInventoryEnvironment } from "../scripts/_production-demo-entitlement-inventory.mjs";

const sha256 = (identity) => createHash("sha256").update(identity, "utf8").digest("hex");
const base = "postgresql://reader:synthetic-private@db.example";
const canonical = "db.example:5432/course_data";
let connectionAttempts = 0;
const originalConnect = net.Socket.prototype.connect;
test.before(() => {
  net.Socket.prototype.connect = function () {
    connectionAttempts += 1;
    throw new Error("Database identity tests must not open sockets");
  };
});
test.after(() => {
  net.Socket.prototype.connect = originalConnect;
  assert.equal(connectionAttempts, 0);
});

function driverTarget(connectionString, stringConstructor = false) {
  const client = new pg.Client(stringConstructor ? connectionString : { connectionString });
  return { host: client.host.toLowerCase(), port: client.port, database: client.getStartupConf().database };
}

// Expectations are literal target tuples, independent of both production and
// staging adapters. The installed driver is a separate, connection-free oracle.
const accepted = [
  ["ordinary", `${base}/course_data`, "db.example", 5432, "course_data"],
  ["encoded unreserved", `${base}/course%5Fdata`, "db.example", 5432, "course_data"],
  ["lowercase escape hex", `${base}/course%5fdata`, "db.example", 5432, "course_data"],
  ["encoded initial letter", `${base}/%63ourse_data`, "db.example", 5432, "course_data"],
  ["uppercase hostname", "postgres://reader:other@DB.EXAMPLE/course_data", "db.example", 5432, "course_data"],
  ["explicit default port", `${base}:5432/course_data`, "db.example", 5432, "course_data"],
  ["nondefault port", `${base}:6543/course_data`, "db.example", 6543, "course_data"],
  ["credentials", "postgresql://other:different@db.example/course_data", "db.example", 5432, "course_data"],
  ["no credentials", "postgresql://db.example/course_data", "db.example", 5432, "course_data"],
  ["irrelevant query", `${base}/course_data?sslmode=verify-full&application_name=identity_audit`, "db.example", 5432, "course_data"],
  ["schema options", `${base}/course_data?options=-c%20search_path%3Dsynthetic_fixture`, "db.example", 5432, "course_data"],
  ["literal Unicode", `${base}/café`, "db.example", 5432, "café"],
  ["encoded Unicode", `${base}/caf%C3%A9`, "db.example", 5432, "café"],
  ["decomposed Unicode stays distinct", `${base}/cafe%CC%81`, "db.example", 5432, "cafe\u0301"],
  ["encoded space", `${base}/course%20data`, "db.example", 5432, "course data"],
  ["literal inner slash", `${base}/course/data`, "db.example", 5432, "course/data"],
  ["percent decoded exactly once", `${base}/course%255fdata`, "db.example", 5432, "course%5fdata"],
  ["IPv6", "postgresql://reader:synthetic@[::1]:6543/course_data", "[::1]", 6543, "course_data"],
];
for (const [label, value, host, port, database] of accepted) {
  test(`database identity accepts ${label} with the exact driver target and historical production hash`, () => {
    const expected = `${host}:${port}/${database}`;
    const target = parseDatabaseTarget(value);
    assert.equal(target.identity, expected);
    assert.equal(databaseIdentity(value), expected);
    assert.equal(databaseFingerprint(value), sha256(expected));
    assert.equal(productionDatabaseIdentity(value), expected);
    assert.equal(productionDatabaseFingerprint(value), sha256(expected));
    for (const stringConstructor of [false, true]) {
      assert.deepEqual(driverTarget(target.connectionString, stringConstructor), { host, port, database });
    }
    // Preserve the old production recipe only within the proven accepted domain.
    const old = new URL(value);
    const legacy = `${old.hostname.toLowerCase()}:${old.port || "5432"}/${decodeURIComponent(old.pathname.replace(/^\/+/, "")).toLowerCase()}`;
    assert.equal(sha256(legacy), sha256(expected));
  });
}

const rejected = [
  ["case-changing effective name", `${base}/Course_data`],
  ["encoded case-changing name", `${base}/%43ourse_data`],
  ["Unicode case-changing name", `${base}/CAF%C3%89`],
  ["uppercase text after one decoding", `${base}/course%255Fdata`],
  ["second leading slash", `${base}//course_data`],
  ["malformed percent", `${base}/course%ZZdata`],
  ["truncated percent", `${base}/course%5`],
  ["reserved slash", `${base}/course%2Fdata`],
  ["reserved query delimiter", `${base}/course%3Fdata`],
  ["reserved fragment delimiter", `${base}/course%23data`],
  ["invalid UTF-8", `${base}/course%C3%28data`],
  ["overlong UTF-8", `${base}/course%C0%AFdata`],
  ["invalid UTF-8 query", `${base}/course_data?application_name=%FF`],
  ["unpaired surrogate", `${base}/course\ud800data`],
  ["encoded NUL", `${base}/course%00data`],
  ["literal NUL", `${base}/course\0data`],
  ["NUL query", `${base}/course_data?options=%00`],
  ["empty hostname", "postgresql:///course_data"],
  ["empty database", `${base}/`],
  ["omitted database", base],
  ["unsupported protocol", "http://reader:synthetic-private@db.example/course_data"],
  ["empty artifact", ""],
  ["empty URL artifact", "postgresql:///"],
  ["fragment", `${base}/course_data#ignored`],
  ["empty fragment", `${base}/course_data#`],
  ["raw whitespace", `${base}/course data`],
  ["stripped control", `${base}/course\ndata`],
  ["encoded hostname", "postgresql://reader:synthetic-private@%64b.example/course_data"],
  ["Unix socket hostname", "postgresql://reader:synthetic-private@%2Ftmp/course_data"],
  ["host list", "postgresql://reader:synthetic-private@db.example,other.example/course_data"],
  ["zero port", `${base}:0/course_data`],
  ["invalid port", `${base}:notaport/course_data`],
  ["out of range port", `${base}:65536/course_data`],
  ...["host", "hostaddr", "port", "database", "dbname", "db", "connectionString", "service", "servicefile", "replication", "HOST", "connection%53tring"].map((key) => [
    `target option ${key}`, `${base}/course_data?${key}=synthetic-private`,
  ]),
];
for (const [label, value] of rejected) {
  test(`database identity rejects ${label} before hashing without exposing input`, () => {
    for (const parse of [parseDatabaseTarget, databaseIdentity, databaseFingerprint, productionDatabaseIdentity, productionDatabaseFingerprint]) {
      assert.throws(() => parse(value), (error) => {
        assert.equal(error.operatorSafe, true);
        assert.doesNotMatch(String(error.stack), /synthetic-private|reader|db\.example|other\.example|course_data/);
        if (value) assert.equal(String(error.stack).includes(value), false);
        if (label === "unsupported protocol") {
          assert.equal(error.message, "Database target uses an unsupported protocol; use postgres:// or postgresql://");
        }
        assert.equal(error.cause, undefined);
        return true;
      });
    }
  });
}

test("driver case, reserved escapes and constructor ambiguity justify fail-closed restrictions", () => {
  assert.equal(driverTarget(`${base}:5432/Course_data`).database, "Course_data");
  assert.equal(driverTarget(`${base}:5432/course%5Fdata`).database, "course_data");
  assert.equal(driverTarget(`${base}:5432/course%2Fdata`).database, "course%2Fdata");
  assert.equal(driverTarget(`${base}:5432//course_data`).database, "/course_data");
  const nested = `${base}:5432/course_data?connectionString=${encodeURIComponent("postgresql://reader:synthetic@other.example:6543/another")}`;
  assert.deepEqual(driverTarget(nested), { host: "db.example", port: 5432, database: "course_data" });
  assert.deepEqual(driverTarget(nested, true), { host: "other.example", port: 6543, database: "another" });
  assert.throws(() => databaseFingerprint(nested), /query overrides/);
});

function productionEnvironment(url = `${base}/course%5Fdata`) {
  return {
    DATABASE_URL: url,
    PRODUCTION_DATABASE_FINGERPRINT: sha256(canonical),
    PRODUCTION_ENVIRONMENT_CONFIRMATION: "hosted-production",
    PRODUCTION_DATABASE_CONFIRMATION: "read-only-production-preflight",
    PRODUCTION_APP_URL: "https://publisher.example",
    PRODUCTION_DEMO_ENTITLEMENT_INVENTORY_CONFIRMATION: "read-only-demo-entitlement-inventory",
  };
}

function stagingEnvironment() {
  return {
    STAGING_DATABASE_URL: `${base}/course%5Fstaging`,
    DATABASE_URL: "postgres://runtime:synthetic-private@DB.EXAMPLE:5432/course_staging?application_name=runtime",
    STAGING_DATABASE_CONFIRMATION: "isolated-staging-database",
    STAGING_ENVIRONMENT_CONFIRMATION: "hosted-nonproduction-staging",
    STAGING_PRODUCTION_DATABASE_FINGERPRINTS: [sha256(canonical), sha256("other.example:6543/application")].join(","),
    STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION: "complete-production-database-identity-set",
    APP_PUBLIC_URL: "https://staging.publisher.example",
    STAGING_PRODUCTION_APP_URL: "https://publisher.example",
    AUTH_RATE_LIMIT_SALT: "a".repeat(40), PLATFORM_ADMIN_RATE_LIMIT_SALT: "b".repeat(40),
    ACCOUNT_RATE_LIMIT_SALT: "c".repeat(40), INVITE_RATE_LIMIT_SALT: "d".repeat(40),
    ACCOUNT_EMAIL_DISPATCH_SECRET: "e".repeat(40), OPERATIONAL_MONITORING_SECRET: "f".repeat(40),
    ACCOUNT_EMAIL_MODE: "preview", HHPLMS_STAGING_QA_PASSWORD: "password123",
  };
}

test("equivalent staging URLs match while every canonical deny-set collision remains rejected", async () => {
  const environment = stagingEnvironment();
  const result = await checkStagingDeployment(environment);
  assert.equal(result.production_database_fingerprint_count, 2);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private|postgres:|postgresql:|course_staging/);
  const collision = sha256("db.example:5432/course_staging");
  assert.equal(JSON.stringify(result).includes(collision), false);
  for (const denySet of [[collision, sha256(canonical)], [sha256(canonical), collision]]) {
    await assert.rejects(checkStagingDeployment({ ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: denySet.join(",") }), /known production database fingerprint/);
  }
  for (const runtime of [`${base}/other_staging`, `${base}:6543/course_staging`]) {
    await assert.rejects(checkStagingDeployment({ ...environment, DATABASE_URL: runtime }), /verified staging database/);
  }
});

test("lower-level staging and test guards compare effective identities and inspect decoded production markers", () => {
  for (const kind of ["staging", "test"]) {
    const key = kind.toUpperCase();
    const environment = {
      [`${key}_DATABASE_URL`]: `${base}/course%5F${kind}`,
      [`${key}_DATABASE_CONFIRMATION`]: `isolated-${kind}-database`,
      DATABASE_URL: `postgres://other:synthetic@DB.EXAMPLE:5432/course_${kind}?application_name=runtime`,
    };
    assert.throws(() => requireSafeDatabase(kind, environment), /same database/);
    const target = requireSafeDatabase(kind, { ...environment, DATABASE_URL: `${base}/another` });
    assert.equal(target.safeLabel, `db.example/course_${kind}`);
    assert.deepEqual(driverTarget(target.connectionString), { host: "db.example", port: 5432, database: `course_${kind}` });
    assert.throws(() => requireSafeDatabase(kind, { ...environment, DATABASE_URL: "", [`${key}_DATABASE_URL`]: `${base}/%70roduction_${kind}` }), /production database/);
  }
});

test("production exact match uses canonical bytes and preserves singular and confirmation requirements", () => {
  const environment = productionEnvironment();
  assert.equal(validateProductionEnvironment(environment).fingerprintPrefix, sha256(canonical).slice(0, 12));
  assert.throws(() => validateProductionEnvironment({ ...environment, PRODUCTION_DATABASE_FINGERPRINT: sha256("db.example:6543/course_data") }), /does not match/);
  assert.throws(() => validateProductionEnvironment({ ...environment, PRODUCTION_DATABASE_FINGERPRINT: `${sha256(canonical)},${sha256("another")}` }), /SHA-256 database identity fingerprint/);
  assert.throws(() => validateProductionEnvironment({ ...environment, PRODUCTION_DATABASE_FINGERPRINT: undefined, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: sha256(canonical) }), /Missing required production/);
  assert.throws(() => validateProductionEnvironment({ ...environment, PRODUCTION_DATABASE_CONFIRMATION: "yes" }), /must equal read-only-production-preflight/);
});

test("every rejected target fails consumer preflights before pool construction", async () => {
  let pools = 0;
  const createPool = () => { pools += 1; throw new Error("Pool must not be constructed"); };
  for (const [, value] of rejected) {
    await assert.rejects(checkProductionDatabase({ environment: productionEnvironment(value), createPool }));
    assert.throws(() => validateDemoEntitlementInventoryEnvironment(productionEnvironment(value)));
    await assert.rejects(openVerifiedStagingMigrationPool({ ...stagingEnvironment(), DATABASE_URL: value, STAGING_DATABASE_URL: value }, { createPool }));
  }
  assert.equal(pools, 0);
});

test("validated pool targets pin the default port despite ambient changes and delayed client creation", async () => {
  const previous = process.env.PGPORT;
  const environment = stagingEnvironment();
  try {
    process.env.PGPORT = "6543";
    assert.equal(driverTarget(`${base}/course_data`).port, 6543);
    assert.equal(databaseIdentity(`${base}/course_data`), canonical);
    const production = validateProductionEnvironment(productionEnvironment());
    const inventory = validateDemoEntitlementInventoryEnvironment(productionEnvironment());
    const staging = createSafePool("staging", { ...environment, DATABASE_URL: "" });
    const testPool = createSafePool("test", { TEST_DATABASE_URL: `${base}/course_test`, TEST_DATABASE_CONFIRMATION: "isolated-test-database" });
    const hosted = await openVerifiedStagingMigrationPool(environment);
    process.env.PGPORT = "7654";
    for (const connectionString of [production.connectionString, inventory.connectionString, staging.pool.options.connectionString, testPool.pool.options.connectionString, hosted.pool.options.connectionString]) {
      assert.equal(driverTarget(connectionString).port, 5432);
    }
    assert.equal(driverTarget(parseDatabaseTarget(`${base}:6543/course_data`).connectionString).port, 6543);
    assert.equal(productionEnvironment().DATABASE_URL, `${base}/course%5Fdata`);
    await Promise.all([staging.pool.end(), testPool.pool.end(), hosted.pool.end()]);
  } finally {
    if (previous === undefined) delete process.env.PGPORT; else process.env.PGPORT = previous;
  }
});
