import { expect } from '@playwright/test';

export async function expectChoiceVisualReady(page,assetTypes,count) {
  await expect.poll(async()=>{
    const snapshot=await readChoiceVisualGeometry(page,assetTypes),issues=[];
    if(snapshot.panels.length!==1)return ['expected one visible panel'];
    const panel=snapshot.panels[0],stage=panel.stage?.rect,img=panel.image,source=panel.sourcePanel;
    if(!stage||stage.width<=0||stage.height<=0||panel.slot.rect.height<=0)issues.push('collapsed stage/slot');
    if(!img?.complete||img.decode!=='ok'||img.naturalWidth!==source.sourceWidth||img.naturalHeight!==source.sourceHeight||img.rect.width<=0||img.rect.height<=0)issues.push('image loading/dimensions');
    if(stage&&Math.abs(stage.width/stage.height-source.sourceWidth/source.sourceHeight)>.005)issues.push('aspect ratio');
    if(panel.hotspots.length!==count)issues.push('hotspot count');
    for(const hotspot of panel.hotspots) {
      if(hotspot.bindings.length!==1){issues.push('non-unique binding');continue;}
      if(!hotspot.hit||hotspot.clipped.width<hotspot.rect.width-.5||hotspot.clipped.height<hotspot.rect.height-.5)issues.push(`clipped/missed ${hotspot.bindings[0].optionId}`);
      if(stage&&stage.width>0){const area=hotspot.bindings[0].area,expected={x:stage.x+area.x/source.sourceWidth*stage.width,y:stage.y+area.y/source.sourceHeight*stage.height,width:area.width/source.sourceWidth*stage.width,height:area.height/source.sourceHeight*stage.height};for(const key of ['x','y','width','height'])if(Math.abs(hotspot.rect[key]-expected[key])>1)issues.push(`alignment ${key}`);}
    }
    return issues;
  },{timeout:5000,message:'Visible source-aligned image and every hotspot center must be reachable'}).toEqual([]);
}

// Read-only failure evidence: canonical bindings, clipping and exact center hits.
export async function readChoiceVisualGeometry(page,assetTypes={}) {
  return page.evaluate(async assetTypes=>{
    const pair=globalThis.corrections.pair,documentPair=pair.publicDocument;
    const interaction=documentPair.kind==='multi-part'?documentPair.parts[0].interaction.sections[0].interaction:documentPair.parts[0].interaction;
    const rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
    const identity=node=>node?{tag:node.tagName,className:node.getAttribute('class'),role:node.getAttribute('role'),label:node.getAttribute('aria-label')}:null;
    const describe=node=>{
      const css=getComputedStyle(node);
      return {...identity(node),rect:rect(node.getBoundingClientRect()),clientRects:[...node.getClientRects()].map(rect),client:[node.clientWidth,node.clientHeight],offset:[node.offsetWidth,node.offsetHeight],scroll:[node.scrollWidth,node.scrollHeight],scrollOffsets:[node.scrollLeft,node.scrollTop],hidden:node.hidden,
        css:Object.fromEntries(['width','height','minWidth','minHeight','maxWidth','maxHeight','display','gridTemplateRows','position','inset','overflow','overflowX','overflowY','pointerEvents','zIndex','transform','transformOrigin','aspectRatio'].map(key=>[key,css[key]]))};
    };
    const roots=[...document.querySelectorAll('main [data-native-single-choice-presentation="visual"]')];
    const panels=[];
    for(const root of roots)for(const panel of root.querySelectorAll('.native-single-choice-visual-panel')) {
      const stage=panel.querySelector('.native-single-choice-visual-stage'),slot=panel.querySelector('.native-single-choice-stage-slot'),img=stage?.querySelector('img')||panel.closest('.native-multi-part-panel')?.querySelector('.native-multi-part-background');
      const chain=[];for(let node=img||stage||panel;node&&node.tagName!=='MAIN';node=node.parentElement)chain.unshift(describe(node));
      let decode='missing';if(img){try{await img.decode();decode='ok';}catch(error){decode=error.name;}}
      const sourcePanel=interaction.presentation?.panels[panels.length];
      const reference=documentPair.assets.find(asset=>asset.slot===sourcePanel?.backgroundAssetSlot);
      const hotspots=[...panel.querySelectorAll('.native-single-choice-hotspot')].map(node=>{
        const label=node.getAttribute('aria-label');
        const bindings=sourcePanel?.hotspots.filter(h=>{const q=interaction.questions.find(q=>q.id===h.questionId),o=q?.options.find(o=>o.id===h.optionId);return `${q?.prompt}: ${o?.text}`===label;})||[];
        const r=node.getBoundingClientRect(),center={x:r.x+r.width/2,y:r.y+r.height/2};
        let clipped={left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)};
        const clipping=[];
        for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement){const css=getComputedStyle(ancestor),a=ancestor.getBoundingClientRect();const x=css.overflowX!=='visible',y=css.overflowY!=='visible';if(x||y){clipping.push(describe(ancestor));if(x){clipped.left=Math.max(clipped.left,a.left);clipped.right=Math.min(clipped.right,a.right);}if(y){clipped.top=Math.max(clipped.top,a.top);clipped.bottom=Math.min(clipped.bottom,a.bottom);}}}
        const hit=document.elementFromPoint(center.x,center.y);
        return {...describe(node),bindings,center,hit:hit===node||node.contains(hit),hitElement:identity(hit),elementsFromPoint:document.elementsFromPoint(center.x,center.y).map(identity),clipped:{...clipped,width:Math.max(0,clipped.right-clipped.left),height:Math.max(0,clipped.bottom-clipped.top)},clipping,pressed:node.getAttribute('aria-pressed'),answerState:node.getAttribute('data-answer-state')};
      });
      panels.push({sourcePanel,chain,slot:slot?describe(slot):null,stage:stage?describe(stage):null,image:img?{...describe(img),complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,decode,assetSlot:reference?.slot,mime:assetTypes[reference?.slot]||null}:null,hotspots});
    }
    return {time:performance.now(),activityId:documentPair.activityId,config:globalThis.corrections.config,responses:globalThis.corrections.responses,viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},panels,players:[...document.querySelectorAll('.native-oldschool-listening-player-anchor')].map(describe),media:[...document.querySelectorAll('main audio')].map(node=>({paused:node.paused,currentTime:node.currentTime,readyState:node.readyState,error:node.error?.code||null})),mediaErrors:[...document.querySelectorAll('.native-oldschool-listening-error')].map(node=>({...describe(node),text:node.textContent}))};
  },assetTypes);
}
