import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constantTimeSecretMatches } from "../netlify/functions/_operations-utils.js";
import { lifecycleRetentionConfiguration } from "../netlify/functions/_lifecycle-cleanup.js";
import {
  checkStagingDeployment,
  openVerifiedStagingMigrationPool,
  parseStagingProductionDatabaseFingerprints,
  validateDedicatedStagingRecipient,
} from "../scripts/_staging-preflight.mjs";
import { requireSafeDatabase } from "../scripts/_staging-db.mjs";
import { handler as publicDispatcher } from "../netlify/functions/account-email-dispatch.js";
import { config as dispatchSchedule } from "../netlify/functions/scheduled-account-email-dispatch.js";
import { config as cleanupSchedule } from "../netlify/functions/scheduled-lifecycle-cleanup.js";
import { inviteRequestFingerprint } from "../netlify/functions/_class-utils.js";
import { loadProductionMigrationManifest, migrationManifestSummary } from "../scripts/_migration-readiness.mjs";

function fingerprint(identity) {
  return createHash("sha256").update(identity).digest("hex");
}

function hostedStagingEnvironment(overrides = {}) {
  const db = "postgresql://qa:runtime-value@db.staging.test/hhplms_staging";
  const productionFingerprints = [
    fingerprint("db.production.test:5432/hhplms_production"),
    fingerprint("db-primary.production.test:5432/hhplms_production"),
    fingerprint("db-pool.production.test:5432/hhplms_production"),
  ];
  return {
    STAGING_DATABASE_URL: db,
    STAGING_DATABASE_CONFIRMATION: "isolated-staging-database",
    STAGING_ENVIRONMENT_CONFIRMATION: "hosted-nonproduction-staging",
    DATABASE_URL: db,
    APP_PUBLIC_URL: "https://hhplms-staging.example.test",
    STAGING_PRODUCTION_APP_URL: "https://app.example.test",
    STAGING_PRODUCTION_DATABASE_FINGERPRINTS: productionFingerprints.join(","),
    STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION: "complete-production-database-identity-set",
    AUTH_RATE_LIMIT_SALT: "e".repeat(40),
    PLATFORM_ADMIN_RATE_LIMIT_SALT: "f".repeat(40),
    ACCOUNT_RATE_LIMIT_SALT: "a".repeat(40),
    INVITE_RATE_LIMIT_SALT: "b".repeat(40),
    ACCOUNT_EMAIL_DISPATCH_SECRET: "c".repeat(40),
    OPERATIONAL_MONITORING_SECRET: "d".repeat(40),
    ACCOUNT_EMAIL_MODE: "preview",
    HHPLMS_STAGING_QA_PASSWORD: "password123",
    ...overrides,
  };
}

test("operational secrets use constant-time hash comparison and retention values are bounded", () => {
  assert.equal(constantTimeSecretMatches("correct", "correct"), true);
  assert.equal(constantTimeSecretMatches("wrong", "correct"), false);
  assert.equal(constantTimeSecretMatches("", "correct"), false);
  const previous = process.env.ACCOUNT_OUTBOX_RETENTION_DAYS;
  process.env.ACCOUNT_OUTBOX_RETENTION_DAYS = "29";
  assert.throws(() => lifecycleRetentionConfiguration(), /ACCOUNT_OUTBOX_RETENTION_DAYS/);
  if (previous === undefined) delete process.env.ACCOUNT_OUTBOX_RETENTION_DAYS; else process.env.ACCOUNT_OUTBOX_RETENTION_DAYS = previous;
});

