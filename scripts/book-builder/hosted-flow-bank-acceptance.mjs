import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import sharp from 'sharp';
import { secondFlowBankPair } from '../../tests/fixtures/native-runtime-regressions/flow-bank-data.js';
import { normalizeNativeRuntimePublicDocument, normalizeNativeRuntimeTeacherDocument } from '../../src/data/native-activities/nativeActivityRuntimeValidation.js';
import { expectFlowBankReady, readFlowBankSnapshot } from './flow-bank-readiness.mjs';
import { expectTargetFitReady } from './target-fit-readiness.mjs';

// Existing local HTTP fixtures serve actual Builder/Viewer bundles. These writes
// seed that in-memory fixture only; database acceptance is a separate gate.
export async function exerciseHostedFlowBank(page, { nativeDocuments, nativeAssets, output }) {
  await mkdir(output, {recursive:true});
  let frame, checkpoint='create', sessionEvidence=[], navigationEvidence=[]; const evidence=[];
  const ensureFlowLaunchSurface=async(viewer,phase)=>{
    const launch=viewer.getByRole('button',{name:'Built Flow bank launch',exact:true});
    const back=viewer.getByRole('button',{name:'Back',exact:true});
    const embedded=viewer.locator('.teacher-offline-embedded-activity');
    let backClicked=false;
    try {
      const launchCount=await launch.count();
      assert.ok(launchCount<=1,'Flow launch must be unique');
      if(!(launchCount===1&&await launch.isVisible())) {
        assert.equal(await embedded.count(),1,'Expected page launch or one active embedded activity');
        assert.equal(await back.count(),1,'Active activity requires one canonical Back');
        await expect(back).toBeVisible();await expect(back).toBeEnabled();
        await back.click();backClicked=true;
      }
      await expect(embedded).toHaveCount(0);
      await expect(viewer.locator('.teacher-offline-embedded-activity .native-multi-part')).toHaveCount(0);
      await expect(viewer.locator('.teacher-offline-page-stage')).toBeVisible();
      await expect(launch).toHaveCount(1);await expect(launch).toBeVisible();
      navigationEvidence.push({phase,backClicked,launchCount:1,embeddedCount:0,pageReady:true});
      await writeFile(`${output}/${checkpoint}-navigation.json`,JSON.stringify(navigationEvidence,null,2));
    } catch(error) {
      const diagnostic={checkpoint,phase,backClicked,error:error.stack};
      try {
        diagnostic.dialogOpen=await page.locator('.unified-builder-review-dialog').evaluate(node=>node.open);
        diagnostic.launchCount=await launch.count();diagnostic.backCount=await back.count();
        diagnostic.viewer=await viewer.locator('body').evaluate(body=>{
          const url=new URL(location.href);
          for(const key of [...url.searchParams.keys()])if(/authorization|token|signature|secret/i.test(key))url.searchParams.set(key,'[redacted]');
          const active=[...body.querySelectorAll('.teacher-offline-embedded-activity')];
          return {url:url.href,activeEmbeddedCount:active.length,activeKinds:active.slice(0,4).map(node=>node.querySelector('[data-native-kind]')?.dataset.nativeKind|| (node.querySelector('.native-multi-part')?'multi-part':null)),activeActivityId:body.querySelector('[data-active-activity-id]')?.dataset.activeActivityId||null,pageStageCount:body.querySelectorAll('.teacher-offline-page-stage').length,retainedTokens:[...body.querySelectorAll('.native-drag-drop')].slice(0,4).map(node=>node.__flowBankInstance||null),summary:body.innerText.slice(0,2400)};
        });
        diagnostic.builderSummary=(await page.locator('body').innerText()).slice(-1200);
      } catch(captureError) {diagnostic.captureError=captureError.message;}
      await writeFile(`${output}/${checkpoint}-${phase}-failure.json`,JSON.stringify(diagnostic,null,2));
      await page.screenshot({path:`${output}/${checkpoint}-${phase}-failure.png`}).catch(()=>{});
      throw error;
    }
  };
  try {
    await page.goto(`${new URL(page.url()).origin}/#/books/ultimate-b2/components/ultimate-b2-students-book/activities`, {waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Add Activity',exact:true}).click();
    await page.getByRole('radio',{name:/Multi-Part/}).check();
    const title='Synthetic built Flow bank';
    await page.getByLabel(/Initial title/).fill(title);
    await page.getByRole('button',{name:'Create activity',exact:true}).click();
    await expect(page.locator('.native-multi-part-editor')).toBeVisible();
    const [activityId,created]=[...nativeDocuments].find(([,pair])=>pair.publicDocument.metadata.title===title);
    const pair=secondFlowBankPair();
    pair.publicDocument.activityId=pair.teacherDocument.activityId=activityId;
    pair.publicDocument.metadata.title=title;
    for(const asset of pair.publicDocument.assets) {
      const [width,height]=({shared:[1024,582],background:[1024,1100],overlay:[150,100],readable:[1000,1800]})[asset.slot];
      const bytes=await sharp({create:{width,height,channels:3,background:'#d6eafa'}}).png().toBuffer();
      asset.assetId=randomUUID();asset.checksumSha256=createHash('sha256').update(bytes).digest('hex');
      nativeAssets.set(asset.assetId,{activityId,slot:asset.slot,type:'image/png',bytes,checksumSha256:asset.checksumSha256});
    }
    const publicDocument=normalizeNativeRuntimePublicDocument(pair.publicDocument,{activityId,kind:'multi-part'});
    const teacherDocument=normalizeNativeRuntimeTeacherDocument(pair.teacherDocument,{activityId,kind:'multi-part',publicDocument});
    nativeDocuments.set(activityId,{...created,publicDocument,teacherDocument,publicRevision:created.publicRevision+1,teacherRevision:created.teacherRevision+1});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.hosted-builder-tool-tabs a[href$="/hotspots"]').click();
    await page.locator('.editable-hotspot-box').first().click();
    const activitySelect=page.getByLabel('Activity');
    await expect(activitySelect).toHaveCount(1);
    const flowOption=activitySelect.locator(`option[value="${activityId}"]`);
    await expect(flowOption).toHaveCount(1);
    await expect(flowOption).toHaveText(`Ready · multi-part · ${title}`);
    await activitySelect.selectOption(activityId);
    await expect(activitySelect).toHaveValue(activityId);
    await page.getByLabel('Label',{exact:true}).fill('Built Flow bank launch');
    await page.locator('.builder-save-state').getByRole('button',{name:'Save',exact:true}).click();
    await page.locator('.builder-save-state').getByText('Saved',{exact:true}).waitFor();
    for(const motion of ['reduce','no-preference']) for(const width of [1440,760]) {
      checkpoint=`built-flow-${motion}-${width}`;
      frame=null;sessionEvidence=[];navigationEvidence=[];
      await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:motion});
      await page.getByRole('button',{name:'Review',exact:true}).click();
      const iframe=page.locator('.unified-builder-review-dialog iframe');
      const viewer=page.frameLocator('.unified-builder-review-dialog iframe');
      await expect(viewer.locator('.teacher-offline-page-stage')).toBeVisible({timeout:30000});
      await ensureFlowLaunchSurface(viewer,'setup');
      await viewer.getByRole('button',{name:'Built Flow bank launch',exact:true}).click();
      frame=await (await iframe.elementHandle()).contentFrame();
      await expect(frame.locator('.teacher-offline-embedded-activity .native-multi-part')).toBeVisible();
      const panel=frame.locator('.native-multi-part-panel--flow'),root=panel.locator('.native-drag-drop');
      const next=frame.getByRole('button',{name:'Next activity part',exact:true});
      const previous=frame.getByRole('button',{name:'Previous activity part',exact:true});
      const reload=frame.getByRole('button',{name:'Reload',exact:true});
      const recordSession=async event=>{sessionEvidence.push(event);await writeFile(`${output}/${checkpoint}-sessions.json`,JSON.stringify(sessionEvidence,null,2));};
      const markCurrentSession=async token=>{
        await expect(root).toHaveCount(1);
        const handle=await root.elementHandle();assert.ok(handle);
        assert.equal(await handle.evaluate(node=>node.__flowBankInstance),undefined,'new session has no old token');
        await handle.evaluate((node,token)=>{node.__flowBankInstance=token;},token);
        assert.equal(await handle.evaluate(node=>node.isConnected),true);
        await recordSession({phase:'marked',token,connected:true});
        return {token,handle};
      };
      const reloadSession=async(oldSession,token)=>{
        assert.notEqual(token,oldSession.token);
        assert.deepEqual(await oldSession.handle.evaluate(node=>({connected:node.isConnected,token:node.__flowBankInstance})),{connected:true,token:oldSession.token});
        await recordSession({phase:'before-reload',token:oldSession.token,connected:true});
        await expect(reload).toBeEnabled();
        await recordSession({phase:'reload-enabled',token:oldSession.token});
        await reload.click();
        await expect.poll(async()=>({oldConnected:await oldSession.handle.evaluate(node=>node.isConnected),currentRoots:await root.count()}),{timeout:5000,message:`${checkpoint}: Reload replaces ${oldSession.token}`}).toEqual({oldConnected:false,currentRoots:1});
        await expect(panel).toBeHidden();await expect(previous).toBeDisabled();await expect(next).toBeEnabled();
        await recordSession({phase:'replaced',token:oldSession.token,connected:false,currentRoots:1,panel:0});
        return markCurrentSession(token);
      };
      await expect(panel).toBeHidden();await expect(previous).toBeDisabled();
      const session0=await markCurrentSession(`${checkpoint}-session-0`);
      await expect(reload).toBeDisabled();
      await next.click();
      const initial=await expectFlowBankReady(frame,{output,checkpoint:`${checkpoint}-initial`,count:12,instance:session0.token});
      const order=initial.children.map(child=>child.id);
      const host=await root.evaluate(node=>{const r=node.closest('.teacher-offline-embedded-activity').getBoundingClientRect();return {width:r.width,height:r.height};});
      assert.ok(initial.root.width<=host.width+1&&initial.root.height<=host.height+1,'Flow fits actual Teacher shell');
      await previous.click();await expect(panel).toBeHidden();await next.click();
      await expectFlowBankReady(frame,{output,checkpoint:`${checkpoint}-navigation`,count:12,instance:session0.token,order,baseline:initial});
      await recordSession({phase:'panel-navigation-preserved',token:session0.token});
      const target=root.locator('[data-drag-drop-target-id]');
      await target.click({position:{x:10,y:10}});await expect(target).toHaveAttribute('data-revealed','true');
      const session1=await reloadSession(session0,`${checkpoint}-session-1`);
      await next.click();
      const reset=await expectFlowBankReady(frame,{output,checkpoint:`${checkpoint}-reset`,count:12,instance:session1.token,order});
      await expect(target).not.toHaveAttribute('data-revealed','true');
      await expect(target.locator('button[data-drag-drop-target-text]')).toHaveCount(0);
      await previous.click();await expect(panel).toBeHidden();await next.click();
      await expectFlowBankReady(frame,{output,checkpoint:`${checkpoint}-session-1-navigation`,count:12,instance:session1.token,order,baseline:reset});
      await recordSession({phase:'panel-navigation-preserved',token:session1.token});
      const items=root.locator('[data-drag-drop-word-id]');
      for(let n=0;n<12;n++){await items.first().click();await target.click({position:{x:10,y:10}});}
      await expect(items).toHaveCount(0);
      await expect.poll(()=>root.locator('.native-drag-drop-bank').evaluate(node=>node.offsetHeight)).toBe(24);
      const targetId=await target.getAttribute('data-drag-drop-target-id');
      await expectTargetFitReady(frame,{output,checkpoint:`${checkpoint}-full-target`,targetId,count:12});
      const empty=await readFlowBankSnapshot(frame);
      assert.equal(empty.source.width,reset.source.width);assert.equal(empty.source.height,reset.source.height);
      await target.locator('button[data-drag-drop-target-text]').first().focus();await page.keyboard.press('Delete');
      await expectFlowBankReady(frame,{output,checkpoint:`${checkpoint}-keyboard-return`,count:1,instance:session1.token,order:[order[0]]});
      await expect(target.locator('button[data-drag-drop-target-text]')).toHaveCount(11);
      await expect(target).not.toHaveAttribute('data-revealed','true');
      const session2=await reloadSession(session1,`${checkpoint}-session-2`);
      await expect(reload).toBeDisabled();
      await next.click();
      await expectFlowBankReady(frame,{output,checkpoint:`${checkpoint}-final`,count:12,instance:session2.token,order});
      await expect(target).not.toHaveAttribute('data-revealed','true');
      await expect(target.locator('button[data-drag-drop-target-text]')).toHaveCount(0);
      await expect(reload).toBeDisabled();
      await recordSession({phase:'clean-reload-disabled',token:session2.token,placements:0,reveals:0});
      const scripts=await frame.evaluate(()=>[...document.scripts].map(script=>script.src).filter(Boolean));
      assert.ok(scripts.some(src=>/\/assets\/.*\.js$/.test(src))&&!scripts.some(src=>src.includes('/@vite/')),'built Viewer entrypoint');
      await page.screenshot({path:`${output}/${checkpoint}.png`});
      for(const session of [session0,session1,session2])await session.handle.dispose();
      await expect(viewer.locator('.teacher-offline-embedded-activity')).toHaveCount(1);
      await ensureFlowLaunchSurface(viewer,'teardown');
      await page.getByRole('button',{name:'Close Review',exact:true}).click();
      evidence.push({checkpoint,activityId,motion,width,initial,reset,empty,host,scripts,sessions:sessionEvidence,navigation:navigationEvidence});
      await writeFile(`${output}/built-flow-bank.json`,JSON.stringify(evidence,null,2));
    }
  } catch(error) {
    const receipt={checkpoint,error:error.stack,sessions:sessionEvidence,navigation:navigationEvidence};
    try {receipt.snapshot=frame?await readFlowBankSnapshot(frame):null;receipt.body=await page.locator('body').innerText();}catch(captureError){receipt.captureError=captureError.message;}
    await writeFile(`${output}/built-flow-bank-failure.json`,JSON.stringify(receipt,null,2));
    await page.screenshot({path:`${output}/built-flow-bank-failure.png`}).catch(()=>{});
    throw error;
  }
}
