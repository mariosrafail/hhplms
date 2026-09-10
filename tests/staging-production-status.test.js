import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkStagingDeployment, openVerifiedStagingMigrationPool } from "../scripts/_staging-preflight.mjs";
import { requireSafeDatabase } from "../scripts/_staging-db.mjs";

// Independent canonical fixture identities, not output from the production adapter.
const digest = (identity) => createHash("sha256").update(identity, "utf8").digest("hex");
const stagingFingerprint = digest("db.staging.test:5432/course_data");
const protectedFingerprints = [
  digest("archive.example.test:5432/old_course_data"),
  digest("archive-pool.example.test:5432/old_course_data"),
];
const activeKeys = [
  "STAGING_PRODUCTION_DATABASE_FINGERPRINTS",
  "STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION",
  "STAGING_PRODUCTION_APP_URL",
];
const protectedKeys = [
  "STAGING_PROTECTED_DATABASE_FINGERPRINTS",
  "STAGING_PROTECTED_DATABASE_FINGERPRINTS_CONFIRMATION",
];

function environment(mode = "active-production", overrides = {}) {
  const db = "postgresql://operator:password-canary@DB.STAGING.TEST/course%5Fdata";
  return {
    STAGING_DATABASE_URL: db,
    DATABASE_URL: "postgresql://runtime:runtime-canary@db.staging.test:5432/course_data?application_name=fixture",
    STAGING_DATABASE_CONFIRMATION: "isolated-staging-database",
    STAGING_ENVIRONMENT_CONFIRMATION: "hosted-nonproduction-staging",
    APP_PUBLIC_URL: "https://staging.example.test",
    AUTH_RATE_LIMIT_SALT: "a".repeat(40),
    PLATFORM_ADMIN_RATE_LIMIT_SALT: "b".repeat(40),
    ACCOUNT_RATE_LIMIT_SALT: "c".repeat(40),
    INVITE_RATE_LIMIT_SALT: "d".repeat(40),
    ACCOUNT_EMAIL_DISPATCH_SECRET: "e".repeat(40),
    OPERATIONAL_MONITORING_SECRET: "f".repeat(40),
    ACCOUNT_EMAIL_MODE: "preview",
    HHPLMS_STAGING_QA_PASSWORD: "password123",
    STAGING_ACTIVE_PRODUCTION_STATUS: mode,
    ...(mode === "no-active-production" ? {
      STAGING_PROTECTED_DATABASE_FINGERPRINTS: protectedFingerprints.join(","),
      STAGING_PROTECTED_DATABASE_FINGERPRINTS_CONFIRMATION: "complete-protected-database-identity-set",
    } : {
      STAGING_PRODUCTION_DATABASE_FINGERPRINTS: protectedFingerprints.join(","),
      STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION: "complete-production-database-identity-set",
      STAGING_PRODUCTION_APP_URL: "https://app.example.test",
    }),
    ...overrides,
  };
}

