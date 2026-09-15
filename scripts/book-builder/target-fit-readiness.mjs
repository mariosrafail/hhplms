import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { expect } from '@playwright/test';
import { targetFitReadinessIssues,targetFitStableSignature } from './target-fit-readiness-state.mjs';

export async function expectTargetFitReady(page,{output,checkpoint,targetId,count=12}) {
  const invocation=randomUUID(),samples=[],started=performance.now();let previous=null,last=null,success=false;
  try {
    await expect.poll(async()=>{
      last=await page.evaluate(async({targetId,frames})=>{
        let frameTime=null;for(let i=0;i<frames;i++)frameTime=await new Promise(resolve=>requestAnimationFrame(resolve));
        const target=document.querySelector(`.native-multi-part-panel--flow [data-drag-drop-target-id="${targetId}"]`),element=target?.querySelector('.native-drag-drop-target-items');
        if(!element)return {missing:true};
        const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},bounds=rect(element);
        return {time:performance.now(),frameTime,targetId:target.dataset.dragDropTargetId,parent:rect(target),items:{...bounds,clientWidth:element.clientWidth,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight},
          activeScale:element.style.getPropertyValue('--native-drag-drop-target-fit-scale'),metadataScale:element.dataset.fitScale,status:element.dataset.fitStatus,
          children:[...element.children].map(node=>{const box=rect(node),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return {label:node.getAttribute('aria-label'),rect:box,fontSize:parseFloat(getComputedStyle(node).fontSize),contained:box.x>=bounds.x-1&&box.right<=bounds.right+1&&box.y>=bounds.y-1&&box.bottom<=bounds.bottom+1,hit:node===hit||node.contains(hit)};}),
          transitions:[element,...element.querySelectorAll('*')].map(node=>({property:getComputedStyle(node).transitionProperty,active:node.getAnimations().filter(a=>a.constructor.name==='CSSTransition').length}))};
      },{targetId,frames:previous?2:0});
      const issues=targetFitReadinessIssues(last,{targetId,count}),signature=issues.length?null:targetFitStableSignature(last),stable=signature!==null&&signature===previous;
      samples.push({elapsedMs:performance.now()-started,issues,stable,snapshot:last});previous=signature;return stable;
    },{timeout:5000,intervals:[0,16,32,50,100],message:checkpoint}).toBe(true);
    success=true;return last;
  } finally {await writeFile(`${output}/target-readiness-${checkpoint}-${invocation}.json`,JSON.stringify({checkpoint,invocation,success,samples},null,2),{flag:'wx'});}
}
