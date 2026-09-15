import test from 'node:test';
import assert from 'node:assert/strict';
import {stagePositioningBox,expectedFlowTarget} from '../scripts/book-builder/flow-bank-box-geometry.mjs';
const authored={surface:{width:1024,height:1100},target:{x:70,y:80,width:860,height:170}};
test('one-pixel stage border is excluded from positioned target percentages',()=>{
  const outer={x:10,y:20,width:1026,height:1102},box=stagePositioningBox(outer,{left:1,right:1,top:1,bottom:1});
  assert.deepEqual(box,{x:11,y:21,width:1024,height:1100});
  const expected=expectedFlowTarget({stageBorderBox:outer,stagePositioningBox:box},authored);
  assert.deepEqual(expected,{targetX:71,targetY:81,targetWidth:860,targetHeight:170});
  assert.ok(Math.abs(outer.width/authored.surface.width*authored.target.width-expected.targetWidth)>1,'border-box scale gives the wrong target width');
});
test('asymmetric measured borders preserve separate positioned axes and origins',()=>{
  const outer={x:10,y:20,width:1030,height:1108},box=stagePositioningBox(outer,{left:2,right:4,top:3,bottom:5});
  assert.deepEqual(box,{x:12,y:23,width:1024,height:1100});
  assert.deepEqual(expectedFlowTarget({stageBorderBox:outer,stagePositioningBox:box},authored),{targetX:72,targetY:83,targetWidth:860,targetHeight:170});
  const halfHeight={...box,height:550};
  assert.deepEqual(expectedFlowTarget({stageBorderBox:outer,stagePositioningBox:halfHeight},authored),{targetX:72,targetY:43,targetWidth:860,targetHeight:85});
});