function assertRedacted(value, input) {
  const text = JSON.stringify(value);
  for (const secret of [
    "password-canary", "runtime-canary", "private-input-canary", stagingFingerprint,
    ...protectedFingerprints,
    ...["STAGING_DATABASE_URL", "DATABASE_URL", "APP_PUBLIC_URL", ...activeKeys.slice(2),
      "AUTH_RATE_LIMIT_SALT", "PLATFORM_ADMIN_RATE_LIMIT_SALT", "ACCOUNT_RATE_LIMIT_SALT",
      "INVITE_RATE_LIMIT_SALT", "ACCOUNT_EMAIL_DISPATCH_SECRET", "OPERATIONAL_MONITORING_SECRET"]
      .map((key) => input[key]).filter((entry) => typeof entry === "string" && entry.length > 10),
  ]) assert.equal(text.includes(secret), false, "Operator output must not expose supplied values");
  assert.doesNotMatch(text, /postgres(?:ql)?:\/\//);
}

async function rejectsBeforePool(input, pattern) {
  let factoryCalls = 0;
  await assert.rejects(openVerifiedStagingMigrationPool(input, {
    createPool() { factoryCalls += 1; throw new Error("Pool factory must not be reached"); },
  }), (error) => {
    assert.match(error.message, pattern);
    assertRedacted({ message: error.message, cause: error.cause }, input);
    return true;
  });
  assert.equal(factoryCalls, 0);
}

test("legacy absent status retains the complete active-production contract", async () => {
  const explicit = await checkStagingDeployment(environment());
  const legacy = await checkStagingDeployment(environment("active-production", { STAGING_ACTIVE_PRODUCTION_STATUS: undefined }));
  assert.deepEqual(legacy, explicit);
  assert.equal(legacy.active_production_status, "active-production");
  assert.equal(legacy.production_database_fingerprint_count, 2);
  assert.equal("protected_database_fingerprint_count" in legacy, false);
  assertRedacted(legacy, environment());
});

test("no-active-production requires only the protected contract and returns truthful safe metadata", async () => {
  const input = Object.freeze(environment("no-active-production"));
  const result = await checkStagingDeployment(input);
  assert.equal(result.active_production_status, "no-active-production");
  assert.equal(result.protected_database_fingerprint_count, 2);
  assert.deepEqual(Object.keys(result).sort(), [
    "active_production_status", "app_host", "email_mode", "environment", "latest_migration",
    "manifest_fingerprint", "migration_count", "protected_database_fingerprint_count",
  ]);
  assert.equal(result.app_host, "staging.example.test");
  assert.equal(result.environment, "hosted-staging");
  assert.equal(result.email_mode, "preview");
  assert.ok(result.migration_count > 0);
  assertRedacted(result, input);
});

for (const [label, value] of [
  ["empty", ""], ["whitespace", " "], ["unknown", "private-input-canary"],
  ["wrong case", "NO-ACTIVE-PRODUCTION"], ["padded", " no-active-production "],
  ["null", null], ["boolean", false], ["number", 0],
]) test(`production status rejects ${label} before opening a pool`, async () => {
  await rejectsBeforePool(environment("no-active-production", { STAGING_ACTIVE_PRODUCTION_STATUS: value }), /STAGING_ACTIVE_PRODUCTION_STATUS/);
});

test("a protected set never implicitly selects no-active-production", async () => {
  await rejectsBeforePool(environment("no-active-production", { STAGING_ACTIVE_PRODUCTION_STATUS: undefined }), /STAGING_PROTECTED_DATABASE_FINGERPRINTS/);
});

for (const [mode, setKey, confirmationKey, marker, foreignKeys] of [
  ["active-production", activeKeys[0], activeKeys[1], "complete-production-database-identity-set", protectedKeys],
  ["no-active-production", protectedKeys[0], protectedKeys[1], "complete-protected-database-identity-set", activeKeys],
]) {
  for (const [label, value, pattern] of [
    ["missing", undefined, /Missing required staging variables/],
    ["empty", "", /Missing required staging variables/],
    ["whitespace", "  ", /Missing required staging variables/],
    ["short", "a".repeat(63), /SHA-256/],
    ["non-hex", "g".repeat(64), /SHA-256/],
    ["private malformed value", "postgresql://private-input-canary/invalid", /SHA-256/],
    ["duplicate", `${protectedFingerprints[0]},${protectedFingerprints[0].toUpperCase()}`, /duplicate/],
    ["leading empty entry", `,${protectedFingerprints[0]}`, /empty entries/],
    ["trailing empty entry", `${protectedFingerprints[0]},`, /empty entries/],
    ["middle empty entry", protectedFingerprints.join(",,"), /empty entries/],
  ]) test(`${mode} rejects ${label} deny-set`, async () => {
    await rejectsBeforePool(environment(mode, { [setKey]: value }), pattern);
  });

  for (const [label, value] of [
    ["missing", undefined], ["blank", ""], ["wrong", "private-input-canary"],
    ["other mode", marker.replace(mode === "active-production" ? "production" : "protected", mode === "active-production" ? "protected" : "production")],
  ]) test(`${mode} rejects ${label} completeness confirmation`, async () => {
    await rejectsBeforePool(environment(mode, { [confirmationKey]: value }), new RegExp(confirmationKey));
  });

  test(`${mode} accepts normalized non-empty SHA-256 entries`, async () => {
    const result = await checkStagingDeployment(environment(mode, { [setKey]: ` ${protectedFingerprints[1].toUpperCase()}, ${protectedFingerprints[0]} ` }));
    assert.equal(result.active_production_status, mode);
  });

  for (const position of [0, 1, 2]) test(`${mode} rejects canonical target collision at position ${position}`, async () => {
    const entries = [...protectedFingerprints];
    entries.splice(position, 0, stagingFingerprint);
    await rejectsBeforePool(environment(mode, { [setKey]: entries.join(",") }), /matches a (?:known production|protected) database fingerprint/);
  });

  for (const key of foreignKeys) {
    for (const [label, value] of [["supplied", "private-input-canary"], ["empty", ""], ["whitespace", " "], ["null", null]]) {
      test(`${mode} rejects ${label} foreign-mode ${key}`, async () => {
        await rejectsBeforePool(environment(mode, { [key]: value }), new RegExp(key));
      });
    }
  }
}

for (const [label, value, pattern] of [
  ["missing", undefined, /STAGING_PRODUCTION_APP_URL/],
  ["invalid", "private-input-canary", /STAGING_PRODUCTION_APP_URL/],
  ["non-HTTPS", "http://app.example.test", /unsupported protocol/],
  ["same origin", "https://staging.example.test/different-path", /application URLs must differ/],
]) test(`active-production rejects ${label} production app URL`, async () => {
  await rejectsBeforePool(environment("active-production", { STAGING_PRODUCTION_APP_URL: value }), pattern);
});

test("no-active-production rejects a fake production URL instead of using it", async () => {
  await rejectsBeforePool(environment("no-active-production", { STAGING_PRODUCTION_APP_URL: "https://app.example.invalid" }), /STAGING_PRODUCTION_APP_URL/);
});

for (const [label, overrides, pattern] of [
  ["runtime mismatch", { DATABASE_URL: "postgresql://operator:password-canary@db.staging.test/other" }, /verified staging database/],
  ["isolation confirmation", { STAGING_DATABASE_CONFIRMATION: "wrong" }, /STAGING_DATABASE_CONFIRMATION/],
  ["hosted confirmation", { STAGING_ENVIRONMENT_CONFIRMATION: "wrong" }, /Hosted staging confirmation/],
  ["QA password", { HHPLMS_STAGING_QA_PASSWORD: "wrong" }, /canonical password/],
  ["short secret", { AUTH_RATE_LIMIT_SALT: "short" }, /AUTH_RATE_LIMIT_SALT/],
  ["duplicate salts", { AUTH_RATE_LIMIT_SALT: "b".repeat(40) }, /salts must differ/],
  ["invalid app", { APP_PUBLIC_URL: "private-input-canary" }, /APP_PUBLIC_URL/],
  ["non-HTTPS app", { APP_PUBLIC_URL: "http://staging.example.test" }, /unsupported protocol/],
  ["unrecognized app", { APP_PUBLIC_URL: "https://builder.hhplms.workers.dev" }, /hostname must visibly identify staging/],
  ["invalid email mode", { ACCOUNT_EMAIL_MODE: "send-anywhere" }, /email mode/],
  ["incomplete SMTP", { ACCOUNT_EMAIL_MODE: "smtp" }, /Missing required staging variables/],
]) test(`no-active-production preserves common guard: ${label}`, async () => {
  await rejectsBeforePool(environment("no-active-production", overrides), pattern);
});

for (const [label, target, pattern] of [
  ["case-changing database", "db.staging.test/Course_data", /lowercase normalization/],
  ["malformed encoding", "db.staging.test/course%GGdata", /valid URL/],
  ["reserved encoded slash", "db.staging.test/course%2Fdata", /divergent driver semantics/],
  ["target override", "db.staging.test/course_data?host=elsewhere.test", /query overrides/],
  ["production marker", "db.production.test/course_data", /production database/],
  ["missing isolation marker", "db.example/course_data", /isolated staging target/],
]) test(`no-active-production retains database rejection: ${label}`, async () => {
  const url = `postgresql://operator:password-canary@${target}`;
  await rejectsBeforePool(environment("no-active-production", { DATABASE_URL: url, STAGING_DATABASE_URL: url }), pattern);
});

test("no-active-production accepts the exact known LMS staging origin", async () => {
  const result = await checkStagingDeployment(environment("no-active-production", { APP_PUBLIC_URL: "https://lms.hhplms.workers.dev" }));
  assert.equal(result.app_host, "lms.hhplms.workers.dev");
});

test("no-active-production migration handoff freezes and validates the target before invoking the pool factory", async () => {
  const input = environment("no-active-production");
  let factoryCalls = 0;
  const pending = openVerifiedStagingMigrationPool(input, { createPool(targetEnvironment) {
    factoryCalls += 1;
    assert.deepEqual(Object.keys(targetEnvironment).sort(), ["STAGING_DATABASE_CONFIRMATION", "STAGING_DATABASE_URL"]);
    const target = requireSafeDatabase("staging", targetEnvironment);
    const url = new URL(target.connectionString);
    assert.equal(url.hostname, "db.staging.test");
    assert.equal(url.port, "5432");
    assert.equal(decodeURIComponent(url.pathname), "/course_data");
    return { ...target, pool: { synthetic: true } };
  } });
  input.STAGING_DATABASE_URL = "postgresql://operator:password-canary@other.staging.test/other";
  input.STAGING_PROTECTED_DATABASE_FINGERPRINTS = "";
  const result = await pending;
  assert.equal(factoryCalls, 1);
  assert.equal(result.kind, "staging");
  assert.equal(result.safeLabel, "db.staging.test/course_data");
  assert.equal(result.pool.synthetic, true);
  assert.equal(result.preflight.active_production_status, "no-active-production");
  assertRedacted(result, environment("no-active-production"));
});
