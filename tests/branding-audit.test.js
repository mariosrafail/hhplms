import test from "node:test";
import assert from "node:assert/strict";
import {
  BRANDING_COMPATIBILITY_EXCEPTIONS,
  findBrandingViolations,
  isMaintainedTrackedPath,
} from "../scripts/_branding-audit.mjs";

const retiredName = ["Edu", "Forge"].join("");
const retiredSlug = retiredName.toLowerCase();

test("branding audit reports retired names with exact file and line context", () => {
  const violations = findBrandingViolations([{
    path: "src/example.js",
    content: `current\n${retiredName} visible label`,
  }]);
  assert.deepEqual(violations, [{
    path: "src/example.js",
    line: 2,
    context: `${retiredName} visible label`,
  }]);
});

test("branding audit permits only an enumerated compatibility token in its approved path", () => {
  const token = `${retiredSlug}_migration_history`;
  assert.deepEqual(findBrandingViolations([{
    path: "netlify/functions/_runtime-schema-readiness.js",
    content: `select * from ${token}`,
  }]), []);
  assert.equal(findBrandingViolations([{
    path: "src/example.js",
    content: `select * from ${token}`,
  }]).length, 1);
  for (const path of ["scripts/_migration-transaction.mjs", "tests/integration/_students-book-preservation.mjs", "tests/integration/students-book-preservation.test.js"]) {
    assert.deepEqual(findBrandingViolations([{ path, content: `select * from ${token}` }]), []);
    assert.equal(findBrandingViolations([{ path, content: `${retiredName} visible label` }]).length, 1);
    assert.equal(findBrandingViolations([{ path, content: `${token}_unapproved` }]).length, 1);
  }
});

test("branding audit preserves the existing login hash-domain exceptions", () => {
  for (const { token, path } of [
    { token: `${retiredSlug}:ordinary-auth`, path: "netlify/functions/_auth-login-rate-limit.js" },
    { token: `${retiredSlug}:platform-admin-auth`, path: "netlify/functions/_platform-admin-login-rate-limit.js" },
  ]) {
    assert.deepEqual(findBrandingViolations([{ path, content: token }]), []);
  }
});

test("branding audit permits only the stable Builder hash domain in its approved limiter", () => {
  const token = `${retiredSlug}:builder-auth`;
  assert.deepEqual(BRANDING_COMPATIBILITY_EXCEPTIONS.find((entry) => entry.token === token), {
    token,
    reason: "stable Builder login rate-limit hash domain",
    paths: ["netlify-sites/ultimate-b2-builder/server/_builder-login-rate-limit.js"],
  });
  assert.deepEqual(findBrandingViolations([{
    path: "netlify-sites/ultimate-b2-builder/server/_builder-login-rate-limit.js",
    content: `.update(\`${token}:email:v1\\0value\`)`,
  }]), []);
  assert.equal(findBrandingViolations([{
    path: "src/example.js",
    content: token,
  }]).length, 1);
  assert.equal(findBrandingViolations([{
    path: "netlify-sites/ultimate-b2-builder/server/_builder-login-rate-limit.js",
    content: `${token}-extra`,
  }]).length, 1);
});

test("branding audit permits the preserved Android application ID only in enumerated compatibility files", () => {
  const token = ["com", retiredSlug, "offlinebooks"].join(".");
  assert.deepEqual(findBrandingViolations([{
    path: "scripts/android/verify-student-apk.mjs",
    content: `assert.equal(applicationId, "${token}");`,
  }]), []);
  assert.equal(findBrandingViolations([{
    path: "scripts/android/example.mjs",
    content: `assert.equal(applicationId, "${token}");`,
  }]).length, 1);
  assert.deepEqual(findBrandingViolations([{
    path: `android/app/src/main/java/com/${retiredSlug}/offlinebooks/PdfSaverPlugin.java`,
    content: `package ${token};`,
  }]), []);
});

test("branding audit checks filenames and excludes only the tracked comparison build output", () => {
  assert.equal(findBrandingViolations([{
    path: `src/${retiredSlug}-widget.js`,
    content: "export default true;",
  }]).length, 1);
  assert.equal(isMaintainedTrackedPath("dist-sidebar-check/assets/index.js"), false);
  assert.equal(isMaintainedTrackedPath("src/dist-sidebar-check-example.js"), true);
});
