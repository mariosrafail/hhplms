import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
import { createServer } from "../../tests/_vite-test-server.mjs";
import { runFlowBankLifecycle } from "./flow-bank-lifecycle-regressions.mjs";
import { captureFlowBankDiagnostic } from "./flow-bank-diagnostics.mjs";
import { flowFitDiagnosticPlugin } from "./flow-fit-diagnostic-plugin.mjs";
import { runFlowFitContractRegressions } from "./flow-fit-contract-regressions.mjs";

export async function flowBankGeometry(page) {
  return page.locator('.native-multi-part-panel--flow .native-drag-drop').evaluate((root) => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right }; };
    const describe = (node) => ({ className:node.className, ...rect(node), clientHeight:node.clientHeight, scrollHeight:node.scrollHeight, scrollTop:node.scrollTop, overflowX:getComputedStyle(node).overflowX, overflowY:getComputedStyle(node).overflowY });
    const bank = root.querySelector('.native-drag-drop-bank');
    const ancestors = []; for (let node = bank.parentElement; node; node = node.parentElement) ancestors.push(describe(node));
    const items = [...bank.querySelectorAll('[data-drag-drop-word-id]')].map((node) => { const r = rect(node); const hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return { id:node.dataset.dragDropWordId, ...r, hit:node===hit || node.contains(hit) }; });
    return { root:describe(root), workspace:describe(root.querySelector('.native-drag-drop-workspace')), bank:describe(bank), stage:rect(root.querySelector('.native-drag-drop-stage')), image:rect(root.querySelector('.native-drag-drop-artwork')), target:rect(root.querySelector('.native-drag-drop-target')), items, ancestors, occupied:root.querySelectorAll('[data-occupied]').length, revealed:root.querySelectorAll('[data-revealed]').length };
  });
}

