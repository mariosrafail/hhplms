import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

assert.equal(process.env.TEST_DATABASE_CONFIRMATION, "isolated-test-database", "Browser acceptance requires an explicitly isolated test database.");
assert.ok(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is required; browser acceptance must not be skipped.");
assert.notEqual(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL, "Use a separate test database.");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.TEST_DATABASE_URL).hostname), "This acceptance fixture only supports a local isolated PostgreSQL server.");
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "tests/integration/published-native-assignment-persistence.test.js", "tests/integration/students-book-unification-flow.test.js"], {
  stdio: "inherit", env: { ...process.env, PUBLISHED_BOOK_BROWSER: "1" },
});
if (result.error) throw result.error;
process.exitCode = result.status || (result.signal ? 1 : 0);
