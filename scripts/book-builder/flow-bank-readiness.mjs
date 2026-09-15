import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { flowBankReadinessIssues,flowBankStableSignature } from './flow-bank-readiness-state.mjs';
import { stagePositioningBox } from './flow-bank-box-geometry.mjs';

export async function readFlowBankSnapshot(page,frames=0) {
  const snapshot=await page.evaluate(async frames=>{
    let frameTime=null;
    for(let i=0;i<frames;i++) frameTime=await new Promise(resolve=>requestAnimationFrame(resolve));
    const panel=document.querySelector('.native-multi-part-panel--flow');const root=panel?.querySelector('.native-drag-drop');
    const bank=root?.querySelector('.native-drag-drop-bank');const items=bank?.querySelector('.native-drag-drop-bank-items');
    if(!items)return {missing:true,time:performance.now(),frameTime};
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const bounds=rect(items),stage=root.querySelector('.native-drag-drop-stage'),stageRect=rect(stage),target=rect(root.querySelector('[data-drag-drop-target-id]'));
    const children=[...items.children].map(child=>{const r=rect(child),point={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(point.x,point.y);return {id:child.dataset.dragDropWordId,rect:r,point,fontSize:parseFloat(getComputedStyle(child).fontSize),contained:r.x>=bounds.x-1&&r.right<=bounds.right+1&&r.y>=bounds.y-1&&r.bottom<=bounds.bottom+1,hit:child===hit||child.contains(hit),hitElement:hit?.className};});
    const bankCss=getComputedStyle(bank),stageCss=getComputedStyle(stage);
    return {time:performance.now(),frameTime,visible:!panel.hidden && getComputedStyle(panel).display!=='none' && root.clientWidth>0&&root.clientHeight>0,
      instance:root.__flowBankInstance ?? root.__flowBankOriginal,children,empty:bank.dataset.empty,activeScale:items.style.getPropertyValue('--native-drag-drop-bank-fit-scale'),metadataScale:items.dataset.fitScale,status:items.dataset.fitStatus,
      panel:rect(panel),root:rect(root),bank:rect(bank),items:{...bounds,clientWidth:items.clientWidth,clientHeight:items.clientHeight,scrollWidth:items.scrollWidth,scrollHeight:items.scrollHeight},
      padding:[bankCss.paddingTop,bankCss.paddingRight,bankCss.paddingBottom,bankCss.paddingLeft],flowScrollTop:panel.scrollTop,
      scrollFits:items.scrollWidth<=items.clientWidth&&items.scrollHeight<=items.clientHeight,
      source:{width:stageRect.width,height:stageRect.height,stageBorderBox:stageRect,stageBorders:Object.fromEntries(['Left','Right','Top','Bottom'].map(side=>[side.toLowerCase(),parseFloat(stageCss[`border${side}Width`])])),stageClientWidth:stage.clientWidth,stageClientHeight:stage.clientHeight,stageClientLeft:stage.clientLeft,stageClientTop:stage.clientTop,stagePadding:[stageCss.paddingLeft,stageCss.paddingRight,stageCss.paddingTop,stageCss.paddingBottom],stageBoxSizing:stageCss.boxSizing,stageOverflow:[stageCss.overflowX,stageCss.overflowY],sourceWidth:stage.dataset.surfaceWidth,sourceHeight:stage.dataset.surfaceHeight,targetX:target.x-stageRect.x,targetY:target.y-stageRect.y,targetWidth:target.width,targetHeight:target.height},
      responses:globalThis.corrections?.responses,transitions:[bank,items,...items.querySelectorAll('*')].map(node=>({property:getComputedStyle(node).transitionProperty,duration:getComputedStyle(node).transitionDuration,active:node.getAnimations().filter(a=>a.constructor.name==='CSSTransition').length}))};
  },frames);
  if(!snapshot.missing)snapshot.source.stagePositioningBox=stagePositioningBox(snapshot.source.stageBorderBox,snapshot.source.stageBorders);
  return snapshot;
}

// One 5000ms deadline covers readiness and two subsequent rendered frames.
// Every sample is a single read-only browser evaluation; actions stay with callers.
export async function expectFlowBankReady(page,{output,checkpoint,...requirements}) {
  const invocation=randomUUID();
  const started=performance.now(),samples=[];let previous=null,last=null,success=false;
  try {
    await expect.poll(async()=>{
      last=await readFlowBankSnapshot(page,previous?2:0);
      const issues=flowBankReadinessIssues(last,requirements);
      const signature=issues.length?null:flowBankStableSignature(last);
      const stable=signature!==null && signature===previous;
      samples.push({elapsedMs:performance.now()-started,issues,stable,snapshot:last});
      previous=signature;
      return stable;
    },{timeout:5000,intervals:[0,16,32,50,100],message:checkpoint}).toBe(true);
    success=true;return last;
  } finally {
    await writeFile(`${output}/readiness-${checkpoint}-${invocation}.json`,JSON.stringify({checkpoint,invocation,success,elapsedMs:performance.now()-started,samples},null,2),{flag:'wx'});
  }
}
