import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.TEST_DATABASE_CONFIRMATION, 'isolated-test-database');
assert.ok(process.env.TEST_DATABASE_URL);
assert.notEqual(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname));
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/integration/b1-managed-publication.test.js'], { stdio: 'inherit', env: { ...process.env, B1_PUBLICATION_BROWSER: '1' } });
if (result.error) throw result.error;
process.exitCode = result.status || (result.signal ? 1 : 0);
