export function targetFitSnapshot(element) {
  if(!element)return {missing:true};
  const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const parent=element.closest('[data-drag-drop-target-id]'),bounds=rect(element);
  return {time:performance.now(),targetId:parent?.dataset.dragDropTargetId,parent:rect(parent),items:{...bounds,clientWidth:element.clientWidth,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight},
    activeScale:element.style.getPropertyValue('--native-drag-drop-target-fit-scale'),metadataScale:element.dataset.fitScale,status:element.dataset.fitStatus,fontSetStatus:document.fonts.status,
    children:[...element.children].map(node=>{const box=rect(node),point={x:box.x+box.width/2,y:box.y+box.height/2},hit=document.elementFromPoint(point.x,point.y);return {label:node.getAttribute('aria-label'),rect:box,fontSize:parseFloat(getComputedStyle(node).fontSize),contained:box.x>=bounds.x-1&&box.right<=bounds.right+1&&box.y>=bounds.y-1&&box.bottom<=bounds.bottom+1,hit:node===hit||node.contains(hit),point,hitElement:hit?{tag:hit.tagName,className:hit.className}:null};}),
    transitions:[element,...element.querySelectorAll('*')].map(node=>({property:getComputedStyle(node).transitionProperty,active:node.getAnimations().filter(a=>a.constructor.name==='CSSTransition').length}))};
}

export function recordTargetFit(element,phase,extra={}) {
  const trace=globalThis.targetFitTimeline;
  if(!trace||!element?.classList.contains('native-drag-drop-target-items')||trace.events.length>=1000)return;
  trace.events.push({phase,frame:trace.frame,...extra,snapshot:targetFitSnapshot(element)});
}
