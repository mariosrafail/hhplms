import { databaseFingerprint } from "./_database-identity.mjs";
import { createSafePool, loadProductionMigrationManifest, requireSafeDatabase } from "./_staging-db.mjs";
import { migrationManifestSummary } from "./_migration-readiness.mjs";
import { requireQaPassword } from "./_staging-qa-data.mjs";

const requiredNames = [
  "STAGING_DATABASE_URL", "STAGING_DATABASE_CONFIRMATION", "STAGING_ENVIRONMENT_CONFIRMATION",
  "DATABASE_URL", "APP_PUBLIC_URL", "STAGING_PRODUCTION_APP_URL", "STAGING_PRODUCTION_DATABASE_FINGERPRINTS",
  "STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION",
  "AUTH_RATE_LIMIT_SALT", "PLATFORM_ADMIN_RATE_LIMIT_SALT", "ACCOUNT_RATE_LIMIT_SALT", "INVITE_RATE_LIMIT_SALT", "ACCOUNT_EMAIL_DISPATCH_SECRET",
  "OPERATIONAL_MONITORING_SECRET", "ACCOUNT_EMAIL_MODE",
];
const placeholderPattern = /(replace|placeholder|example\.invalid|changeme|change-me|your[_-]|dummy|secret123)/i;
const commonMailboxDomains = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);
const explicitKnownHostedStagingOrigins = new Set(["https://lms.hhplms.workers.dev"]);

function required(environment, names = requiredNames) {
  const missing = names.filter((name) => !String(environment[name] || "").trim());
  if (missing.length) throw new Error(`Missing required staging variables: ${missing.join(", ")}`);
}