test("public dispatcher rejects unauthenticated calls and workers declare internal schedules", async () => {
  const response = await publicDispatcher({ httpMethod: "POST", headers: {} });
  assert.equal(response.statusCode, 401);
  assert.equal(dispatchSchedule.schedule, "*/15 * * * *");
  assert.equal(cleanupSchedule.schedule, "17 2 * * *");
  const previous = { salt: process.env.INVITE_RATE_LIMIT_SALT, test: process.env.TEST_DATABASE_CONFIRMATION, staging: process.env.STAGING_DATABASE_CONFIRMATION };
  delete process.env.INVITE_RATE_LIMIT_SALT; delete process.env.TEST_DATABASE_CONFIRMATION; delete process.env.STAGING_DATABASE_CONFIRMATION;
  assert.throws(() => inviteRequestFingerprint({ headers: {} }), /INVITE_RATE_LIMIT_SALT/);
  if (previous.salt === undefined) delete process.env.INVITE_RATE_LIMIT_SALT; else process.env.INVITE_RATE_LIMIT_SALT = previous.salt;
  if (previous.test === undefined) delete process.env.TEST_DATABASE_CONFIRMATION; else process.env.TEST_DATABASE_CONFIRMATION = previous.test;
  if (previous.staging === undefined) delete process.env.STAGING_DATABASE_CONFIRMATION; else process.env.STAGING_DATABASE_CONFIRMATION = previous.staging;
});

test("staging production fingerprint parser normalizes a valid deterministic multi-entry set", () => {
  const first = "A".repeat(64);
  const second = "b".repeat(64);
  assert.deepEqual(parseStagingProductionDatabaseFingerprints(` ${second}, ${first} `), [first.toLowerCase(), second]);
});

test("staging production fingerprint parser rejects empty, malformed, placeholder, duplicate, and empty-entry sets without echoing input", () => {
  const privateMarker = "private-database-marker";
  const invalidSets = [
    ["", /at least one/],
    ["   ", /at least one/],
    ["a".repeat(63), /SHA-256/],
    [`${privateMarker}-${"a".repeat(64)}`, /SHA-256/],
    [`${"a".repeat(64)},${"A".repeat(64)}`, /duplicate/],
    [`${"a".repeat(64)},`, /empty entries/],
    [`,${"a".repeat(64)}`, /empty entries/],
    [`${"a".repeat(64)},,${"b".repeat(64)}`, /empty entries/],
  ];
  for (const [value, pattern] of invalidSets) {
    assert.throws(
      () => parseStagingProductionDatabaseFingerprints(value),
      (error) => pattern.test(error.message) && !error.message.includes(privateMarker) && !error.message.includes("a".repeat(64)),
    );
  }
});

