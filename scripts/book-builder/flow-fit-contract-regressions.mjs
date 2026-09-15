import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { captureFlowBankDiagnostic } from './flow-bank-diagnostics.mjs';
import { expectFlowBankReady } from './flow-bank-readiness.mjs';
import { expectTargetFitReady } from './target-fit-readiness.mjs';

export async function runFlowFitContractRegressions(page,output,productionCss) {
  const evidence=[];
  const geometry=selector=>page.locator(selector).evaluate(element=>{
    const bounds=element.getBoundingClientRect();
    const children=[...element.children].map(child=>{
      const box=child.getBoundingClientRect();const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      return {fontSize:parseFloat(getComputedStyle(child).fontSize),contained:box.left>=bounds.left-1 && box.right<=bounds.right+1 && box.top>=bounds.top-1 && box.bottom<=bounds.bottom+1,hit:child===hit||child.contains(hit)};
    });
    const bank=element.closest('.native-drag-drop-bank');const css=bank&&getComputedStyle(bank);
    return {scale:Number(element.dataset.fitScale),status:element.dataset.fitStatus,scrollFits:element.scrollWidth<=element.clientWidth && element.scrollHeight<=element.clientHeight,
      bank:bank?{width:bank.clientWidth,height:bank.offsetHeight,itemsWidth:element.clientWidth,itemsHeight:element.clientHeight,padding:[css.paddingTop,css.paddingRight,css.paddingBottom,css.paddingLeft],transitionProperty:css.transitionProperty,transitionDuration:css.transitionDuration,activeTransitions:bank.getAnimations().filter(a=>a.constructor.name==='CSSTransition').length}:null,
      children,transitions:[element,...element.querySelectorAll('*')].map(node=>({property:getComputedStyle(node).transitionProperty,duration:getComputedStyle(node).transitionDuration,active:node.getAnimations().filter(a=>a.constructor.name==='CSSTransition').length}))};
  });
  try {
    for(const motion of ['reduce','no-preference']) {
      await page.emulateMedia({reducedMotion:motion});
      await page.reload(); await page.waitForFunction(()=>Boolean(globalThis.corrections));
      const style=await page.addStyleTag({content:productionCss.content});await style.evaluate(node=>node.dataset.flowProductionCss='lms-entrypoint');
      await page.evaluate(()=>corrections.configure({kind:'flow-bank',path:'student',height:650,scale:1}));
      const instance=`fit-contract-${motion}`;
      await page.getByRole('button',{name:'next-panel',exact:true}).click();
      await page.locator('.native-multi-part-panel--flow .native-drag-drop').evaluate((node,id)=>{node.__flowBankInstance=id;},instance);
      const bankBaseline=await expectFlowBankReady(page,{output,checkpoint:`${motion}-initial-full`,count:12,instance});
      for(const kind of ['bank','target']) {
        if(kind==='target') {
          await page.evaluate(()=>{
            const pair=structuredClone(corrections.pair);const section=pair.publicDocument.parts[0].interaction.sections.find(s=>s.kind==='drag-drop');
            section.interaction.panels[0].dropTargets[0].area={x:70,y:80,width:120,height:40};
            corrections.setPair(pair);corrections.setResponses({[section.id]:{[section.interaction.panels[0].dropTargets[0].id]:section.interaction.words.map(w=>w.id)}});
          });
        }
        const selector=`.native-multi-part-panel--flow .native-drag-drop-${kind==='bank'?'bank':'target'}-items`;
        const targetId=kind==='target'?await page.locator(selector).evaluate(node=>node.closest('[data-drag-drop-target-id]').dataset.dragDropTargetId):null;
        await expect(page.locator(selector).locator(':scope > *')).toHaveCount(12);
        const repeated=[];
        for(let repeat=0;repeat<3;repeat++) {
          await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
          let result;
          if(kind==='bank') {
            const snapshot=await expectFlowBankReady(page,{output,checkpoint:`${motion}-bank-repeat-${repeat}`,count:12,instance,baseline:bankBaseline,order:bankBaseline.children.map(c=>c.id),responses:bankBaseline.responses});
            result={...snapshot,scale:Number(snapshot.activeScale)};
          } else {const snapshot=await expectTargetFitReady(page,{output,checkpoint:`${motion}-target-repeat-${repeat}`,targetId,count:12});result={...snapshot,scale:Number(snapshot.activeScale),scrollFits:snapshot.items.scrollWidth<=snapshot.items.clientWidth&&snapshot.items.scrollHeight<=snapshot.items.clientHeight};}
          repeated.push(result);
          assert.equal(result.status,'fit',`${motion}/${kind} status`);assert.ok(result.scrollFits,`${motion}/${kind} scroll bounds`);
          assert.ok(result.children.every(child=>child.contained && child.hit && child.fontSize>=7.99),JSON.stringify({motion,kind,result}));
          assert.ok(result.transitions.every(t=>t.property==='none' && t.active===0),'fitting subtree must not transition geometry');
        }
        assert.ok(Math.max(...repeated.map(r=>r.scale))-Math.min(...repeated.map(r=>r.scale))<.001,'unchanged content must not oscillate between scales');
        evidence.push({motion,kind,repeated,css:{mode:productionCss.mode,assets:productionCss.assets}});
        if(kind==='bank') {
          for(const hidden of [false,true]) {
            const fill=filled=>page.evaluate(filled=>{
              const section=corrections.pair.publicDocument.parts[0].interaction.sections.find(s=>s.kind==='drag-drop');
              const next={[section.id]:filled?{[section.interaction.panels[0].dropTargets[0].id]:section.interaction.words.map(w=>w.id)}:{}};
              corrections.setResponses(next);return next;
            },filled);
            const emptyResponses=await fill(true);
            const empty=await expectFlowBankReady(page,{output,checkpoint:`${motion}-${hidden?'hidden':'visible'}-empty`,count:0,instance,responses:emptyResponses});
            if(hidden) {await page.getByRole('button',{name:'previous-panel',exact:true}).click();await expect(page.locator('.native-multi-part-panel--flow')).toBeHidden();}
            const fullResponses=await fill(false);
            if(hidden) await page.getByRole('button',{name:'next-panel',exact:true}).click();
            const full=await expectFlowBankReady(page,{output,checkpoint:`${motion}-${hidden?'hidden':'visible'}-refill`,count:12,instance,baseline:bankBaseline,order:bankBaseline.children.map(c=>c.id),responses:fullResponses});
            evidence.push({motion,kind:'bank-empty-refill',hidden,empty,full});
            await writeFile(`${output}/fit-contract.json`,JSON.stringify(evidence,null,2));
          }
        }
      }
    }
  } catch(error) {
    await captureFlowBankDiagnostic(page,output,'failure-fit-contract');throw error;
  } finally {await writeFile(`${output}/fit-contract.json`,JSON.stringify(evidence,null,2));}
}