function parsedUrl(value, name, protocols) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} uses an unsupported protocol`);
  return url;
}

export function parseStagingProductionDatabaseFingerprints(value) {
  const source = String(value ?? "");
  if (!source.trim()) throw new Error("STAGING_PRODUCTION_DATABASE_FINGERPRINTS must contain at least one fingerprint");
  const fingerprints = source.split(",").map((entry) => entry.trim().toLowerCase());
  if (fingerprints.some((entry) => !entry)) {
    throw new Error("STAGING_PRODUCTION_DATABASE_FINGERPRINTS must not contain empty entries");
  }
  if (fingerprints.some((entry) => !/^[a-f0-9]{64}$/.test(entry))) {
    throw new Error("STAGING_PRODUCTION_DATABASE_FINGERPRINTS entries must be SHA-256 fingerprints");
  }
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new Error("STAGING_PRODUCTION_DATABASE_FINGERPRINTS must not contain duplicate fingerprints");
  }
  return Object.freeze([...fingerprints].sort());
}

export function validateDedicatedStagingRecipient(value, confirmation) {
  if (confirmation !== "dedicated-nonproduction-inbox") throw new Error("STAGING_EMAIL_CONFIRMATION must confirm a dedicated non-production inbox");
  const recipient = String(value || "").trim().toLowerCase();
  const match = recipient.match(/^[^\s@]+@([^\s@]+)$/);
  if (!match) throw new Error("STAGING_EMAIL_RECIPIENT must be a valid email address");
  if (commonMailboxDomains.has(match[1])) throw new Error("STAGING_EMAIL_RECIPIENT must not use a personal mailbox provider");
  if (!/(staging|stage|qa|test|sandbox|mailtrap|mailhog|ethereal)/.test(recipient)) throw new Error("STAGING_EMAIL_RECIPIENT must visibly identify a non-production inbox");
  return recipient;
}

export async function checkStagingDeployment(environment = process.env) {
  required(environment);
  requireQaPassword(environment);
  if (environment.STAGING_ENVIRONMENT_CONFIRMATION !== "hosted-nonproduction-staging") throw new Error("Hosted staging confirmation is invalid");
  if (environment.STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION !== "complete-production-database-identity-set") {
    throw new Error("STAGING_PRODUCTION_DATABASE_FINGERPRINTS_CONFIRMATION must confirm the complete production database identity set");
  }
  const productionDatabaseFingerprints = parseStagingProductionDatabaseFingerprints(environment.STAGING_PRODUCTION_DATABASE_FINGERPRINTS);
  requireSafeDatabase("staging", { ...environment, DATABASE_URL: "" });
  if (databaseFingerprint(environment.DATABASE_URL) !== databaseFingerprint(environment.STAGING_DATABASE_URL)) {
    throw new Error("Hosted staging DATABASE_URL must identify the verified staging database");
  }
  if (productionDatabaseFingerprints.includes(databaseFingerprint(environment.STAGING_DATABASE_URL))) {
    throw new Error("Staging database matches a known production database fingerprint");
  }
  const app = parsedUrl(environment.APP_PUBLIC_URL, "APP_PUBLIC_URL", ["https:"]);
  const productionApp = parsedUrl(environment.STAGING_PRODUCTION_APP_URL, "STAGING_PRODUCTION_APP_URL", ["https:"]);
  if (app.origin === productionApp.origin) throw new Error("Hosted staging and production application URLs must differ");
  const isVisiblyStagingHostname = /(staging|stage|qa|sandbox|preview|test)/i.test(app.hostname);
  if (!isVisiblyStagingHostname && !explicitKnownHostedStagingOrigins.has(app.origin)) {
    throw new Error("APP_PUBLIC_URL hostname must visibly identify staging or match the known hosted staging origin");
  }
  for (const name of ["AUTH_RATE_LIMIT_SALT", "PLATFORM_ADMIN_RATE_LIMIT_SALT", "ACCOUNT_RATE_LIMIT_SALT", "INVITE_RATE_LIMIT_SALT", "ACCOUNT_EMAIL_DISPATCH_SECRET", "OPERATIONAL_MONITORING_SECRET"]) {
    const value = String(environment[name]);
    if (value.length < 32 || placeholderPattern.test(value)) throw new Error(`${name} must be a non-placeholder secret of at least 32 characters`);
  }
  if (new Set([environment.AUTH_RATE_LIMIT_SALT, environment.PLATFORM_ADMIN_RATE_LIMIT_SALT, environment.ACCOUNT_RATE_LIMIT_SALT, environment.INVITE_RATE_LIMIT_SALT]).size !== 4) {
    throw new Error("Ordinary login, Platform Admin, account lifecycle, and invite salts must differ");
  }
  if (!['preview', 'smtp'].includes(environment.ACCOUNT_EMAIL_MODE)) throw new Error("Hosted staging email mode must be preview or smtp");
  if (environment.ACCOUNT_EMAIL_MODE === "smtp") {
    required(environment, ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "STAGING_EMAIL_RECIPIENT", "STAGING_EMAIL_CONFIRMATION"]);
    validateDedicatedStagingRecipient(environment.STAGING_EMAIL_RECIPIENT, environment.STAGING_EMAIL_CONFIRMATION);
    if (placeholderPattern.test(environment.SMTP_PASS)) throw new Error("SMTP_PASS must not be a placeholder");
  }
  const migrations = await loadProductionMigrationManifest();
  if (migrations.some((item) => item.filename === "012_demo_login_passwords.sql")) throw new Error("Demo-password migration is forbidden");
  const manifest = migrationManifestSummary(migrations);
  return {
    environment: "hosted-staging",
    app_host: app.hostname,
    email_mode: environment.ACCOUNT_EMAIL_MODE,
    production_database_fingerprint_count: productionDatabaseFingerprints.length,
    migration_count: manifest.migrationCount,
    latest_migration: manifest.latestMigration,
    manifest_fingerprint: manifest.manifestFingerprint,
  };
}

export async function openVerifiedStagingMigrationPool(environment = process.env, {
  createPool = (targetEnvironment) => createSafePool("staging", targetEnvironment),
} = {}) {
  // Freeze and validate the complete hosted contract before projecting the
  // confirmed target into the lower-level guard that normally rejects runtime overlap.
  const verifiedEnvironment = { ...environment };
  const preflight = await checkStagingDeployment(verifiedEnvironment);
  const opened = createPool({
    STAGING_DATABASE_URL: verifiedEnvironment.STAGING_DATABASE_URL,
    STAGING_DATABASE_CONFIRMATION: verifiedEnvironment.STAGING_DATABASE_CONFIRMATION,
  });
  return {
    preflight,
    pool: opened.pool,
    safeLabel: opened.safeLabel,
    kind: opened.kind,
  };
}
