export function targetFitReadinessIssues(s,{targetId,count=12}={}) {
  if(!s||s.missing)return ['missing'];
  const issues=[],require=(ok,name)=>{if(!ok)issues.push(name);};
  require(s.targetId===targetId,'identity');require(s.children.length===count,'count');
  require(s.parent.width>0&&s.parent.height>0&&s.items.width>0&&s.items.height>0,'geometry');
  require(s.status==='fit','status');
  const active=Number(s.activeScale),metadata=Number(s.metadataScale);
  require(typeof s.activeScale==='string'&&s.activeScale.trim()!==''&&Number.isFinite(active)&&active>0&&active<=1,'active-scale');
  require(typeof s.metadataScale==='string'&&s.metadataScale.trim()!==''&&Number.isFinite(metadata)&&metadata>0&&Math.abs(active-metadata)<=.000051,'metadata');
  require(s.items.scrollWidth<=s.items.clientWidth&&s.items.scrollHeight<=s.items.clientHeight,'scroll');
  require(s.children.every(c=>c.contained),'containment');require(s.children.every(c=>c.hit),'hits');
  require(s.children.every(c=>c.fontSize>=7.99),'font-minimum');
  require(s.transitions.every(t=>t.property==='none'&&t.active===0),'transitions');
  return issues;
}
export function targetFitStableSignature({time,frameTime,...snapshot}) {return JSON.stringify(snapshot);}
