import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { nativeActivityFontFamilyAlias } from '../../src/data/native-activities/nativeActivityFont.js';
import { expect } from "@playwright/test";
import { flowBankGeometry } from "./flow-bank-regressions.mjs";
import { captureFlowBankDiagnostic } from "./flow-bank-diagnostics.mjs";
import { expectFlowBankReady } from './flow-bank-readiness.mjs';
import { beginFlowReturnTrace, saveFlowReturnTrace } from './flow-return-trace.mjs';
import { expectedFlowTarget } from './flow-bank-box-geometry.mjs';
import { physicalFlowReturn } from './flow-physical-return.mjs';
import { flowNavigationReadinessIssues } from './flow-navigation-readiness.mjs';

export async function runFlowBankLifecycle(page, output, productionCss, fitDiagnostic = null) {
  const returnDiagnosticCase=process.env.FLOW_RETURN_DIAGNOSTIC_CASE;
  const returnDiagnostic=returnDiagnosticCase!==undefined||process.env.FLOW_RETURN_DIAGNOSTIC==='1';
  const selectedDiagnosticCase=returnDiagnosticCase!==undefined?Number(returnDiagnosticCase):8;
  const requiredCase=process.env.FLOW_LIFECYCLE_CASE;
  const evidence = [];
  const checkpoints=[];
  const installCss = async () => {
    await page.evaluate(()=>document.querySelectorAll('[data-flow-order],[data-flow-production-css]').forEach(node=>node.remove()));
    const style=await page.addStyleTag({content:productionCss.content});
    await style.evaluate(node=>node.dataset.flowProductionCss='lms-entrypoint');
    if (fitDiagnostic?.disableTransitions) await page.addStyleTag({content:'.native-drag-drop-bank-items, .native-drag-drop-bank-items *, .native-drag-drop-target-items, .native-drag-drop-target-items * { transition-property: none; }'});
    if (fitDiagnostic?.disableBankTransitions) await page.addStyleTag({content:'.native-drag-drop[data-layout-mode="text"] .native-drag-drop-bank { transition-property: none; }'});
  };
  const panel = page.locator('.native-multi-part-panel--flow');
  const root = panel.locator('.native-drag-drop');
  const items = root.locator('[data-drag-drop-word-id]');
  const target = root.locator('[data-drag-drop-target-id]');
  const send = type => page.getByRole('button', { name:type, exact:true }).click();
  let checkpoint = 'initial';
  let currentCase=null;
  const mark=async name=>{checkpoint=`case-${currentCase.index}-${currentCase.config.motion||fitDiagnostic?.motion}-${name}`;await page.evaluate(name=>{globalThis.flowFitCheckpoint=name;globalThis.flowBankObserve?.(name);},checkpoint);};
  const visible = async count => {
    try {
    if(fitDiagnostic) {
      await expect(items).toHaveCount(count);
      await expect.poll(async () => (await flowBankGeometry(page)).items.filter(item => item.hit).length).toBe(count);
    } else await expectFlowBankReady(page,{output,checkpoint,count,instance:true});
    const g = await flowBankGeometry(page); const p = await panel.boundingBox();
    assert.ok(g.bank.y >= p.y && g.bank.bottom <= p.y+p.height+1, JSON.stringify(g));
    assert.equal(g.ancestors.find(node => node.className.includes('native-multi-part-panel--flow')).scrollTop, 0);
    assert.ok(g.root.height <= 540.1);
    checkpoints.push({checkpoint,...currentCase,geometry:g});
    await writeFile(`${output}/lifecycle-checkpoints.json`,JSON.stringify(checkpoints,null,2));
    return g;
    } catch (error) {
      try { await captureFlowBankDiagnostic(page,output,`failure-${checkpoint}`); } catch (diagnosticError) { console.error('Diagnostic capture failed:',diagnosticError); }
      throw error;
    }
  };
  const drag = async (from, destination) => {
    if(!returnDiagnostic&&!fitDiagnostic&&destination!==target&&await from.evaluate(node=>Boolean(node.closest('[data-drag-drop-target-id]')))) {
      await physicalFlowReturn(page,from,destination,{output,checkpoint});return;
    }
    const traceReturn=returnDiagnostic&&currentCase?.index===selectedDiagnosticCase&&checkpoint.endsWith('partial-return');
    if(traceReturn)await beginFlowReturnTrace(page,from);
    const a = await from.boundingBox(); const b = await destination.boundingBox();
    const workspace = await root.locator('.native-drag-drop-workspace').boundingBox();
    const endY = destination === target ? Math.max(b.y+2, Math.min(b.y+b.height/2, workspace.y+workspace.height-3)) : b.y+b.height/2;
    if(traceReturn)await page.evaluate(planned=>globalThis.recordFlowReturnTrace('planned',planned),{start:{x:a.x+a.width/2,y:a.y+a.height/2},end:{x:b.x+b.width/2,y:endY},sourceBox:a,bankBox:b});
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
    if(traceReturn)await page.evaluate(()=>globalThis.recordFlowReturnTrace('after-source-move-before-down'));
    await page.mouse.down();
    await page.mouse.move(b.x+b.width/2,endY,{steps:10});
    if(traceReturn)await page.evaluate(()=>globalThis.recordFlowReturnTrace('before-up'));
    await page.mouse.up();
    if(traceReturn)await saveFlowReturnTrace(page,output,checkpoint);
    await expect(page.locator('[data-drag-drop-drag-preview]')).toHaveCount(0);
  };
  const cases = [
    ...['student','teacher'].flatMap(path => [{path,width:1440,height:650,scale:1},{path,width:760,height:440,scale:1},{path,width:1100,height:600,scale:.65}]),
    {path:'student',width:1440,height:650,scale:1,local:true},
    ...['draft-student','draft-teacher','published-student','published-teacher'].map(path => ({path,width:1440,height:650,scale:1})),
  ];
  if(fitDiagnostic?.refillOnly) {
    await page.reload();await page.waitForFunction(()=>Boolean(globalThis.corrections));await installCss();
    await page.evaluate(()=>corrections.configure({kind:'flow-bank',path:'student',height:650,scale:1}));
    await send('next-panel');
    await expect.poll(()=>root.locator('.native-drag-drop-bank-items').evaluate(node=>Boolean(node.style.getPropertyValue('--native-drag-drop-bank-fit-scale')) && node.dataset.fitStatus==='fit')).toBe(true);
    await page.evaluate(()=>{
      const section=corrections.pair.publicDocument.parts[0].interaction.sections.find(s=>s.kind==='drag-drop');
      corrections.setResponses({[section.id]:{[section.interaction.panels[0].dropTargets[0].id]:section.interaction.words.map(w=>w.id)}});
    });
    await expect.poll(()=>root.locator('.native-drag-drop-bank').evaluate(node=>node.dataset.empty==='true'&&node.offsetHeight===24)).toBe(true);
    await send('previous-panel');await expect(panel).toBeHidden();
    await page.evaluate(()=>{
      globalThis.flowFitCheckpoint='hidden-refill';
      const section=corrections.pair.publicDocument.parts[0].interaction.sections.find(s=>s.kind==='drag-drop');corrections.setResponses({[section.id]:{}});
    });
    await expect(items).toHaveCount(12);
    await page.evaluate(()=>{
      globalThis.flowObservedFrame=0;globalThis.flowBankObserve('hidden-refill-before-open');
      const sample=()=>{globalThis.flowObservedFrame++;globalThis.flowBankObserve('passive-rendered-frame');if(globalThis.flowObservedFrame<60)requestAnimationFrame(sample);};requestAnimationFrame(sample);
    });
    await send('next-panel');
    await page.evaluate(()=>{globalThis.flowFitCheckpoint='panel-open-command-completed';globalThis.flowBankObserve('after-panel-open');});
    await page.waitForFunction(()=>globalThis.flowObservedFrame===60);
    await captureFlowBankDiagnostic(page,output,'natural-hidden-refill-final');
    return;
  }
  if (fitDiagnostic?.targetOnly) {
    await page.reload(); await page.waitForFunction(()=>Boolean(globalThis.corrections));
    await installCss();
    await page.evaluate(()=>corrections.configure({kind:'flow-bank',path:'student',height:650,scale:1}));
    await page.evaluate(()=>{
      const pair=structuredClone(corrections.pair);
      const section=pair.publicDocument.parts[0].interaction.sections.find(s=>s.kind==='drag-drop');
      // Independent authored target-pressure case; original lifecycle fixture stays unchanged.
      section.interaction.panels[0].dropTargets[0].area={x:70,y:80,width:120,height:40};
      corrections.setPair(pair);
      corrections.setResponses({[section.id]:{[section.interaction.panels[0].dropTargets[0].id]:section.interaction.words.map(word=>word.id)}});
    });
    await send('next-panel');
    if(fitDiagnostic.targetTimeline) {
      const timeline=await page.evaluate(()=>new Promise(resolve=>{
        const trace=globalThis.targetFitTimeline={frame:0,startedAt:performance.now(),events:[]};
        let frame;
        const sample=()=>{trace.frame++;trace.events.push({phase:'rendered-frame',frame:trace.frame,snapshot:globalThis.readTargetFitSnapshot()});frame=requestAnimationFrame(sample);};
        trace.events.push({phase:'before-resize',frame:0,snapshot:globalThis.readTargetFitSnapshot()});
        frame=requestAnimationFrame(sample);
        window.dispatchEvent(new Event('resize'));
        setTimeout(()=>{cancelAnimationFrame(frame);trace.elapsedMs=performance.now()-trace.startedAt;globalThis.targetFitTimeline=null;resolve(trace);},5000);
      }));
      await writeFile(`${output}/target-passive-timeline.json`,JSON.stringify(timeline,null,2));
      await captureFlowBankDiagnostic(page,output,'target-passive-completed');
      return;
    }
    const results=[];
    for(let repeat=0;repeat<3;repeat++) {
      await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      results.push(await target.locator('.native-drag-drop-target-items').evaluate(node=>{
        const bounds=node.getBoundingClientRect();
        return {scale:node.dataset.fitScale,status:node.dataset.fitStatus,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,
          contained:[...node.children].every(child=>{const r=child.getBoundingClientRect();return r.left>=bounds.left-1 && r.right<=bounds.right+1 && r.top>=bounds.top-1 && r.bottom<=bounds.bottom+1;})};
      }));
    }
    await writeFile(`${output}/target-fit-results.json`,JSON.stringify(results,null,2));
    await captureFlowBankDiagnostic(page,output,'target-pressure-final');
    if(fitDiagnostic.name!=='A-reduce') assert.ok(results.every(r=>r.status==='fit' && r.contained && r.scrollHeight<=r.clientHeight),JSON.stringify(results));
    return;
  }
  const matrix=fitDiagnostic?.resetOnly?[cases.find(c=>c.path==='teacher')]:fitDiagnostic?cases:['reduce','no-preference'].flatMap(motion=>cases.map(config=>({...config,motion})));
  for (const [index, config] of matrix.entries()) {
    if(returnDiagnostic && index!==selectedDiagnosticCase)continue;
    if(!returnDiagnostic&&requiredCase!==undefined&&index!==Number(requiredCase))continue;
    if (process.env.FLOW_BANK_DIAGNOSTIC === '1' && index > 0) break;
    checkpoint = `case-${index}-initial`;
    currentCase={index,config};
    if(config.motion) await page.emulateMedia({reducedMotion:config.motion});
    await page.reload(); await page.waitForFunction(()=>Boolean(globalThis.corrections));
    await page.setViewportSize({width:config.width,height:1000});
    await installCss();
    await page.evaluate(config => corrections.configure({kind:'flow-bank',local:false,...config}), config);
    await expect(panel).toBeHidden(); await expect(items).toHaveCount(12);
    await root.evaluate(node => node.__flowBankOriginal = true);
    await send('next-panel'); const initial = await visible(12);
    assert.equal(initial.occupied,0); assert.equal(initial.revealed,0);
    await page.screenshot({path:`${output}/second-flow-bank-${config.path}-${config.width}-${config.scale}-${config.local?'local':'controlled'}.png`});
    const originalOrder = initial.items.map(item => item.id);
    await drag(items.first(),target); await expect(items).toHaveCount(11);
    const placed = target.locator('button[data-drag-drop-target-text]'); await expect(placed).toHaveCount(1);
    const placedId = initial.items[0].id;
    if(!fitDiagnostic) {
      await mark('invalid-cancelled-return');
      const responses=await page.evaluate(()=>corrections.responses);
      const start=await placed.boundingBox();
      await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(3,3,{steps:10});await page.mouse.up();
      await expect(page.locator('[data-drag-drop-drag-preview]')).toHaveCount(0);await expect(placed).toHaveCount(1);await visible(11);
      assert.deepEqual(await page.evaluate(()=>corrections.responses),responses);
      await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(start.x+start.width/2+30,start.y+start.height/2+20,{steps:5});
      await placed.evaluate(node=>node.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1})));await page.mouse.up();
      await expect(page.locator('[data-drag-drop-drag-preview]')).toHaveCount(0);await expect(placed).toHaveCount(1);await visible(11);
      assert.deepEqual(await page.evaluate(()=>corrections.responses),responses);
    }
    await send('previous-panel'); await expect(panel).toBeHidden();
    await page.setViewportSize({width:config.width-40,height:950});
    await send('next-panel'); await visible(11);
    assert.equal(await root.evaluate(node => node.__flowBankOriginal),true,'navigation must preserve the mounted instance');
    await expect(placed).toHaveCount(1);
    await drag(placed,root.locator('.native-drag-drop-bank')); await visible(12);
    await captureFlowBankDiagnostic(page,output,`case-${index}-after-drag-return`);
    assert.deepEqual((await flowBankGeometry(page)).items.map(item=>item.id),originalOrder);
    await captureFlowBankDiagnostic(page,output,`case-${index}-before-viewport-restore`);
    await page.setViewportSize({width:config.width,height:1000});
    checkpoint = `case-${index}-viewport-restore`;
    await captureFlowBankDiagnostic(page,output,`case-${index}-after-viewport-restore`);
    const restored = await visible(12);
    if (fitDiagnostic && !fitDiagnostic.resetOnly) {
      const repeated=[];
      for(let repeat=0;repeat<3;repeat++) {
        await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        repeated.push(await visible(12));
      }
      await captureFlowBankDiagnostic(page,output,'diagnostic-stable-final');
      evidence.push({config,initial,restored,repeated});
      break;
    }
    await mark('readable-focus');
    await page.getByRole('button',{name:'Second panel excerpt',exact:true}).click();
    await expect(page.locator('.native-audio-text-focus')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('.native-audio-text-focus')).toHaveCount(0);
    await visible(12); assert.equal(await root.evaluate(node=>node.__flowBankOriginal),true);
    if (config.path.includes('teacher')) {
      await mark('teacher-before-reveal');
      await target.click({position:{x:10,y:10}}); await expect(target).toHaveAttribute('data-revealed','true');
      await mark('teacher-revealed-empty');
      await send('previous-panel'); await send('next-panel'); await expect(target).toHaveAttribute('data-revealed','true');
      await mark('teacher-before-reset');
      await send('reset-activity'); await expect(panel).toBeHidden();
      await mark('teacher-reset-hidden');
      await send('next-panel');await mark('teacher-reset-panel-2');await visible(12);
      if(fitDiagnostic?.resetOnly) {await captureFlowBankDiagnostic(page,output,'teacher-reset-passed');break;}
      await mark('teacher-show-next-all');
      await send('show-next'); await send('show-next'); await expect(target).toHaveAttribute('data-revealed','true');
      await send('show-all'); await expect(target).toHaveAttribute('data-revealed','true');
      await send('reset-activity'); await send('next-panel'); await mark('teacher-show-all-reset');await visible(12);
    }
    // Fill a multi-capacity target, then exercise the empty bank and keyboard return.
    await mark('fill-empty-bank');
    for (let n=0;n<12;n++) { await items.first().click(); await target.click({position:{x:10,y:10}}); }
    await expect(items).toHaveCount(0);
    await expect.poll(()=>root.locator('.native-drag-drop-bank').evaluate(node=>node.offsetHeight)).toBe(24);
    const empty = await flowBankGeometry(page);
    assert.ok(Math.abs(empty.stage.width-restored.stage.width)<1 && Math.abs(empty.stage.height-restored.stage.height)<1,'bank collapse cannot rescale the source');
    assert.ok(empty.workspace.height>restored.workspace.height);
    await mark('partial-return');
    await drag(target.locator('button[data-drag-drop-target-text]').first(),root.locator('.native-drag-drop-bank')); await visible(1);
    await target.locator('button[data-drag-drop-target-text]').first().focus(); await page.keyboard.press('Delete'); await visible(2);
    await target.locator('button[data-drag-drop-target-text]').first().click(); await visible(3);
    await send('previous-panel'); await send('next-panel'); await visible(3);
    assert.equal(await root.evaluate(node=>node.__flowBankOriginal),true);
    await mark('reopen');
    await page.reload(); await page.waitForFunction(()=>Boolean(globalThis.corrections));
    await installCss();
    await page.evaluate(config=>corrections.configure({kind:'flow-bank',...config}),config);
    await send('next-panel');await root.evaluate(node=>{node.__flowBankOriginal=true;});await visible(12);
    evidence.push({index,config,css:{mode:productionCss.mode,assets:productionCss.assets},initial,restored,empty,placedId,reopened:true});
    await writeFile(`${output}/second-flow-bank-lifecycle.json`,JSON.stringify(evidence,null,2));
  }
  await writeFile(`${output}/second-flow-bank-lifecycle.json`,JSON.stringify(evidence,null,2));
  if(!fitDiagnostic && !returnDiagnostic && requiredCase===undefined) {
    const font=Buffer.from((await readFile('tests/fixtures/fonts/Ahem.ttf.base64','utf8')).trim(),'base64');
    const artwork=await sharp({create:{width:1024,height:1100,channels:3,background:'#d6eafa'}}).png().toBuffer(),lateCases=[];
    for(const motion of ['reduce','no-preference'])for(const path of ['student','teacher'])for(const openBeforeLoad of [false,true]) {
      const index=lateCases.length,label=`delayed-${motion}-${path}-${openBeforeLoad?'visible':'hidden'}`;currentCase={index:22+index,config:{motion,path,openBeforeLoad}};checkpoint=label;
      await page.reload();await page.waitForFunction(()=>Boolean(globalThis.corrections));await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:motion});await installCss();
      let resolveAssets,released=false,primaryError=null;const pending=new Promise(resolve=>{resolveAssets=resolve;});const requests=[],handlers=[],secondaryErrors=[];
      const release=()=>{if(!released){released=true;resolveAssets();}};
      const route=request=>{
        const slot=new URL(request.request().url()).pathname.split('/').at(-1),body=slot.includes('font')?font:artwork;
        const record={slot,state:'held',requestedAt:new Date().toISOString(),contentType:slot.includes('font')?'font/ttf':'image/png',byteLength:body.length,sha256:createHash('sha256').update(body).digest('hex')};requests.push(record);
        const handler=(async()=>{await pending;await request.fulfill({contentType:record.contentType,body});record.state='fulfilled';record.fulfilledAt=new Date().toISOString();})()
          .catch(error=>{record.state='error';secondaryErrors.push({phase:'route',slot,message:error.message});});
        handlers.push(handler);return handler;
      };
      const captureMetadata=async()=>({phase:released?'after-release':'before-release',barrierClosed:!released,pendingSlots:requests.filter(r=>r.state==='held').map(r=>r.slot),requests:structuredClone(requests),panelHidden:await panel.evaluate(node=>node.hidden||getComputedStyle(node).display==='none')});
      await page.route('**/correction-assets/late-*',route);
      try {
        await page.evaluate(({path,index})=>{
          corrections.configure({kind:'flow-bank',path,height:650,scale:1,local:false});
        },{path,index});
        await expect(panel).toBeHidden();await root.evaluate(node=>{node.__flowBankOriginal=true;});
        await page.evaluate(index=>{
          const pair=structuredClone(corrections.pair),section=pair.publicDocument.parts[0].interaction.sections.find(s=>s.kind==='drag-drop'),child=section.interaction;
          const image=child.panels[0].images.find(image=>image.assetSlot==='background');const reference=pair.publicDocument.assets.find(asset=>asset.slot===image.assetSlot);
          reference.slot=image.assetSlot=`late-background-${index}`;
          const slot=`late-font-${index}`;pair.publicDocument.assets.push({slot,assetId:`90000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,checksumSha256:'c'.repeat(64),role:'activity_font'});
          child.presentation.bankWordStyle.fontAssetSlot=slot;corrections.setPair(pair);
        },index);
        await expect.poll(()=>new Set(requests.map(r=>r.slot)).size,{timeout:5000}).toBe(2);
        if(openBeforeLoad)await send('next-panel');
        const expectedSlots=[`late-background-${index}`,`late-font-${index}`];
        let navigationReadiness;
        await expect.poll(async()=>{
          const observed=await root.evaluate(node=>{
            const panel=node.closest('.native-multi-part-panel--flow'),css=getComputedStyle(panel),rect=node.getBoundingClientRect();
            const panelHidden=panel.hidden||css.display==='none';
            return {sameInstance:node.__flowBankOriginal===true,panelHidden,panelVisible:!panelHidden&&css.visibility==='visible',
              root:{width:rect.width,height:rect.height,clientWidth:node.clientWidth,clientHeight:node.clientHeight},
              panelIndex:globalThis.corrections.state?.panelIndex,panelCount:globalThis.corrections.state?.panelCount,
              fontStatus:node.querySelector('.native-drag-drop-bank').dataset.fontStatus,fontSetStatus:document.fonts.status};
          });
          navigationReadiness={...observed,barrierClosed:!released,requests:structuredClone(requests)};
          return flowNavigationReadinessIssues(navigationReadiness,{openBeforeLoad,expectedSlots});
        },{timeout:5000,message:`${label}: navigation committed with delayed assets still held`}).toEqual([]);
        assert.equal(released,false);assert.ok(requests.every(r=>r.state==='held'));
        assert.deepEqual(requests.map(r=>r.slot).sort(),[`late-background-${index}`,`late-font-${index}`]);
        const before=await captureFlowBankDiagnostic(page,output,`${label}-before-load`,{screenshot:false,metadata:{...await captureMetadata(),navigationReadiness}});
        assert.equal(released,false);assert.equal(before.capture.barrierClosed,true);assert.equal(before.capture.panelHidden,!openBeforeLoad);
        assert.equal(before.fontSetStatus,'loading');assert.equal(before.originalMountedInstance,true);
        const order=before.bankOrder,responses=before.responses;
        release();await expect(root.locator('.native-drag-drop-bank')).toHaveAttribute('data-font-status','loaded',{timeout:5000});
        await expect.poll(()=>requests.every(r=>r.state==='fulfilled'),{timeout:5000}).toBe(true);
        const alias=nativeActivityFontFamilyAlias(`90000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
        await expect.poll(()=>root.evaluate((node,alias)=>[...document.fonts].some(face=>face.family.replaceAll('"','')===alias&&face.status==='loaded')&&document.fonts.check(`16px "${alias}"`)&&getComputedStyle(node.querySelector('[data-drag-drop-word-id]')).fontFamily.includes(alias),alias),{timeout:5000}).toBe(true);
        await expect.poll(()=>root.locator('img').evaluateAll(nodes=>nodes.every(node=>node.complete&&node.naturalWidth>0)),{timeout:5000}).toBe(true);
        const artworkImage=root.locator(`.native-drag-drop-artwork > img[src$="/late-background-${index}"]`);
        await expect(artworkImage).toHaveCount(1);
        assert.equal(await artworkImage.evaluate(node=>node.tagName),'IMG');
        assert.equal(await artworkImage.evaluate(node=>new URL(node.currentSrc).pathname.split('/').at(-1)),`late-background-${index}`);
        const decoded=await artworkImage.evaluate(async node=>{await node.decode();return {complete:node.complete,width:node.naturalWidth,height:node.naturalHeight,decoded:true};});
        assert.deepEqual(decoded,{complete:true,width:1024,height:1100,decoded:true});
        if(!openBeforeLoad){await expect(panel).toBeHidden();await send('next-panel');}
        const ready=await expectFlowBankReady(page,{output,checkpoint:`${label}-loaded`,count:12,instance:true,order,responses});await visible(12);
        const source=await page.evaluate(()=>{const child=corrections.pair.publicDocument.parts[0].interaction.sections.find(s=>s.kind==='drag-drop').interaction;return {surface:child.panels[0].surface,target:child.panels[0].dropTargets[0].area};});
        const outer=ready.source.stageBorderBox,positioning=ready.source.stagePositioningBox;
        assert.ok(Math.abs(outer.height-outer.width*source.surface.height/source.surface.width)<1,'outer stage preserves source aspect ratio');
        const expected=expectedFlowTarget(ready.source,source);
        for(const [key,value] of Object.entries(expected))assert.ok(Math.abs(ready.source[key]-value)<1,`positioning-box ${key} alignment`);
        const artworkRect=await artworkImage.boundingBox();assert.ok(artworkRect,'decoded background has a rendered box');
        for(const key of ['x','y','width','height'])assert.ok(Math.abs(artworkRect[key]-positioning[key])<1,`full artwork ${key} matches positioning box`);
        await captureFlowBankDiagnostic(page,output,`${label}-after-load-ready`,{metadata:{...await captureMetadata(),decoded,fontAlias:alias}});
        await send('previous-panel');await send('next-panel');
        await expectFlowBankReady(page,{output,checkpoint:`${label}-navigation`,count:12,instance:true,order,responses,baseline:ready});await visible(12);
        lateCases.push({motion,path,openBeforeLoad,checkpoint:label,requests,decoded,fontAlias:alias,beforeLoadJson:`${label}-before-load.json`,geometry:ready});await writeFile(`${output}/delayed-flow-bank.json`,JSON.stringify(lateCases,null,2));
      } catch(error) {
        primaryError=error;
        try {await captureFlowBankDiagnostic(page,output,`${label}-failure-${released?'after-release':'held'}`,{screenshot:released,metadata:await captureMetadata()});}
        catch(diagnosticError){secondaryErrors.push({phase:'failure-capture',message:diagnosticError.message});}
      } finally {
        release();
        try {await page.unroute('**/correction-assets/late-*',route);}catch(error){secondaryErrors.push({phase:'unroute',message:error.message});}
        await Promise.all(handlers);
      }
      if(primaryError||secondaryErrors.length) {
        const error=primaryError||new Error('Delayed asset route/cleanup failed');error.flowBankAssetsCleaned=true;
        try {await writeFile(`${output}/${label}-failure.json`,JSON.stringify({checkpoint:label,error:{message:error.message,stack:error.stack},secondaryErrors,requests,barrierClosed:!released},null,2));}catch(writeError){console.error('Secondary failure receipt error:',writeError);}
        throw error;
      }
    }
  }
}
