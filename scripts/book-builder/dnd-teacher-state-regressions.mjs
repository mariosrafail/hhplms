import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';
import { createServer } from '../../tests/_vite-test-server.mjs';
import { dndTeacherStateObserver } from './dnd-teacher-state-observer.mjs';
import { dndId } from '../../tests/fixtures/native-runtime-regressions/drag-drop-improvements-data.js';

export async function runDndTeacherStateRegressions(browser, output) {
  await mkdir(output, { recursive: true });
  const provider = { name: 'teacher-state-fixture-provider', enforce: 'pre',
    resolveId: id => ['virtual:component-publication', 'virtual:hosted-native-drafts'].includes(id) ? `\0${id}` : null,
    load: id => id === '\0virtual:hosted-native-drafts' ? 'export const hostedNativeDraftAssetUrl=()=>""; export const hostedNativeDraftTeacherAssetUrl=()=>"";' : id === '\0virtual:component-publication' ? 'export const publishedNativeAssetUrl=()=>""; export const publishedNativeTeacherAssetUrl=()=>""; export const loadPublishedNativeTeacherDocument=async()=>null;' : null };
  const server = await createServer({ configFile: false, plugins: [provider, dndTeacherStateObserver(), react()], optimizeDeps: { entries: ['tests/fixtures/native-runtime-regressions/runtime-corrections.html'] }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const evidence = [], errors = []; let checkpoint = 'startup';
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { globalThis.dndTeacherProbe = { reports: [] }; });
  const png = await sharp({ create: { width: 1024, height: 1100, channels: 3, background: '#d6eafa' } }).png().toBuffer();
  await page.route('**/correction-assets/*', route => route.fulfill({ contentType: 'image/png', body: png }));
  const targetId = dndId('target', 1), word = n => dndId('word', n);
  try {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/runtime-corrections.html`);
    await page.waitForFunction(() => Boolean(globalThis.corrections));
    for (const kind of ['standalone', 'multi-part']) {
      checkpoint = `${kind}-setup`;
      await page.evaluate(kind => corrections.configure({ kind: kind === 'multi-part' ? 'flow-bank' : 'adaptive', path: 'teacher', height: 650 }), kind);
      if (kind === 'standalone') await page.evaluate(() => {
        const pair = structuredClone(corrections.pair), interaction = pair.publicDocument.parts[0].interaction;
        interaction.panels.push({ ...structuredClone(interaction.panels[0]), id: 'panel-' + '9'.repeat(32), dropTargets: [] });
        corrections.setPair(pair);
      });
      const before = await page.evaluate(() => JSON.stringify(corrections.pair));
      const root = page.locator('.native-drag-drop-teacher');
      await expect(root).toHaveCount(1);
      const handle = await root.elementHandle();
      const target = root.locator(`[data-drag-drop-target-id="${targetId}"]`);
      const placed = target.locator('button[data-drag-drop-target-text]');
      const check = async (phase, ids, pristine, revealed = 0, panelIndex = 0, aggregateRevealed = revealed) => {
        checkpoint = `${kind}-${phase}`;
        const expected = { controlled: true, responses: ids.length ? { [targetId]: ids } : {}, child: { panelIndex, pristine, revealed }, aggregate: { pristine, revealed: aggregateRevealed } };
        await expect.poll(() => page.evaluate(() => {
          const p = dndTeacherProbe, a = corrections.state;
          return { controlled: p.controlled, responses: p.responses, child: { panelIndex: p.child?.panelIndex, pristine: p.child?.reveal.pristine, revealed: p.child?.reveal.revealed }, aggregate: { pristine: a?.reveal.pristine, revealed: a?.reveal.revealed } };
        }), { timeout: 5000, message: checkpoint }).toEqual(expected);
        assert.equal(await handle.evaluate(node => node.isConnected), true, 'child stays mounted');
        assert.equal(await page.evaluate(() => JSON.stringify(corrections.pair)), before, 'runtime responses never serialize into either document');
        evidence.push({ checkpoint, ...expected });
        await writeFile(`${output}/dnd-teacher-state.json`, JSON.stringify(evidence, null, 2));
      };
      const place = async n => { await root.locator(`[data-drag-drop-word-id="${word(n)}"]`).click(); await target.click({ position: { x: 10, y: 10 } }); };
      const command = type => page.getByRole('button', { name: type, exact: true }).click();
      await check('initial', [], true);
      if (kind === 'multi-part') await command('next-panel');
      await place(1); await check('manual-placement', [word(1)], false);
      for (const n of [2, 3, 4]) await place(n);
      await check('more-placements', [1, 2, 3, 4].map(word), false);
      await placed.first().focus(); await page.keyboard.press('Delete');
      await check('keyboard-partial-return', [2, 3, 4].map(word), false);
      await placed.first().click(); await check('click-partial-return', [3, 4].map(word), false);
      checkpoint = `${kind}-pointer-source-readiness`;
      await expect.poll(() => placed.first().evaluate(async node => {
        for (let n = 0; n < 2; n++) await new Promise(resolve => requestAnimationFrame(resolve));
        const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return node.closest('.native-drag-drop-target-items').dataset.fitStatus === 'fit' && (node === hit || node.contains(hit));
      }), { timeout: 5000 }).toBe(true);
      const source = await placed.first().boundingBox(), bank = await root.locator('.native-drag-drop-bank').boundingBox();
      assert.ok(source && bank);
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2 + 8);
      await expect(page.locator('[data-drag-drop-drag-preview]')).toHaveCount(1);
      await page.mouse.move(bank.x + bank.width / 2, bank.y + bank.height / 2, { steps: 10 }); await page.mouse.up();
      await check('pointer-partial-return', [word(4)], false);
      if (kind === 'standalone') { await command('next-panel'); await check('next-preserved', [word(4)], false, 0, 1); await command('previous-panel'); }
      else {
        await command('previous-panel');
        await expect(page.locator('.native-single-choice-teacher button[aria-pressed="true"]')).toHaveCount(0);
        await check('other-section-clean', [word(4)], false); await command('next-panel');
      }
      await check('navigation-preserved', [word(4)], false);
      await placed.click(); await check('all-returned', [], true);
      if (kind === 'standalone') { await command('next-panel'); await check('clean-noninitial-panel', [], false, 0, 1); await command('previous-panel'); await check('clean-initial-panel', [], true); }
      await target.click({ position: { x: 10, y: 10 } }); await check('reveal-only', [], false, 1);
      await command('reset-activity'); await check('reveal-reset', [], true);
      if (kind === 'multi-part') await command('next-panel');
      await place(1); await command('show-all'); await check('manual-plus-reveal', [word(1)], false, 1, 0, kind === 'multi-part' ? 2 : 1);
      if (kind === 'standalone') { await command('next-panel'); await check('dirty-noninitial-panel', [word(1)], false, 1, 1); }
      const reportStart = await page.evaluate(() => dndTeacherProbe.reports.length);
      await command('reset-activity'); await check('reset-all', [], true);
      const resetReports = await page.evaluate(start => dndTeacherProbe.reports.slice(start), reportStart);
      assert.ok(resetReports.length > 0);
      assert.ok(resetReports.every(({ state, responses }) => state.panelIndex === 0 && state.reveal.pristine && state.reveal.revealed === 0 && Object.keys(responses).length === 0), 'owner reset reports no stale responses');
      await command('reset-activity'); await check('repeat-reset-idempotent', [], true);
      await expect(root.locator('[aria-pressed="true"]')).toHaveCount(0);
      await expect(page.locator('[data-drag-drop-drag-preview]')).toHaveCount(0);
      await page.screenshot({ path: `${output}/dnd-teacher-state-${kind}.png` });
      await handle.dispose();
    }
    assert.deepEqual(errors, []);
    console.log(`DnD Teacher state: ${evidence.length} component checkpoints passed.`);
  } catch (error) {
    await writeFile(`${output}/dnd-teacher-state-failure.json`, JSON.stringify({ checkpoint, error: error.stack, errors, evidence, snapshot: await page.evaluate(() => ({ probe: globalThis.dndTeacherProbe, state: globalThis.corrections?.state })) }, null, 2));
    await page.screenshot({ path: `${output}/dnd-teacher-state-failure.png` }).catch(() => {});
    throw error;
  } finally { await page.close(); await server.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ headless: true });
  try { await runDndTeacherStateRegressions(browser, process.env.NATIVE_REGRESSION_OUTPUT || 'test-results/native-runtime-regressions'); } finally { await browser.close(); }
}
