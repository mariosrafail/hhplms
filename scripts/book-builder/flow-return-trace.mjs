import { writeFile } from 'node:fs/promises';

// Synthetic-page observation only; no event interception, capture, or state repair.
export async function beginFlowReturnTrace(page, source, planned = null) {
  await source.evaluate((source, planned) => {
    const root=source.closest('.native-drag-drop'), bank=root.querySelector('.native-drag-drop-bank'),target=source.closest('[data-drag-drop-target-id]');
    const interaction=corrections.pair.publicDocument.parts[0].interaction.sections.find(s=>s.kind==='drag-drop').interaction;
    const word=interaction.words.find(w=>source.getAttribute('aria-label')===`Remove ${w.shortLabel}, ${w.text} from ${source.closest('[data-drag-drop-target-id]')?.getAttribute('aria-label')?.split(', contains ')[0]}`);
    const identify=node=>node?{tag:node.tagName,className:typeof node.className==='string'?node.className:'',label:node.getAttribute?.('aria-label'),wordId:node.dataset?.dragDropWordId,targetId:node.dataset?.dragDropTargetId}:null;
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const trace={planned,wordId:word?.id,sourceTargetId:source.closest('[data-drag-drop-target-id]')?.dataset.dragDropTargetId,events:[]};
    const targetSnapshot=()=>{
      const items=target.querySelector('.native-drag-drop-target-items'),bounds=rect(items),prefix=target.getAttribute('aria-label').split(', contains ')[0];
      const children=[...items.children].map(node=>{const box=rect(node),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2),label=node.getAttribute('aria-label');const word=interaction.words.find(w=>label===`Remove ${w.shortLabel}, ${w.text} from ${prefix}`||label===`${w.shortLabel}, ${w.text}`);return {wordId:word?.id,label,rect:box,hit:node===hit||node.contains(hit),hitElement:identify(hit),fontSize:parseFloat(getComputedStyle(node).fontSize)};});
      const state={targetId:target.dataset.dragDropTargetId,parent:rect(target),items:{...bounds,clientWidth:items.clientWidth,clientHeight:items.clientHeight,scrollWidth:items.scrollWidth,scrollHeight:items.scrollHeight},fitStatus:items.dataset.fitStatus,activeScale:items.style.getPropertyValue('--native-drag-drop-target-fit-scale'),metadataScale:items.dataset.fitScale,children,placedIds:children.map(c=>c.wordId),transitions:[items,...items.querySelectorAll('*')].map(node=>({property:getComputedStyle(node).transitionProperty,active:node.getAnimations().filter(a=>a.constructor.name==='CSSTransition').length}))};
      return {...state,signature:JSON.stringify(state)};
    };
    const record=(phase,event)=>{
      if(trace.events.length>=500)return;
      const box=rect(source),start=trace.planned?.start||{x:box.x+box.width/2,y:box.y+box.height/2},end=trace.planned?.end||{x:rect(bank).x+rect(bank).width/2,y:rect(bank).y+rect(bank).height/2};
      const point=event?{x:event.clientX,y:event.clientY}:start;
      const preview=document.querySelector('[data-drag-drop-drag-preview]');
      trace.events.push({phase,time:performance.now(),event:event?{type:event.type,pointerId:event.pointerId,buttons:event.buttons,button:event.button,x:event.clientX,y:event.clientY,target:identify(event.target)}:null,
        source:rect(source),sourceConnected:source.isConnected,bank:rect(bank),stage:rect(root.querySelector('.native-drag-drop-stage')),root:rect(root),mounted:root.__flowBankOriginal,
        targetFit:targetSnapshot(),sourceHit:source.contains(document.elementFromPoint(start.x,start.y)),endHitInBank:bank.contains(document.elementFromPoint(end.x,end.y)),
        hit:identify(document.elementFromPoint(point.x,point.y)),stack:document.elementsFromPoint(point.x,point.y).map(identify),
        preview:preview?{...identify(preview),returning:preview.dataset.returning||false,rect:rect(preview)}:null,
        bankOrder:[...bank.querySelectorAll('[data-drag-drop-word-id]')].map(n=>n.dataset.dragDropWordId),
        target:identify(target),
        captures:[...root.querySelectorAll('button')].filter(n=>n.hasPointerCapture(event?.pointerId||1)).map(identify),
        scrolls:[...function*(){for(let n=source;n;n=n.parentElement)yield n;}()].map(n=>({node:identify(n),left:n.scrollLeft,top:n.scrollTop}))});
    };
    const listener=event=>record(event.type,event);
    const types=['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'];
    types.forEach(type=>document.addEventListener(type,listener,true));
    const observer=new MutationObserver(()=>record('mutation'));
    observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['style','data-returning','data-dragging','data-empty','aria-label']});
    globalThis.flowReturnTrace=trace;
    globalThis.recordFlowReturnTrace=(phase,planned)=>{if(planned)trace.planned=planned;record(phase);};
    globalThis.finishFlowReturnTrace=()=>{record('final');observer.disconnect();types.forEach(type=>document.removeEventListener(type,listener,true));return trace;};
    record('before-source-bounding-box');
  },planned);
}

export async function saveFlowReturnTrace(page, output, checkpoint) {
  const trace=await page.evaluate(()=>globalThis.finishFlowReturnTrace?.());
  if(trace)await writeFile(`${output}/${checkpoint}-gesture.json`,JSON.stringify(trace,null,2));
}
