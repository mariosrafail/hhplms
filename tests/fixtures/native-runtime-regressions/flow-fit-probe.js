// Loaded only by the explicit diagnostic Vite transform, never by product code.
export function recordFitProbe(element, property, checkpoint) {
  if (!globalThis.flowFitTrace || !element.closest('.native-multi-part-panel--flow') || !element.children.length) return;
  const rect = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
  const bounds=rect(element);
  const childrenContained=[...element.children].every(node=>{const r=rect(node);return r.x>=bounds.x-1 && r.right<=bounds.right+1 && r.y>=bounds.y-1 && r.bottom<=bounds.bottom+1;});
  const nodes=[element,...element.querySelectorAll('*')].map(node=>{
    const css=getComputedStyle(node);
    return {tag:node.tagName,className:node.className,id:node.dataset.dragDropWordId||node.dataset.dragDropTargetText,
      requestedScale:element.style.getPropertyValue(property),computedScale:css.getPropertyValue(property),
      css:Object.fromEntries(['transition-property','transition-duration','transition-delay','font-size','padding-top','padding-right','padding-bottom','padding-left','gap'].map(name=>[name,css.getPropertyValue(name)])),
      rect:rect(node),clientWidth:node.clientWidth,clientHeight:node.clientHeight,scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight,
      animations:node.getAnimations?.().map(animation=>({type:animation.constructor.name,property:animation.transitionProperty,playState:animation.playState,currentTime:animation.currentTime,timing:animation.effect?.getComputedTiming(),keyframes:animation.effect?.getKeyframes()}))||[]};
  });
  globalThis.flowFitTrace.push({checkpoint,property,time:performance.now(),requestedScale:element.style.getPropertyValue(property),fitStatus:element.dataset.fitStatus,
    scrollFits:element.scrollWidth<=element.clientWidth && element.scrollHeight<=element.clientHeight,childrenContained,nodes});
}

export function writeFitProbe(element, property, value) {
  recordFitProbe(element,property,'before-scale-write');
  element.style.setProperty(property,value);
  recordFitProbe(element,property,'after-scale-write');
}

export function recordBankProbe(items, checkpoint, extra = {}) {
  if (!globalThis.flowBankTrace || !items?.closest('.native-multi-part-panel--flow')) return;
  const bank=items.parentElement, root=bank.closest('.native-drag-drop');
  const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const describe=node=>{const css=getComputedStyle(node);return {className:node.className,rect:rect(node),inlineStyle:node.getAttribute('style'),empty:node.dataset.empty,
    clientWidth:node.clientWidth,clientHeight:node.clientHeight,scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight,scrollTop:node.scrollTop,
    css:Object.fromEntries(['width','height','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-bottom-width','transition-property','transition-duration','transition-delay'].map(k=>[k,css.getPropertyValue(k)])),
    animations:node.getAnimations().map(a=>({type:a.constructor.name,property:a.transitionProperty,currentTime:a.currentTime,playState:a.playState,keyframes:a.effect?.getKeyframes()}))};};
  const bounds=rect(items);
  const children=[...items.children].map(node=>{const r=rect(node),point={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(point.x,point.y);return {id:node.dataset.dragDropWordId,rect:r,point,hit:node===hit||node.contains(hit),hitElement:hit?.className,contained:r.x>=bounds.x-1&&r.right<=bounds.right+1&&r.y>=bounds.y-1&&r.bottom<=bounds.bottom+1};});
  globalThis.flowBankTrace.push({checkpoint,lifecycle:globalThis.flowFitCheckpoint,time:performance.now(),observedFrame:globalThis.flowObservedFrame,...extra,bank:describe(bank),items:describe(items),root:describe(root),runtimeHeight:root.style.getPropertyValue('--native-drag-drop-runtime-bank-height'),scale:items.style.getPropertyValue('--native-drag-drop-bank-fit-scale'),status:items.dataset.fitStatus,children,scrollFits:items.scrollWidth<=items.clientWidth&&items.scrollHeight<=items.clientHeight,childrenContained:children.every(c=>c.contained)});
}
