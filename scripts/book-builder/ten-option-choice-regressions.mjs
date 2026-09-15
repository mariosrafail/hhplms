import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import react from '@vitejs/plugin-react';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../tests/_vite-test-server.mjs';
import {tenOptionChoicePair,choiceInteraction,choiceSolution} from '../../tests/fixtures/ten-option-choice.js';
import {normalizeNativeRuntimePublicDocument,normalizeNativeRuntimeTeacherDocument} from '../../src/data/native-activities/nativeActivityRuntimeValidation.js';
import {nativeSingleChoiceCorrectOptionIds} from '../../src/data/native-activities/nativeSingleChoice.js';
import {nativeAssignmentCapability} from '../../netlify/functions/_book-content/native-assignment-runtime.js';
import {readChoiceVisualGeometry,expectChoiceVisualReady} from './choice-visual-geometry.mjs';
import {syntheticListeningWav} from '../../tests/fixtures/native-runtime-regressions/synthetic-audio.mjs';
import {runOldschoolChoicePointerCases} from './oldschool-choice-pointer-regressions.mjs';

// Identity is independent of feedback inside text labels. Each locator resolves
// against the current activity render, including after Student/Teacher switches.
async function choiceTargets(page,pair,{visual,multiple,teacher=false}) {
  const document=pair.publicDocument,interaction=choiceInteraction(pair),question=interaction.questions[0];
  assert.equal(await page.evaluate(()=>corrections.pair.publicDocument.activityId),document.activityId);
  let scope=page.locator(`main .published-native-activity[data-native-kind="${document.kind}"]`);
  await expect(scope).toHaveCount(1);
  if(document.kind==='multi-part')scope=scope.locator(`[data-section-id="${document.parts[0].interaction.sections[0].id}"]`);
  scope=scope.locator(`[data-native-single-choice-presentation="${visual?'visual':'text'}"]${teacher?'.native-single-choice-teacher':''}`);
  await expect(scope).toHaveCount(1);
  const role=visual?'button':multiple?'checkbox':'radio';
  const name=option=>visual?`${question.prompt}: ${option.text}`:option.text;
  const optionById=id=>{
    const option=question.options.find(option=>option.id===id);assert.ok(option);
    if(visual) {
      const bindings=interaction.presentation.panels.flatMap(panel=>panel.hotspots).filter(h=>h.questionId===question.id&&h.optionId===id);
      assert.equal(bindings.length,1);
      return scope.getByRole('button',{name:name(option),exact:true});
    }
    return scope.locator(`fieldset input[type="${role}"][name$="-${question.id}"][value="${id}"]`);
  };
  const assertState=async(revealed=false,selectedIds=[])=>{
    const selected=new Set(selectedIds),actualSelected=[],actualCorrect=[];
    for(const option of question.options) {
      const target=optionById(option.id);await expect(target).toHaveCount(1);
      const correct=revealed&&selected.has(option.id),state=visual?target:target.locator('..');
      await expect(target).toHaveAccessibleName(`${name(option)}${!visual&&correct?' Correct.':''}`);
      if(!revealed)await expect(scope.getByRole(role,{name:name(option),exact:true})).toHaveCount(1);
      if(visual) {
        await expect(target).toHaveAttribute('aria-label',name(option));
        await expect(target).toHaveAttribute('aria-pressed',String(selected.has(option.id)));
        if(await target.getAttribute('aria-pressed')==='true')actualSelected.push(option.id);
      } else {
        await expect(target).toHaveValue(option.id);
        await expect(target).toBeChecked({checked:selected.has(option.id)});
        if(await target.isChecked())actualSelected.push(await target.inputValue());
        const fieldset=target.locator('xpath=ancestor::fieldset[1]');
        await expect(fieldset).toHaveCount(1);
        await expect(fieldset).toHaveJSProperty('disabled',revealed);
        await expect(state.getByRole('status')).toHaveCount(correct?1:0);
        if(correct)await expect(state.getByRole('status')).toHaveText('Correct.');
      }
      if(revealed)await expect(target).toBeDisabled();else await expect(target).toBeEnabled();
      if(correct)await expect(state).toHaveAttribute('data-answer-state','correct');
      else await expect(state).not.toHaveAttribute('data-answer-state',/./);
      if(await state.getAttribute('data-answer-state')==='correct')actualCorrect.push(option.id);
    }
    assert.deepEqual(actualSelected.sort(),[...selectedIds].sort());
    assert.deepEqual(actualCorrect.sort(),revealed?[...selectedIds].sort():[]);
  };
  return {question,optionById,assertState};
}

