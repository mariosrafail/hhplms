const retiredProductSlug = ["edu", "forge"].join("");
const retiredProductName = ["Edu", "Forge"].join("");

export const FORBIDDEN_BRAND_PATTERN = new RegExp("edu[\\s_-]*forge|course[-_]forge", "i");
export const FORBIDDEN_VISIBLE_BRANDING_PATTERN = new RegExp(
  `${FORBIDDEN_BRAND_PATTERN.source}|Made by|Made with|Developed by|Created by`,
  "i",
);

export const BRANDING_COMPATIBILITY_EXCEPTIONS = Object.freeze([
  {
    token: `${retiredProductSlug}-dev-staging`,
    reason: "current Neon staging project display name",
    paths: ["docs/HHPLMS_OPERATING_CONTEXT.md"],
  },
  {
    token: `${retiredProductSlug}_staging`,
    reason: "current Neon staging database identifier",
    paths: ["docs/HHPLMS_OPERATING_CONTEXT.md"],
  },
  {
    token: `${retiredProductSlug}_migration_history`,
    reason: "deployed PostgreSQL migration-history table name",
    paths: [
      "docs/production-deployment-runbook.md",
      "docs/runtime-database-role.md",
      "netlify/functions/_runtime-schema-readiness.js",
      "netlify/functions/operational-health.js",
      "scripts/_local-multi-school.mjs",
      "scripts/_migration-transaction.mjs",
      "scripts/_production-demo-entitlement-inventory.mjs",
      "scripts/_production-preflight.mjs",
      "scripts/cleanup-staging-qa.mjs",
      "scripts/run-staging-migrations.mjs",
      "scripts/seed-local-pilot.mjs",
      "scripts/verify-tenant-integrity.mjs",
      "tests/_runtime-schema-test-helper.js",
      "tests/integration/_migration-test-helpers.mjs",
      "tests/integration/b1-migration-atomicity.test.js",
      "tests/integration/_students-book-preservation.mjs",
      "tests/integration/students-book-preservation.test.js",
      "tests/integration/builder-product-publication-persistence.test.js",
      "tests/integration/operations-readiness.test.js",
      "tests/integration/production-demo-entitlement-inventory.test.js",
      "tests/integration/production-deployment-gate.test.js",
      "tests/integration/runtime-schema-readiness.test.js",
      "tests/runtime-schema-readiness.test.js",
    ],
  },
  {
    token: `com.${retiredProductSlug}.offlinebooks`,
    reason: "existing Android application ID and Java namespace",
    paths: [
      "android/app/build.gradle",
      `android/app/src/main/java/com/${retiredProductSlug}/offlinebooks/MainActivity.java`,
      `android/app/src/main/java/com/${retiredProductSlug}/offlinebooks/PdfSaverPlugin.java`,
      "android/app/src/main/res/values/strings.xml",
      "capacitor.config.ts",
      "docs/book-builder/teacher-apk-projects.md",
      "docs/android-classroom-display-targets.md",
      "docs/android-teacher-offline.md",
      "docs/lms-units-1-2-functional-acceptance.md",
      "docs/release-candidate-staging-acceptance.md",
      "scripts/android-teacher/device-smoke.mjs",
      "scripts/android-teacher/verify-apk.mjs",
      "scripts/android/verify-student-apk.mjs",
      "lib/teacher-project-builder/android-contract.js",
      "tests/android-teacher-offline.test.js",
    ],
  },
  {
    token: `com/${retiredProductSlug}/offlinebooks`,
    reason: "filesystem path for the existing Android Java namespace",
    paths: ["tests/android-teacher-offline.test.js"],
  },
  {
    token: `${retiredProductSlug}:ordinary-auth`,
    reason: "stable ordinary-login rate-limit hash domain",
    paths: ["netlify/functions/_auth-login-rate-limit.js"],
  },
  {
    token: `${retiredProductSlug}:platform-admin-auth`,
    reason: "stable Platform Admin rate-limit hash domain",
    paths: ["netlify/functions/_platform-admin-login-rate-limit.js"],
  },
  {
    token: `${retiredProductSlug}:builder-auth`,
    reason: "stable Builder login rate-limit hash domain",
    paths: ["netlify-sites/ultimate-b2-builder/server/_builder-login-rate-limit.js"],
  },
  {
    token: `${retiredProductSlug}:multi-school-seed`,
    reason: "cross-version PostgreSQL advisory-lock domain",
    paths: ["scripts/cleanup-multi-school.mjs", "scripts/seed-multi-school.mjs"],
  },
  {
    token: `${retiredProductSlug}:staging:migrations`,
    reason: "cross-version PostgreSQL advisory-lock domain",
    paths: ["scripts/run-staging-migrations.mjs"],
  },
  {
    token: `${retiredProductSlug}:staging:qa-seed`,
    reason: "cross-version PostgreSQL advisory-lock domain",
    paths: ["scripts/cleanup-staging-qa.mjs", "scripts/seed-staging-qa.mjs"],
  },
  {
    token: `${retiredProductSlug}-fictional-multi-school-v1`,
    reason: "legacy persisted seed-ownership marker migrated by current tooling",
    paths: ["scripts/_multi-school-seed-data.mjs"],
  },
  {
    token: `${retiredProductSlug}-staging-qa-v1`,
    reason: "legacy persisted QA seed-ownership marker migrated by current tooling",
    paths: ["scripts/_staging-qa-data.mjs"],
  },
  {
    token: `${retiredProductName.toUpperCase()}_STAGING_QA_PASSWORD`,
    reason: "temporary server-side environment-variable compatibility alias",
    paths: ["scripts/_staging-qa-data.mjs", "tests/demo-credentials.test.js"],
  },
]);

const exceptionPathsByToken = BRANDING_COMPATIBILITY_EXCEPTIONS.map((entry) => ({
  ...entry,
  pathSet: new Set(entry.paths),
}));

export function isMaintainedTrackedPath(path) {
  return !path.startsWith("dist-sidebar-check/");
}

function removeApprovedTokens(path, value) {
  let remaining = value;
  for (const exception of exceptionPathsByToken) {
    if (!exception.pathSet.has(path)) continue;
    remaining = remaining.replaceAll(exception.token, (match, offset, source) => {
      const identifierCharacter = /[a-z0-9_-]/i;
      const preceding = source[offset - 1];
      const following = source[offset + match.length];
      return (!preceding || !identifierCharacter.test(preceding))
        && (!following || !identifierCharacter.test(following))
        ? ""
        : match;
    });
  }
  return remaining;
}

export function findBrandingViolations(entries) {
  const violations = [];
  for (const { path, content } of entries) {
    if (!isMaintainedTrackedPath(path)) continue;
    const normalizedPath = path.replaceAll("\\", "/");
    const allowedAndroidPath = `android/app/src/main/java/com/${retiredProductSlug}/offlinebooks/`;
    const pathForAudit = normalizedPath.startsWith(allowedAndroidPath)
      ? normalizedPath.replace(allowedAndroidPath, "android/app/src/main/java/compat-android-id/")
      : normalizedPath;
    if (FORBIDDEN_BRAND_PATTERN.test(pathForAudit)) {
      violations.push({ path: normalizedPath, line: 0, context: normalizedPath });
    }
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const remaining = removeApprovedTokens(normalizedPath, line);
      if (FORBIDDEN_BRAND_PATTERN.test(remaining)) {
        violations.push({ path: normalizedPath, line: index + 1, context: line.trim() });
      }
    }
  }
  return violations;
}
