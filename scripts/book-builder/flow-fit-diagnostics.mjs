import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { runFlowBankRegressions } from './flow-bank-regressions.mjs';

assert.equal(process.versions.node.split('.')[0],'22','diagnostics must run inside the actual Node 22 process');
const output=process.env.NATIVE_REGRESSION_OUTPUT;
assert.ok(output,'explicit external evidence directory required');
await mkdir(output,{recursive:true});
const result={node:process.version,executable:process.execPath,variants:[]};
const browser=await chromium.launch({headless:true});
try {
  const refillOnly=process.env.FLOW_BANK_REFILL_DIAGNOSTIC==='1';
  const targetTimeline=process.env.FLOW_TARGET_TIMELINE==='1';
  for(const variant of targetTimeline?[{name:'target-passive',motion:'reduce',disableTransitions:false}]:refillOnly?[{name:'natural-hidden-refill',motion:'reduce',disableTransitions:false}]:[{name:'A-reduce',motion:'reduce',disableTransitions:false},{name:'B-reduce-no-transitions',motion:'reduce',disableTransitions:true},{name:'C-no-preference',motion:'no-preference',disableTransitions:false}]) {
    try {
      const resetOnly=process.env.FLOW_BANK_RESET_DIAGNOSTIC==='1';
      await runFlowBankRegressions(browser,`${output}/${variant.name}`,{fitDiagnostic:{...variant,refillOnly,resetOnly,targetTimeline,disableTransitions:resetOnly?false:variant.disableTransitions,disableBankTransitions:resetOnly&&variant.disableTransitions,targetOnly:targetTimeline||process.env.FLOW_FIT_TARGET_DIAGNOSTIC==='1'}});
      result.variants.push({...variant,outcome:'PASS'});
    } catch(error) {
      result.variants.push({...variant,outcome:'FAIL',message:error.message,stack:error.stack});
      if(variant.name!=='A-reduce') throw error;
    }
  }
} finally {
  await writeFile(`${output}/diagnostic-results.json`,JSON.stringify(result,null,2));
  await browser.close();
}
console.log(JSON.stringify(result));
