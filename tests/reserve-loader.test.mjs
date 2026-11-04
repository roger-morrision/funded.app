import test from 'node:test';
import assert from 'node:assert/strict';
import { createReserveLoader } from '../src/features/rewards/reserve-loader.js';
const result = reserves => ({available:true,data:{cluster:'devnet',reserves}});
test('coalesces concurrent scans; selected mint completes before slow directory without being overwritten',async()=>{
  const pending=[],app={apiRequest:(path,options)=>new Promise(resolve=>pending.push({path,options,resolve})),verifiedCommunityReserves:new Map()};
  let renders=0;const load=createReserveLoader(app,()=>renders++);
  const full=load();assert.equal(load(),full);
  const scoped=load({mint:'selected'});assert.equal(load({mint:'selected'}),scoped);
  await Promise.resolve();assert.equal(pending.length,2);assert.match(pending[1].path,/mint=selected/);
  assert.ok(pending.every(row=>row.options.signal instanceof AbortSignal));
  pending[1].resolve(result([{mint:'selected',verified:true,claimed:'new'}]));await scoped;
  pending[0].resolve(result([{mint:'selected',verified:true,claimed:'old'},{mint:'other',verified:true}]));await full;
  assert.equal(app.verifiedCommunityReserves.get('selected').claimed,'new');assert.equal(renders,2);
  assert.equal(app.communityReserveStates.get('other'),'ready');
});
test('a failed mint read does not erase other mints; retry can recover',async()=>{
  const app={verifiedCommunityReserves:new Map([['other',{mint:'other',verified:true}]]),apiRequest:async()=>{throw Error('timeout');}};
  const load=createReserveLoader(app,()=>{});await load({mint:'selected'});
  assert.equal(app.communityReserveStates.get('selected'),'unavailable');assert.ok(app.verifiedCommunityReserves.has('other'));
  app.apiRequest=async()=>result([{mint:'selected',verified:true},{mint:'unrequested',verified:true}]);
  await load({mint:'selected'});assert.equal(app.communityReserveStates.get('selected'),'ready');
  assert.equal(app.verifiedCommunityReserves.has('unrequested'),false);
});
