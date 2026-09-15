import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureFlowBankDiagnostic } from '../scripts/book-builder/flow-bank-diagnostics.mjs';

test('held-assets capture returns JSON without screenshot; normal capture retains PNG after release', async t => {
  const output = await mkdtemp(join(tmpdir(), 'flow-bank-capture-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  let released = false;
  const screenshots = [];
  const page = {
    evaluate: async () => ({ fontStatus: released ? 'loaded' : 'loading' }),
    screenshot: async options => { assert.equal(released, true); screenshots.push(options.path); },
  };
  const before = await captureFlowBankDiagnostic(page, output, 'before-release', {
    screenshot: false, metadata: { barrierClosed: true, pendingSlots: ['late-font-0', 'late-background-0'] },
  });
  assert.equal(released, false);
  assert.deepEqual(screenshots, []);
  assert.equal(before.fontStatus, 'loading');
  assert.equal(before.capture.png, null);
  assert.deepEqual(JSON.parse(await readFile(join(output, 'before-release.json'), 'utf8')), before);
  released = true;
  const ready = await captureFlowBankDiagnostic(page, output, 'after-load-ready');
  assert.equal(ready.fontStatus, 'loaded');
  assert.deepEqual(screenshots, [`${output}/after-load-ready.png`]);
});