test("staging preflight rejects unsafe inboxes and accepts non-secret hosted metadata", async () => {
  assert.throws(() => validateDedicatedStagingRecipient("person@gmail.com", "dedicated-nonproduction-inbox"), /personal mailbox/);
  const environment = hostedStagingEnvironment();
  const result = await checkStagingDeployment(environment);
  assert.equal(result.latest_migration, migrationManifestSummary(await loadProductionMigrationManifest()).latestMigration);
  assert.equal(result.production_database_fingerprint_count, 3);
  const resultJson = JSON.stringify(result);
  for (const productionFingerprint of environment.STAGING_PRODUCTION_DATABASE_FINGERPRINTS.split(",")) {
    assert.equal(resultJson.includes(productionFingerprint), false);
  }
  assert.doesNotMatch(resultJson, /runtime-value|postgresql:\/\//);
  await assert.rejects(checkStagingDeployment({ ...environment, HHPLMS_STAGING_QA_PASSWORD: "not-canonical" }), /canonical password/);
});

test("staging preflight accepts visible staging hosts and only the exact known Cloudflare LMS origin", async () => {
  const environment = hostedStagingEnvironment();
  for (const appPublicUrl of ["https://staging.example.test", "https://lms.hhplms.workers.dev"]) {
    const result = await checkStagingDeployment({ ...environment, APP_PUBLIC_URL: appPublicUrl });
    assert.equal(result.app_host, new URL(appPublicUrl).hostname);
  }

  for (const appPublicUrl of [
    "https://builder.hhplms.workers.dev",
    "https://random-worker.example.workers.dev",
    "https://lms.other-account.workers.dev",
  ]) {
    await assert.rejects(
      checkStagingDeployment({ ...environment, APP_PUBLIC_URL: appPublicUrl }),
      /must visibly identify staging or match the known hosted staging origin/,
    );
  }

  await assert.rejects(
    checkStagingDeployment({ ...environment, APP_PUBLIC_URL: environment.STAGING_PRODUCTION_APP_URL }),
    /staging and production application URLs must differ/,
  );
});

test("staging preflight rejects collisions in every production fingerprint set position", async () => {
  const environment = hostedStagingEnvironment();
  const stagingFingerprint = fingerprint("db.staging.test:5432/hhplms_staging");
  const safe = environment.STAGING_PRODUCTION_DATABASE_FINGERPRINTS.split(",");
  for (const fingerprints of [
    [stagingFingerprint, ...safe],
    [safe[0], stagingFingerprint, ...safe.slice(1)],
    [...safe, stagingFingerprint],
  ]) {
    await assert.rejects(
      checkStagingDeployment({ ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: fingerprints.join(",") }),
      /matches a known production database fingerprint/,
    );
  }
});

test("staging preflight fails closed for missing, malformed, or unconfirmed production identity sets", async () => {
  const environment = hostedStagingEnvironment();
  const unsafeEnvironments = [
    { ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: undefined },
    { ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: "" },
    { ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: "a".repeat(63) },
    { ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: `${"a".repeat(64)},` },
    { ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: `${"a".repeat(64)},${"A".repeat(64)}` },
    { ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: "replace-with-production-fingerprint" },
    { ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION: undefined },
    { ...environment, STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION: "partial-production-database-identity-set" },
  ];
  for (const unsafeEnvironment of unsafeEnvironments) {
    await assert.rejects(checkStagingDeployment(unsafeEnvironment));
  }
});

test("canonical migration pool opens only after the full hosted staging preflight", async () => {
  const openedTargets = [];
  const createPool = (targetEnvironment) => {
    openedTargets.push(targetEnvironment);
    const target = requireSafeDatabase("staging", targetEnvironment);
    return { ...target, pool: { stub: true } };
  };
  const result = await openVerifiedStagingMigrationPool(hostedStagingEnvironment(), { createPool });
  assert.equal(openedTargets.length, 1);
  assert.equal(openedTargets[0].DATABASE_URL, undefined);
  assert.equal(result.pool.stub, true);
  assert.equal(result.safeLabel, "db.staging.test/hhplms_staging");
  assert.equal(result.preflight.environment, "hosted-staging");
  assert.equal("connectionString" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /runtime-value|postgresql:\/\//);
});

test("canonical migration pool cannot bypass hosted staging safety", async () => {
  let connectionAttempts = 0;
  const createPool = () => {
    connectionAttempts += 1;
    throw new Error("connection phase must not be reached");
  };
  const valid = hostedStagingEnvironment();
  const unsafeEnvironments = [
    { ...valid, DATABASE_URL: "postgresql://qa:other@db.staging.test/hhplms_other_staging" },
    { ...valid, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: fingerprint("db.staging.test:5432/hhplms_staging") },
    { ...valid, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: undefined },
    { ...valid, STAGING_PRODUCTION_DATABASE_FINGERPRINTS: `${"a".repeat(64)},` },
    { ...valid, STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION: "partial-production-database-identity-set" },
    { ...valid, STAGING_ENVIRONMENT_CONFIRMATION: "not-hosted-staging" },
    { ...valid, STAGING_DATABASE_CONFIRMATION: undefined },
    {
      ...valid,
      STAGING_DATABASE_URL: "postgresql://qa:not-printed@db.production.example/hhplms_staging",
      DATABASE_URL: "postgresql://qa:not-printed@db.production.example/hhplms_staging",
    },
    {
      ...valid,
      STAGING_DATABASE_URL: "postgresql://qa:not-printed@db.example/hhplms",
      DATABASE_URL: "postgresql://qa:not-printed@db.example/hhplms",
    },
  ];
  for (const environment of unsafeEnvironments) {
    await assert.rejects(openVerifiedStagingMigrationPool(environment, { createPool }));
  }
  assert.equal(connectionAttempts, 0);
});
