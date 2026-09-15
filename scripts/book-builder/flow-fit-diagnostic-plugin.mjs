export function flowFitDiagnosticPlugin({targetTimeline=false}={}) {
  return {name:'flow-fit-observation-only',enforce:'pre',transform(source,id) {
    if (!id.replaceAll('\\','/').endsWith('/native-drag-drop/NativeDragDropSurface.jsx')) return null;
    if(targetTimeline) {
      const start=source.indexOf('function useContainedContentFit('),end=source.indexOf('\nfunction TargetItems(',start);
      let hook=source.slice(start,end);
      hook=hook.replace('const fit = () => {','const measuredFit = () => { recordTargetFit(element,"fit-entry"); fitContainedContent(element, { property, sampleSelector, containChildren }); recordTargetFit(element,"fit-exit"); };\n    const fit = (trigger) => { recordTargetFit(element,"fit-request",{trigger:trigger?.type||"callback",scheduledFrame:frame});');
      hook=hook.replaceAll('if (frame !== null) globalThis.cancelAnimationFrame?.(frame);','if (frame !== null) { recordTargetFit(element,"cancel-frame",{scheduledFrame:frame}); globalThis.cancelAnimationFrame?.(frame); }');
      hook=hook.replace('element.dataset.fitStatus = "pending";','element.dataset.fitStatus = "pending"; recordTargetFit(element,"pending");');
      hook=hook.replace('frame = null; fitContainedContent(element, { property, sampleSelector, containChildren });','frame = null; measuredFit();');
      hook=hook.replace('if (frame === null) fitContainedContent(element, { property, sampleSelector, containChildren });','recordTargetFit(element,"scheduled",{scheduledFrame:frame}); if (frame === null) measuredFit();');
      hook=hook.replace('new ResizeObserver(fit)','new ResizeObserver(entries=>{recordTargetFit(element,"resize-observer");fit(entries);})');
      hook=hook.replace('fonts?.ready?.then(fit)','fonts?.ready?.then(()=>{recordTargetFit(element,"fonts-ready");fit();})');
      return {code:'import {recordTargetFit,targetFitSnapshot} from "/tests/fixtures/native-runtime-regressions/target-fit-probe.js";\n'+source.slice(0,start)+hook+source.slice(end)+'\nglobalThis.readTargetFitSnapshot=()=>targetFitSnapshot(document.querySelector(".native-multi-part-panel--flow .native-drag-drop-target-items"));',map:null};
    }
    const start=source.indexOf('function fitContainedContent(');
    const end=source.indexOf('\nfunction useContainedContentFit(',start);
    let helper=source.slice(start,end).replaceAll('element.style.setProperty(property,','writeFitProbe(element, property,');
    helper=helper.replace('const fits = () => containedContentMeasurement(element, { containChildren }).fits;',
      'const fits = () => { recordFitProbe(element, property, "decision"); return containedContentMeasurement(element, { containChildren }).fits; };');
    helper=helper.replace('element.dataset.fitStatus = fits() ? "fit" : "overflow";',
      'element.dataset.fitStatus = fits() ? "fit" : "overflow"; recordFitProbe(element, property, "committed"); requestAnimationFrame(() => requestAnimationFrame(() => recordFitProbe(element, property, "next-rendered-frame")));');
    let code=source.slice(0,start)+helper+source.slice(end);
    code=code.replace('if (!active || !root.clientWidth || !root.clientHeight) return;', 'recordBankProbe(items,"measure-entry"); if (!active || !root.clientWidth || !root.clientHeight) return;');
    for(const [statement,label] of [
      ['bank.dataset.empty = String(!items.children.length);','empty-changed'],
      ['bank.style.removeProperty("padding-right");','padding-right-cleared'],
      ['bank.style.height = `${configured}px`;','temporary-bank-height'],
      ['items.style.height = `${Math.max(1, configured - inset)}px`;','temporary-items-height'],
      ['else items.style.removeProperty("--native-drag-drop-bank-fit-scale");','fit-completed'],
      ['items.style.removeProperty("height");','temporary-heights-removed'],
    ]) code=code.replace(statement,statement+` recordBankProbe(items,"${label}");`);
    code=code.replace('const inset = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);', '$& recordBankProbe(items,"inset-calculated",{inset});');
    code=code.replace('recordBankProbe(items,"temporary-heights-removed");','recordBankProbe(items,"temporary-heights-removed"); requestAnimationFrame(()=>requestAnimationFrame(()=>recordBankProbe(items,"next-rendered-frame")));');
    code=code.replace('active = false; cancelAnimationFrame(frame); observer?.disconnect();','recordBankProbe(items,"effect-cleanup"); active = false; cancelAnimationFrame(frame); observer?.disconnect();');
    code=code.replace('const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);','const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(()=>{recordBankProbe(items,"resize-observer");schedule();});');
    code=code.replace('cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);','recordBankProbe(items,"measure-scheduled"); cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);');
    code+='\nglobalThis.flowBankObserve=checkpoint=>recordBankProbe(document.querySelector(".native-multi-part-panel--flow .native-drag-drop-bank-items"),checkpoint);';
    return {code:'import {recordFitProbe,writeFitProbe,recordBankProbe} from "/tests/fixtures/native-runtime-regressions/flow-fit-probe.js";\n'+code,map:null};
  }};
}
