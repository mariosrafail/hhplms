import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";

// Reuse the YAML parser bundled with the existing locked Playwright dependency.
const { yaml } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle");
const databaseEnvironment = {
  TEST_DATABASE_URL: "postgresql://hhplms_test:hhplms_test@localhost:5432/hhplms_test",
  TEST_DATABASE_CONFIRMATION: "isolated-test-database",
  AUTH_RATE_LIMIT_SALT: "isolated-ci-ordinary-auth-rate-limit-only",
  PLATFORM_ADMIN_RATE_LIMIT_SALT: "isolated-ci-platform-admin-rate-limit-only",
};

function assertOfflineJobIsolation(workflow, scripts) {
  const job = workflow.jobs["offline-edition-debug-builds"];
  assert.equal(job.if, undefined);
  assert.equal(job["continue-on-error"], undefined);
  const acceptance = job.steps.filter((step) => step.run === "npm run test:offline-editions");
  assert.equal(acceptance.length, 1);
  assert.equal(acceptance[0].if, undefined);
  assert.equal(acceptance[0]["continue-on-error"], undefined);
  assert.deepEqual(acceptance[0].env, databaseEnvironment);
  for (const scope of [workflow.env || {}, job.env || {}]) {
    for (const key of Object.keys(databaseEnvironment)) assert.equal(Object.hasOwn(scope, key), false, `${key} must be step-scoped`);
  }
  for (const step of job.steps) {
    const effective = { ...workflow.env, ...job.env, ...step.env };
    for (const key of Object.keys(databaseEnvironment)) {
      assert.equal(Object.hasOwn(effective, key), step === acceptance[0], `${key}: ${step.run || step.uses}`);
    }
  }
  // A persistent export would leak across steps even with structurally correct env.
  for (const current of Object.values(workflow.jobs)) {
    for (const step of current.steps) assert.doesNotMatch(step.run || "", /GITHUB_ENV|::set-env\b/);
  }
  assert.equal(job.services.postgres.image, "postgres:16");
  assert.deepEqual(job.services.postgres.env, { POSTGRES_USER: "hhplms_test", POSTGRES_PASSWORD: "hhplms_test", POSTGRES_DB: "hhplms_test" });
  assert.deepEqual(job.services.postgres.ports, ["5432:5432"]);
  assert.match(job.services.postgres.options, /pg_isready -U hhplms_test -d hhplms_test/);
  const commands = job.steps.filter((step) => step.run).map((step) => step.run);
  assert.deepEqual(commands.slice(commands.indexOf("npm ci")), [
    "npm ci", "npm run verify:migration-manifest", "npm run audit:runtime-schema-boundary", "npm test",
    "npm run build:netlify:ultimate-b2-builder", "npx playwright install --with-deps chromium", "npm run test:offline-editions",
  ]);
  assert.equal(scripts["test:offline-editions"], "cross-env OFFLINE_EDITION_ACCEPTANCE=1 node --test tests/integration/content-editions-persistence.test.js");
  assert.equal(scripts["test:integration"], "node --test --test-concurrency=1 tests/integration/*.test.js");
  const integration = workflow.jobs["integration-database"].steps.filter((step) => step.run === "npm run test:integration");
  assert.equal(integration.length, 1);
  assert.equal(integration[0].if, undefined);
  assert.equal(integration[0]["continue-on-error"], undefined);
  for (const name of ["deploy-cloudflare-builder", "deploy-cloudflare-lms"]) {
    assert(workflow.jobs[name].needs.includes("offline-edition-debug-builds"));
    assert.equal(workflow.jobs[name].if, "github.event_name == 'push' && github.ref == 'refs/heads/dev'");
  }
}

test("offline CI isolates the general prefix while requiring real PostgreSQL acceptance", async () => {
  const source = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const workflow = yaml.parse(source);
  assertOfflineJobIsolation(workflow, scripts);
  const original = yaml.parse(source);
  const job = original.jobs["offline-edition-debug-builds"];
  const acceptance = job.steps.find((step) => step.run === "npm run test:offline-editions");
  job.env = acceptance.env;
  delete acceptance.env;
  assert.throws(() => assertOfflineJobIsolation(original, scripts), { name: "AssertionError" });
  const globalLeak = yaml.parse(source);
  globalLeak.env = { TEST_DATABASE_CONFIRMATION: databaseEnvironment.TEST_DATABASE_CONFIRMATION };
  assert.throws(() => assertOfflineJobIsolation(globalLeak, scripts), /must be step-scoped/);
  const persistentLeak = yaml.parse(source);
  persistentLeak.jobs["offline-edition-debug-builds"].steps.unshift({ run: 'echo "TEST_DATABASE_CONFIRMATION=isolated-test-database" >> "$GITHUB_ENV"' });
  assert.throws(() => assertOfflineJobIsolation(persistentLeak, scripts), { name: "AssertionError" });
});

test("CI gates atomic product publication after both required review builds", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["test:builder:publication"], "npm run test:builder:product-publication");
  assert.match(workflow, /build:netlify:ultimate-b2-builder[\s\S]*verify:netlify:ultimate-b2-builder[\s\S]*test:builder:hosted-native-activity[\s\S]*build:netlify:ultimate-b2-interactive[\s\S]*verify:netlify:ultimate-b2-interactive[\s\S]*test:builder:product-publication/);
});
