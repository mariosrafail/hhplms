export function stagePositioningBox(rect,border) {
  return {x:rect.x+border.left,y:rect.y+border.top,width:rect.width-border.left-border.right,height:rect.height-border.top-border.bottom};
}
export function expectedFlowTarget(source,authored) {
  const box=source.stagePositioningBox,outer=source.stageBorderBox;
  const scaleX=box.width/authored.surface.width,scaleY=box.height/authored.surface.height;
  return {targetX:box.x-outer.x+authored.target.x*scaleX,targetY:box.y-outer.y+authored.target.y*scaleY,targetWidth:authored.target.width*scaleX,targetHeight:authored.target.height*scaleY};
}
