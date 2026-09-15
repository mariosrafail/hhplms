import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {expectTargetFitReady} from './target-fit-readiness.mjs';
import {beginFlowReturnTrace} from './flow-return-trace.mjs';

export async function physicalFlowReturn(page,from,bank,{output,checkpoint}) {
  let trace;
  await beginFlowReturnTrace(page,from);
  const initial=await page.evaluate(()=>globalThis.flowReturnTrace);
  const first=initial.events[0],wordId=initial.wordId,targetId=initial.sourceTargetId;
  try {
    assert.ok(wordId&&targetId,'canonical source and target identities');
    const placedIds=first.targetFit.placedIds;
    assert.ok(placedIds.every(Boolean));assert.equal(placedIds.filter(id=>id===wordId).length,1);
    await expectTargetFitReady(page,{output,checkpoint:`${checkpoint}-return-source`,targetId,count:placedIds.length});
    const target=page.locator(`.native-multi-part-panel--flow [data-drag-drop-target-id="${targetId}"]`);
    const source=target.getByRole('button',{name:first.event?.target?.label||first.targetFit.children.find(c=>c.wordId===wordId).label,exact:true});
    await expect(source).toHaveCount(1);await expect(source).toBeEnabled();
    const a=await source.boundingBox(),b=await bank.boundingBox();assert.ok(a&&a.width>0&&a.height>0&&b&&b.width>0&&b.height>0);
    const start={x:a.x+a.width/2,y:a.y+a.height/2},end={x:b.x+b.width/2,y:b.y+b.height/2};
    await page.evaluate(planned=>globalThis.recordFlowReturnTrace('ready-before-down',planned),{start,end,sourceBox:a,bankBox:b});
    assert.equal(await source.evaluate((node,p)=>node.contains(document.elementFromPoint(p.x,p.y)),start),true,'source center hit');
    await page.mouse.move(start.x,start.y);
    assert.equal(await source.evaluate((node,p)=>node.contains(document.elementFromPoint(p.x,p.y)),start),true,'source still hit before down');
    await page.mouse.down();
    // One of the same ten linear move steps already exceeds the product's 5px threshold.
    const intermediate={x:start.x+(end.x-start.x)/10,y:start.y+(end.y-start.y)/10};
    assert.ok(Math.hypot(intermediate.x-start.x,intermediate.y-start.y)>5,'first step exceeds actual movement threshold');
    await page.mouse.move(intermediate.x,intermediate.y);
    const preview=page.locator('[data-drag-drop-drag-preview]');
    await expect(preview).toHaveCount(1);await expect(preview).toHaveAttribute('aria-label',first.targetFit.children.find(c=>c.wordId===wordId).label.replace(/^Remove /,'').split(' from ')[0]);
    await expect(preview).not.toHaveAttribute('data-returning','true');
    await page.mouse.move(end.x,end.y,{steps:9});
    assert.equal(await bank.evaluate((node,p)=>node.contains(document.elementFromPoint(p.x,p.y)),end),true,'actual drop point belongs to bank');
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
    await expect(bank.locator(`[data-drag-drop-word-id="${wordId}"]`)).toHaveCount(1);
    await expect(target.locator('button[data-drag-drop-target-text]')).toHaveCount(placedIds.length-1);
    trace=await page.evaluate(()=>globalThis.finishFlowReturnTrace());
    const last=trace.events.at(-1);
    assert.deepEqual(last.targetFit.placedIds,placedIds.filter(id=>id!==wordId),'only returned canonical placement removed');
    assert.equal(last.bankOrder.filter(id=>id===wordId).length,1);
    assert.deepEqual(last.bankOrder.filter(id=>id!==wordId),first.bankOrder,'other bank IDs/order preserved');
    assert.equal(last.sourceConnected,false);assert.deepEqual(last.captures,[]);assert.equal(last.preview,null);
  } catch(error) {
    try {trace ||= await page.evaluate(()=>globalThis.finishFlowReturnTrace());await writeFile(`${output}/${checkpoint}-return-failure-${randomUUID()}.json`,JSON.stringify({error:{message:error.message,stack:error.stack},trace},null,2));}
    catch(diagnosticError){console.error('Secondary return trace capture error:',diagnosticError);}
    throw error;
  }
}