export async function runTenOptionChoiceRegressions(browser,output,{diagnostic=false}={}) {
  await mkdir(output,{recursive:true});assert.equal(process.versions.node.split('.')[0],'22');
  let saved=tenOptionChoicePair(),revision=7,checkpoint='setup';const evidence=[];
  const provider={name:'ten-choice-provider',enforce:'pre',resolveId:id=>['virtual:component-publication','virtual:hosted-native-drafts'].includes(id)?`\0${id}`:null,
    load:id=>id==='\0virtual:hosted-native-drafts'?"export const hostedNativeDraftAssetUrl=(_,id)=>corrections.assetUrl(id);export const hostedNativeDraftTeacherAssetUrl=()=>'';":id==='\0virtual:component-publication'?"export const publishedNativeAssetUrl=(_,ref)=>corrections.assetUrl(ref.assetId);export const publishedNativeTeacherAssetUrl=()=>'';export const loadPublishedNativeTeacherDocument=async()=>corrections.pair.teacherDocument;":null};
  const server=await createServer({configFile:false,plugins:[provider,react()],optimizeDeps:{entries:['tests/fixtures/native-runtime-regressions/runtime-corrections.html']},server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const assetTypes={};page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/correction-assets/'))assetTypes[path.split('/').at(-1)]=response.headers()['content-type'];});
  const geometry=async label=>{const value=await readChoiceVisualGeometry(page,assetTypes);await writeFile(`${output}/geometry-${label}.json`,JSON.stringify(value,null,2));return value;};
  const asset=async route=>{
    if(diagnostic)return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1100"><rect width="1024" height="1100" fill="#eaf4fa"/></svg>'});
    const path=new URL(route.request().url()).pathname,slot=path.split('/').at(-1);
    if(slot.includes('audio'))return route.fulfill({contentType:'audio/wav',body:syntheticListeningWav()});
    const config=await page.evaluate(()=>corrections.config);
    const width=slot==='transcript-page'?1018:1024,height=slot==='transcript-page'?1509:slot==='readable-image'?1600:config.sourceHeight||1100;
    return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#eaf4fa"/><path d="M0 0H${width}V${height}H0Z" fill="none" stroke="#207080" stroke-width="8"/></svg>`});
  };
  await page.route('**/correction-assets/**',asset);
  await page.route('**/builder/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/preview'))return asset(route);
    if(path.includes('/fonts'))return route.fulfill({json:{fonts:[]}});
    if(path.includes('/content/'))return route.fulfill({json:{revision,document:path.includes('native-activity-teacher')?saved.teacherDocument:saved.publicDocument}});
    if(path.endsWith('/save')) {
      const input=route.request().postDataJSON(),options={kind:saved.publicDocument.kind,activityId:saved.publicDocument.activityId};
      const publicDocument=normalizeNativeRuntimePublicDocument(input.publicDocument,options),teacherDocument=normalizeNativeRuntimeTeacherDocument(input.teacherDocument,{...options,publicDocument});
      saved={publicDocument,teacherDocument};revision++;return route.fulfill({json:{...saved,publicRevision:revision,teacherRevision:revision}});
    }
    throw new Error(`Unexpected isolated request: ${path}`);
  });
  const configure=async values=>{await page.evaluate(values=>corrections.configure({kind:'ten-choice',height:650,scale:1,sourceHeight:1100,supporting:0,...values}),values);};
  const save=async()=>{const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/save'));await page.getByRole('button',{name:'Save Draft',exact:true}).click();assert.equal((await response).status(),200);};
  const record=async data=>{evidence.push({checkpoint,...data});await writeFile(`${output}/ten-option-choice.json`,JSON.stringify({node:process.version,executable:process.execPath,evidence},null,2));};
  try {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/runtime-corrections.html`);await page.waitForFunction(()=>Boolean(globalThis.corrections));
    if(diagnostic) {
      checkpoint='oldschool-listening-visual-multiple-diagnostic';
      await configure({choiceKind:'oldschool-listening',path:'published-student',count:10,visual:true,multiple:true});
      const target=await choiceTargets(page,tenOptionChoicePair('oldschool-listening',{visual:true,multiple:true}),{visual:true,multiple:true});
      await page.waitForFunction(()=>{const img=document.querySelector('.native-single-choice-visual-stage img');return img?.complete&&img.naturalWidth>0;},{},{timeout:5000});
      await geometry('diagnostic-mounted');
      const tenth=target.question.options.find(o=>o.text==='Option 1.10'),seventh=target.question.options.find(o=>o.text==='Option 1.7');
      await target.optionById(tenth.id).focus();await page.keyboard.press('Space');await geometry('diagnostic-after-keyboard');
      await geometry('diagnostic-before-click');
      let failure=null;try{await target.optionById(seventh.id).click();}catch(error){failure=error.stack;await geometry('diagnostic-click-catch');await page.screenshot({path:`${output}/diagnostic-before.png`});}
      await writeFile(`${output}/diagnostic-known-failure.json`,JSON.stringify({node:process.version,execPath:process.execPath,failure},null,2));
      assert.ok(failure,'Known failure must be observed before sizing intervention');
      await page.addStyleTag({content:'.native-oldschool-question-session:has(> [data-native-single-choice-presentation="visual"]) { position:absolute; inset:0; min-height:0; }'});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await geometry('diagnostic-session-bounded');await target.optionById(seventh.id).click();await geometry('diagnostic-after-pointer');await page.screenshot({path:`${output}/diagnostic-after.png`});
      return;
    }
    for(const kind of ['single-choice','multi-part','oldschool-listening']) {
      checkpoint=`${kind}-editor-9-to-10`;saved=tenOptionChoicePair(kind,{count:9});revision=7;
      await configure({choiceKind:kind,path:'choice-editor',count:9,visual:false,multiple:false});
      if(kind==='multi-part')await page.getByRole('button',{name:'Ten choices',exact:true}).click();
      await page.getByRole('tab',{name:'Content',exact:true}).click();
      const original=choiceInteraction(saved).questions[0].options.map(o=>o.id);
      const add=page.getByRole('button',{name:'Add Option',exact:true});await expect(add).toBeEnabled();await add.click();await expect(add).toBeDisabled();await expect(page.locator('.native-single-choice-option-editor')).toHaveCount(10);
      await page.getByRole('textbox',{name:'Option 10',exact:true}).fill('Option 1.10');
      await page.getByRole('tab',{name:'Answer Key',exact:true}).click();await page.getByRole('checkbox',{name:'Option 9: Option 1.9',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Option 10: Option 1.10',exact:true}).check();await save();
      const tenth=choiceInteraction(saved).questions[0].options[9].id;
      assert.deepEqual(choiceInteraction(saved).questions[0].options.slice(0,9).map(o=>o.id),original);assert.deepEqual(nativeSingleChoiceCorrectOptionIds(choiceSolution(saved).correctAnswers[0]),[tenth]);
      for(const n of [7,8,9])await page.getByRole('checkbox',{name:`Option ${n}: Option 1.${n}`,exact:true}).check();
      await page.getByRole('tab',{name:'Content',exact:true}).click();await page.getByRole('button',{name:'Move option 10 up',exact:true}).click();await save();
      assert.deepEqual(nativeSingleChoiceCorrectOptionIds(choiceSolution(saved).correctAnswers[0]),[original[6],original[7],tenth,original[8]]);
      const deleteText=page.getByRole('textbox',{name:'Option 8',exact:true});
      await expect(deleteText).toHaveValue('Option 1.8');assert.equal(choiceInteraction(saved).questions[0].options[7].id,original[7]);
      await deleteText.locator('..').getByRole('button',{name:'Delete',exact:true}).click();await save();
      assert.deepEqual(nativeSingleChoiceCorrectOptionIds(choiceSolution(saved).correctAnswers[0]),[original[6],tenth,original[8]]);
      const bulk=page.locator('.native-bulk-generator');await bulk.locator('summary').click();await bulk.getByLabel('Paste numbered Multiple Choice content',{exact:true}).fill('1. Bulk tenth choice\n'+Array.from({length:10},(_,i)=>`${i===9?'*':''}Option 1.${i+1}`).join('\n'));await bulk.getByRole('checkbox',{name:/Replace existing semantic content/}).check();await bulk.getByRole('button',{name:'Generate content',exact:true}).click();await save();
      assert.equal(choiceInteraction(saved).questions[0].options.length,10);assert.equal(nativeSingleChoiceCorrectOptionIds(choiceSolution(saved).correctAnswers[0])[0],choiceInteraction(saved).questions[0].options[9].id);
      await record({kind,editor:true,addLimit:true,reorderDeleteAligned:true,bulkTen:true});
      for(const visual of [false,true])for(const multiple of [false,true]) {
        checkpoint=`${kind}-${visual?'visual':'text'}-${multiple?'multiple':'single'}-runtime`;
        await configure({choiceKind:kind,path:'published-student',count:10,visual,multiple});
        const expectedPair=tenOptionChoicePair(kind,{count:10,visual,multiple});
        const student=await choiceTargets(page,expectedPair,{visual,multiple});
        const first=student.question.options.find(o=>o.text==='Option 1.1'),tenth=student.question.options.find(o=>o.text==='Option 1.10');
        assert.notEqual(first.id,tenth.id);
        const correctIds=nativeSingleChoiceCorrectOptionIds(choiceSolution(expectedPair).correctAnswers[0]);
        assert.deepEqual(correctIds,student.question.options.filter(o=>multiple?['Option 1.7','Option 1.8','Option 1.9','Option 1.10'].includes(o.text):o.id===tenth.id).map(o=>o.id));
        await student.assertState();
        const option=n=>student.optionById(student.question.options.find(o=>o.text===`Option 1.${n}`).id);
        if(visual){await expectChoiceVisualReady(page,assetTypes,10);await geometry(`${checkpoint}-mounted`);}
        await option(10).focus();await page.keyboard.press('Space');
        if(visual){await geometry(`${checkpoint}-after-keyboard`);await geometry(`${checkpoint}-before-pointer`);}
        if(multiple)for(const n of [7,8,9])await option(n).click();
        if(visual){await option(1).click();if(multiple)await option(1).click();await option(10).click();if(multiple)await option(10).click();}
        if(visual)await expect(option(10)).toHaveAttribute('aria-pressed','true');else await expect(option(10)).toBeChecked();
        await student.assertState(false,correctIds);
        const pair=await page.evaluate(()=>corrections.pair),responses=await page.evaluate(()=>corrections.responses),question=choiceInteraction(pair).questions[0];
        const values=kind==='multi-part'?responses[pair.publicDocument.parts[0].interaction.sections[0].id]:responses;
        const childResponse={schemaVersion:'native-response.v1',items:[{id:question.id,value:values[question.id]}]};
        const envelope=kind==='multi-part'?{schemaVersion:'native-multi-response.v1',sections:[{id:pair.publicDocument.parts[0].interaction.sections[0].id,kind:'single-choice',response:childResponse}]}:childResponse;
        const capability=nativeAssignmentCapability(kind,pair.publicDocument),normalized=capability.normalizeResponse(pair.publicDocument,envelope);assert.ok(!normalized.error,normalized.error);assert.equal(capability.evaluateResponse(pair.publicDocument,pair.teacherDocument,normalized.payload).scorePercent,100);
        await configure({choiceKind:kind,path:'published-teacher',count:10,visual,multiple});
        const teacher=await choiceTargets(page,expectedPair,{visual,multiple,teacher:true});
        if(visual){await expectChoiceVisualReady(page,assetTypes,10);await geometry(`${checkpoint}-teacher-mounted`);}
        assert.equal(teacher.question.options.find(o=>o.text===tenth.text).id,tenth.id);
        await teacher.assertState();
        await page.getByRole('button',{name:'show-all',exact:true}).click();await teacher.assertState(true,correctIds);
        await page.getByRole('button',{name:'reset-activity',exact:true}).click();await teacher.assertState();
        const reordered=structuredClone(expectedPair),reorderedQuestion=choiceInteraction(reordered).questions[0];
        reorderedQuestion.options.reverse();
        const reorderedIds=reorderedQuestion.options.filter(o=>correctIds.includes(o.id)).map(o=>o.id);
        if(multiple)choiceSolution(reordered).correctAnswers[0].correctOptionIds=reorderedIds;
        await page.evaluate(pair=>corrections.setPair(pair),reordered);
        const reorderedTeacher=await choiceTargets(page,reordered,{visual,multiple,teacher:true});
        await reorderedTeacher.assertState();
        await page.getByRole('button',{name:'show-all',exact:true}).click();await reorderedTeacher.assertState(true,reorderedIds);
        await page.getByRole('button',{name:'reset-activity',exact:true}).click();await reorderedTeacher.assertState();
        if(visual){for(const id of reorderedIds)await reorderedTeacher.optionById(id).click();await reorderedTeacher.assertState(true,reorderedIds);await page.getByRole('button',{name:'reset-activity',exact:true}).click();await reorderedTeacher.assertState();}
        await record({kind,visual,multiple,questionId:student.question.id,firstOptionId:first.id,tenthOptionId:tenth.id,correctIds,reorderedIds,tenthKeyboardAndGrading:true,teacherReveal:true,reset:true,reorderIdentity:true,pointerReachability:visual});
      }
    }
    await runOldschoolChoicePointerCases({page,configure,targets:choiceTargets,geometry,assetTypes,record,setCheckpoint:value=>{checkpoint=value;}});
    for(const kind of ['single-choice','multi-part','oldschool-listening']) {
      checkpoint=`${kind}-bulk-hotspots-200-and-overflow`;saved=tenOptionChoicePair(kind,{count:10,visual:true,questionCount:20});revision=7;
      await configure({choiceKind:kind,path:'choice-editor',count:10,visual:true,multiple:false,questionCount:20});
      if(kind==='multi-part')await page.getByRole('button',{name:'Ten choices',exact:true}).click();
      await page.getByRole('tab',{name:'Visual',exact:true}).click();
      const initial=structuredClone(saved),source='SOURCE 1024x1100\nPANEL 1\n'+Array.from({length:20},(_,q)=>Array.from({length:10},(_,i)=>`${q+1}.${i+1} x=${41+i*90} y=${40+q*50} width=74 height=35`).join('\n')).join('\n');
      const importer=page.locator('.native-hotspot-bulk-importer');await importer.locator('summary').click();
      await importer.getByRole('textbox',{name:'Paste hotspot geometry',exact:true}).fill(source);
      await importer.getByRole('checkbox',{name:/Replace existing hotspots on listed panels/}).check();await importer.getByRole('button',{name:'Import hotspots',exact:true}).click();
      await expect(importer.getByRole('alert')).toHaveCount(0);await expect(importer.getByRole('status')).toContainText('200 existing IDs preserved');await save();
      const hotspots=choiceInteraction(saved).presentation.panels[0].hotspots;
      assert.equal(hotspots.length,200);assert.deepEqual(hotspots.map(h=>[h.id,h.questionId,h.optionId]),choiceInteraction(initial).presentation.panels[0].hotspots.map(h=>[h.id,h.questionId,h.optionId]));
      assert.equal(hotspots.find(h=>h.optionId===choiceInteraction(saved).questions[0].options[0].id).area.x,41);
      assert.equal(hotspots.find(h=>h.optionId===choiceInteraction(saved).questions[0].options[9].id).area.x,851);
      for(const invalid of ['1.11 x=0 y=0 width=1 height=1','21.1 x=0 y=0 width=1 height=1','1.10 x=0 y=0 width=1 height=1']){await importer.getByRole('textbox',{name:'Paste hotspot geometry',exact:true}).fill(source+'\n'+invalid);await importer.getByRole('button',{name:'Import hotspots',exact:true}).click();await expect(importer.getByRole('alert')).toContainText('Hotspots were not imported.');}
      await page.getByRole('tab',{name:'Content',exact:true}).click();const bulk=page.locator('.native-bulk-generator');await bulk.locator('summary').click();await bulk.getByRole('textbox',{name:'Paste numbered Multiple Choice content',exact:true}).fill('1. Overflow\n'+Array.from({length:11},(_,i)=>`${i===10?'*':''}Option 1.${i+1}`).join('\n'));await bulk.getByRole('checkbox',{name:/Replace existing semantic content/}).check();await bulk.getByRole('button',{name:'Generate content',exact:true}).click();await expect(bulk.getByRole('alert')).toContainText('no more than 10 options');
      await record({kind,hotspotCount:200,stableIds:true,distinctOrdinals:true,overflowRejected:true,eleventhOptionRejected:true});
    }
    assert.deepEqual(errors,[]);
  } catch(error) {
    await geometry('failure');
    await writeFile(`${output}/ten-option-failure.json`,JSON.stringify({checkpoint,error:error.stack,errors,config:await page.evaluate(()=>corrections.config),responses:await page.evaluate(()=>corrections.responses),html:await page.locator('main').innerHTML()},null,2));await page.screenshot({path:`${output}/ten-option-failure.png`});throw error;
  } finally {await context.close();await server.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const browser=await chromium.launch({headless:true});try{await runTenOptionChoiceRegressions(browser,process.env.NATIVE_REGRESSION_OUTPUT||'test-results/native-runtime-regressions',{diagnostic:process.env.CHOICE_VISUAL_DIAGNOSTIC==='1'});}finally{await browser.close();}}
