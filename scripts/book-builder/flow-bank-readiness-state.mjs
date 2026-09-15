export function flowBankReadinessIssues(s, {count,instance,order,baseline,responses}={}) {
  if(!s || s.missing) return ['missing'];
  const issues=[];const require=(ok,name)=>{if(!ok)issues.push(name);};
  require(s.visible,'visible');require(s.instance===instance,'instance');
  require(s.children.length===count,'count');require(s.empty===String(count===0),'empty');
  require(s.transitions.every(t=>t.property==='none' && t.active===0),'transitions');
  require(s.flowScrollTop===0 && s.root.height<=540.1 && s.bank.y>=s.panel.y && s.bank.bottom<=s.panel.bottom+1,'geometry');
  if(count===0) require(s.bank.height===24,'empty-height');
  else {
    const scale=Number(s.activeScale);
    require(s.activeScale.trim()!=='' && Number.isFinite(scale) && scale>0 && scale<=1,'active-scale');
    require(Math.abs(Number(s.metadataScale)-scale)<=.000051,'scale-metadata');
    require(s.status==='fit' && s.scrollFits && s.children.every(c=>c.contained),'containment');
    require(s.children.every(c=>c.hit),'hits');require(s.children.every(c=>c.fontSize>=7.99),'font-minimum');
  }
  if(order) require(JSON.stringify(s.children.map(c=>c.id))===JSON.stringify(order),'order');
  if(responses!==undefined) require(JSON.stringify(s.responses)===JSON.stringify(responses),'responses');
  if(baseline) {
    for(const [name,actual,expected] of [['bank-width',s.bank.width,baseline.bank.width],['bank-height',s.bank.height,baseline.bank.height],['items-width',s.items.width,baseline.items.width],['items-height',s.items.height,baseline.items.height]]) require(actual===expected,name);
    require(JSON.stringify(s.padding)===JSON.stringify(baseline.padding),'padding');
    require(JSON.stringify(s.source)===JSON.stringify(baseline.source),'source-scale-alignment');
  }
  return issues;
}

export function flowBankStableSignature(s) {
  return JSON.stringify([s.instance,s.children,s.empty,s.activeScale,s.metadataScale,s.status,s.bank,s.items,s.padding,s.source,s.responses,s.transitions]);
}
