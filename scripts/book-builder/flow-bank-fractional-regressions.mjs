import assert from 'node:assert/strict';
import { expectFlowBankReady } from './flow-bank-readiness.mjs';

// Exercise final bank shrinkage at fractional row/padding boundaries, including
// an ancestor transform. Authored geometry and typography stay unchanged.
export async function runFlowBankFractionalRegressions(page, output, productionCss) {
  for (const motion of ['reduce', 'no-preference']) for (const scale of [1, .65]) {
    await page.emulateMedia({ reducedMotion: motion });
    await page.reload();
    await page.waitForFunction(() => Boolean(globalThis.corrections));
    await page.addStyleTag({ content: productionCss.content });
    await page.evaluate(scale => corrections.configure({ kind: 'flow-bank', path: 'student', height: 650, scale }), scale);
    const original = await page.evaluate(() => JSON.stringify(corrections.pair));
    await page.getByRole('button', { name: 'next-panel', exact: true }).click();
    const root = page.locator('.native-multi-part-panel--flow .native-drag-drop');
    const instance = `fractional-${motion}-${scale}`;
    await root.evaluate((node, id) => { node.__flowBankInstance = id; }, instance);
    for (const width of [1011, 1003, 1024]) {
      await root.evaluate((node, width) => { node.style.width = `${width}px`; }, width);
      for (const placed of [false, true, false]) {
        const responses = await page.evaluate(placed => {
          const section = corrections.pair.publicDocument.parts[0].interaction.sections.find(s => s.kind === 'drag-drop');
          const responses = { [section.id]: placed ? { [section.interaction.panels[0].dropTargets[0].id]: [section.interaction.words[0].id] } : {} };
          corrections.setResponses(responses);
          return responses;
        }, placed);
        await expectFlowBankReady(page, {
          output, checkpoint: `${instance}-${width}-${placed ? 'partial' : 'full'}`,
          count: placed ? 11 : 12, instance, responses,
        });
        assert.equal(await page.evaluate(() => JSON.stringify(corrections.pair)), original);
      }
    }
  }
}
