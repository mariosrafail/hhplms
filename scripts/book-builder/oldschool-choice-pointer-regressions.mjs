import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {tenOptionChoicePair,choiceSolution,choiceInteraction} from '../../tests/fixtures/ten-option-choice.js';
import {nativeSingleChoiceCorrectOptionIds} from '../../src/data/native-activities/nativeSingleChoice.js';
import {normalizeNativeRuntimePublicDocument} from '../../src/data/native-activities/nativeActivityRuntimeValidation.js';
import {expectChoiceVisualReady} from './choice-visual-geometry.mjs';

export async function runOldschoolChoicePointerCases({page,configure,targets,geometry,assetTypes,record,setCheckpoint}) {
  const cases=[...[2,3,4,5,6,10].map(count=>({count,sourceHeight:1100,width:1440,scale:1})),{count:10,sourceHeight:582,width:1440,scale:1},...[2,6,10].flatMap(count=>[582,1100].map(sourceHeight=>({count,sourceHeight,width:760,scale:.65})))];
  for(const setup of cases)for(const multiple of [false,true])for(const teacher of [false,true]) {
    const label=`oldschool-pointer-${setup.count}-${setup.sourceHeight}-${setup.width}-${teacher?'teacher':'student'}-${multiple?'multiple':'single'}`;
    setCheckpoint(label);await page.setViewportSize({width:setup.width,height:1000});
    const config={...setup,multiple,visual:true,supporting:3,choiceKind:'oldschool-listening',path:teacher?'published-teacher':'published-student'};
    await configure(config);
    const pair=tenOptionChoicePair('oldschool-listening',config);
    normalizeNativeRuntimePublicDocument(pair.publicDocument,{kind:'oldschool-listening'});
    const current=await targets(page,pair,{visual:true,multiple,teacher});
    await expectChoiceVisualReady(page,assetTypes,setup.count);await geometry(`${label}-mounted`);
    await expect(page.getByRole('group',{name:'Visual panel navigation',exact:true})).toHaveCount(0);
    const audio=page.locator('.native-oldschool-listening audio');await expect.poll(()=>audio.evaluate(node=>node.readyState),{timeout:5000}).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.native-oldschool-listening-error')).toHaveCount(0);
    await current.assertState();
    const correctIds=nativeSingleChoiceCorrectOptionIds(choiceSolution(pair).correctAnswers[0]);
    const first=current.question.options[0],last=current.question.options.at(-1);
    // Every case uses physical pointer selection, including legacy single mode.
    await current.optionById(first.id).click();
    if(teacher){await page.getByRole('button',{name:'reset-activity',exact:true}).click();await current.assertState();}
    else if(multiple)await current.optionById(first.id).click();
    for(const id of correctIds)await current.optionById(id).click();
    await current.assertState(teacher,correctIds);
    const before=await page.evaluate(()=>({responses:corrections.responses,root:document.querySelector('.native-oldschool-question-session')}));
    await page.evaluate(()=>{globalThis.__oldschoolChoiceSession=document.querySelector('.native-oldschool-question-session');});
    await page.getByRole('button',{name:'next-panel',exact:true}).click();await expect(page.locator('.native-oldschool-listening')).toHaveAttribute('data-view','page');
    await page.getByRole('button',{name:'previous-panel',exact:true}).click();await expect(page.locator('.native-oldschool-listening')).toHaveAttribute('data-view','questions');
    assert.equal(await page.evaluate(()=>globalThis.__oldschoolChoiceSession===document.querySelector('.native-oldschool-question-session')),true);
    await expectChoiceVisualReady(page,assetTypes,setup.count);await current.assertState(teacher,correctIds);
    if(!teacher)assert.deepEqual(await page.evaluate(()=>corrections.responses),before.responses);
    await page.getByRole('button',{name:'Read the clue',exact:true}).click();await expect(page.locator('[data-audio-focus="true"]')).toBeVisible();await page.keyboard.press('Escape');
    await expectChoiceVisualReady(page,assetTypes,setup.count);await current.assertState(teacher,correctIds);
    assert.equal(await audio.evaluate(node=>node.paused),true,'MC/focus must not activate the listening player');
    assert.equal(await audio.evaluate(node=>node.currentTime),0);
    if(teacher){await page.getByRole('button',{name:'reset-activity',exact:true}).click();await current.assertState();await page.getByRole('button',{name:'show-all',exact:true}).click();await current.assertState(true,correctIds);await page.getByRole('button',{name:'reset-activity',exact:true}).click();await current.assertState();}
    await geometry(`${label}-finished`);await record({...setup,multiple,teacher,correctIds,firstOptionId:first.id,lastOptionId:last.id,pointer:true,preservedSession:true,readableFocus:true,playerUnaffected:true});
  }
  await page.setViewportSize({width:1440,height:1000});
}