export async function runFlowBankRegressions(browser, output, { reproduce = false, fitDiagnostic = null } = {}) {
  await mkdir(output, { recursive:true });
  assert.equal(process.versions.node.split('.')[0],'22');
  await writeFile(`${output}/node-process.json`,JSON.stringify({version:process.version,executable:process.execPath},null,2));
  const provider = { name:'flow-bank-fixture-provider', enforce:'pre',
    resolveId:id => ['virtual:component-publication','virtual:hosted-native-drafts'].includes(id) ? `\0${id}` : null,
    load:id => id==='\0virtual:hosted-native-drafts' ? "export const hostedNativeDraftAssetUrl=(_,id)=>globalThis.corrections.assetUrl(id); export const hostedNativeDraftTeacherAssetUrl=()=>'/private-answer';" : id==='\0virtual:component-publication' ? "export const publishedNativeAssetUrl=(_,ref)=>globalThis.corrections.assetUrl(ref.assetId); export const publishedNativeTeacherAssetUrl=()=>'/private-answer'; export const loadPublishedNativeTeacherDocument=async()=>globalThis.corrections.pair.teacherDocument;" : null };
  const server = await createServer({ configFile:false, plugins:[provider,...(fitDiagnostic?[flowFitDiagnosticPlugin(fitDiagnostic)]:[]),react()], optimizeDeps:{entries:['tests/fixtures/native-runtime-regressions/runtime-corrections.html']}, server:{host:'127.0.0.1',port:0}, logLevel:'error' });
  await server.listen();
  const context = await browser.newContext({ viewport:{width:1440,height:1000}, reducedMotion:fitDiagnostic?.motion || 'reduce' });
  if (fitDiagnostic) await context.addInitScript(()=>{globalThis.flowFitTrace=[];globalThis.flowBankTrace=[];});
  const page = await context.newPage(); const evidence=[]; const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const images = {};
  for (const [slot,width,height] of [['shared',1024,582],['background',1024,1100],['overlay',150,100],['readable',1000,1800]]) images[slot]=await sharp({create:{width,height,channels:3,background:'#d6eafa'}}).png().toBuffer();
  await page.route('**/correction-assets/*',route=>route.fulfill({contentType:'image/png',body:images[new URL(route.request().url()).pathname.split('/').pop()] || images.background}));
  try {
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/native-runtime-regressions/runtime-corrections.html`);
    await page.waitForFunction(()=>Boolean(globalThis.corrections));
    const css = await Promise.all(['src/components/native-drag-drop/nativeDragDrop.css','src/components/native-multi-part/nativeMultiPart.css'].map(path=>readFile(path,'utf8')));
    for (const order of ['drag-last','flow-last']) {
      await page.evaluate(()=>document.querySelectorAll('[data-flow-order]').forEach(node=>node.remove()));
      const style=await page.addStyleTag({content:order==='flow-last' ? css.join('\n') : [...css].reverse().join('\n')}); await style.evaluate(node=>node.dataset.flowOrder='true');
      await page.evaluate(()=>corrections.configure({kind:'flow-bank',path:'teacher',height:650,scale:1}));
      await expect(page.locator('.native-multi-part-panel--flow')).toBeHidden();
      await page.getByRole('button',{name:'next-panel',exact:true}).click();
      await expect(page.locator('.native-multi-part-panel--flow')).toBeVisible();
      await page.locator('.native-multi-part-panel--flow .native-drag-drop-bank').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const geometry=await flowBankGeometry(page); evidence.push({order,...geometry});
      await page.screenshot({path:`${output}/flow-bank-${reproduce?'before':'after'}-${order}.png`});
      if (!reproduce) { assert.equal(geometry.items.length,12); assert.ok(geometry.items.every(item=>item.hit),JSON.stringify(geometry)); assert.ok(geometry.root.height<=540); }
    }
    if (!reproduce) {
      await page.evaluate(()=>document.querySelectorAll('[data-flow-order]').forEach(node=>node.remove()));
      const html = await readFile('dist/index.html','utf8');
      const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="(\/assets\/[^"/]+\.css)"/g)].map(match=>match[1]);
      assert.ok(styles.length,'the built LMS entrypoint must identify its stylesheets');
      const assets = await Promise.all(styles.map(async path=>{ const content=await readFile(`dist${path}`,'utf8'); return {path,content,sha256:createHash('sha256').update(content).digest('hex')}; }));
      const productionCss = assets.map(asset=>asset.content).join('\n');
      assert.ok(productionCss.includes('native-multi-part-panel--flow'));
      const stylesheet={content:productionCss,mode:'Vite component fixture with built LMS entrypoint CSS',assets:assets.map(({path,sha256})=>({path,sha256}))};
      if(!fitDiagnostic) await runFlowFitContractRegressions(page,output,stylesheet);
      await runFlowBankLifecycle(page,output,stylesheet,fitDiagnostic);
    }
    assert.deepEqual(errors,[]);
    await writeFile(`${output}/flow-bank-${reproduce?'before':'after'}-geometry.json`,JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence.map(({order,root,bank,workspace,items,occupied,revealed})=>({order,root:root.height,workspace:workspace.height,bankTop:bank.y,items:items.length,hitItems:items.filter(item=>item.hit).length,occupied,revealed}))));
  } catch (error) {
    try { await captureFlowBankDiagnostic(page,output,error.flowBankAssetsCleaned?'failure-after-cleanup':'failure-before-teardown'); } catch (diagnosticError) { console.error('Diagnostic capture failed:',diagnosticError); }
    throw error;
  } finally {
    if (fitDiagnostic) await writeFile(`${output}/fit-transitions.json`,JSON.stringify(await page.evaluate(()=>globalThis.flowFitTrace),null,2));
    if (fitDiagnostic) await writeFile(`${output}/bank-box-transitions.json`,JSON.stringify(await page.evaluate(()=>globalThis.flowBankTrace),null,2));
    await context.close(); await server.close();
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const browser=await chromium.launch({headless:true});
  try { await runFlowBankRegressions(browser,process.env.NATIVE_REGRESSION_OUTPUT || 'test-results/native-runtime-regressions',{reproduce:process.env.FLOW_BANK_REPRODUCE==='1'}); } finally { await browser.close(); }
}
