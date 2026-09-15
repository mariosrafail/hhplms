import test from 'node:test';
import assert from 'node:assert/strict';
import { flowNavigationReadinessIssues } from '../scripts/book-builder/flow-navigation-readiness.mjs';

const expectedSlots = ['late-background-1', 'late-font-1'];
const visible = () => ({ sameInstance:true, barrierClosed:true, requests:expectedSlots.map(slot => ({slot,state:'held'})),
  fontStatus:'loading', fontSetStatus:'loading', panelHidden:false, panelVisible:true,
  root:{width:1024,height:540,clientWidth:1024,clientHeight:540}, panelIndex:1,panelCount:2 });
const check = (snapshot, openBeforeLoad = true) => flowNavigationReadinessIssues(snapshot, {openBeforeLoad,expectedSlots});

test('visible request rejects the historical hidden pre-navigation snapshot', () => {
  const snapshot = {...visible(),panelHidden:true,panelVisible:false,root:{width:0,height:0,clientWidth:0,clientHeight:0},panelIndex:0,panelCount:0};
  assert.deepEqual(check(snapshot), ['panel-visible','root-geometry','presentation-state']);
});
test('committed visible panel is ready while both assets and the font remain loading', () => {
  assert.deepEqual(check(visible()), []);
});
test('hidden pending-assets case permits zero geometry', () => {
  assert.deepEqual(check({...visible(),panelHidden:true,panelVisible:false,root:{width:0,height:0,clientWidth:0,clientHeight:0},panelIndex:0,panelCount:0}, false), []);
});
test('early barrier release or request fulfillment cannot pass pre-release acceptance', () => {
  assert.ok(check({...visible(),barrierClosed:false}).includes('asset-barrier'));
  const snapshot = visible(); snapshot.requests[0].state = 'fulfilled';
  assert.ok(check(snapshot).includes('held-requests'));
});
test('wrong assets, remount, unloaded geometry and completed font remain disqualifying', () => {
  const snapshot = visible(); snapshot.requests[1].slot = 'wrong-font';
  assert.ok(check(snapshot).includes('held-requests'));
  assert.ok(check({...visible(),sameInstance:false}).includes('mounted-instance'));
  assert.ok(check({...visible(),root:{width:1024,height:540,clientWidth:0,clientHeight:540}}).includes('root-geometry'));
  assert.ok(check({...visible(),fontSetStatus:'loaded'}).includes('font-loading'));
  assert.ok(check({...visible(),fontStatus:'loaded'}).includes('font-loading'));
});
