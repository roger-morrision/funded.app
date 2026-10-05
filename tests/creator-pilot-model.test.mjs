import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorPilotProgress } from '../creator-pilot-model.js';
test('creator pilot begins without a wallet or invented progress',()=>{
 const state=creatorPilotProgress();assert.deepEqual(state.primary,{href:'#launch',label:'Prepare your token'});assert.equal(state.pending,false);assert.match(state.statuses[0],/without a wallet/);assert.match(state.statuses[3],/Only finalized receipts/);
});
test('opened review is local evidence, never on-chain success',()=>{
 const state=creatorPilotProgress({reviewOpened:true,journal:[{cluster:'devnet',state:'completed',signature:'receipt',mint:'mint'}]});
 assert.equal(state.primary.label,'Prepare your token');assert.match(state.statuses[1],/opened this session/);assert.match(state.statuses[2],/locally · verify/);assert.doesNotMatch(state.statuses.join(' '),/paid|earned|complete$/i);
});
test('uncertain same-network launch takes priority over another launch while foreign records are ignored',()=>{
 const pending=creatorPilotProgress({journal:[{cluster:'devnet',state:'unknown'}]});assert.equal(pending.primary.href,'#my-launches');assert.equal(pending.pending,true);
 const other=creatorPilotProgress({journal:[{cluster:'mainnet-beta',state:'unknown'}]});assert.equal(other.pending,false);
 assert.equal(creatorPilotProgress({journal:null}).pending,false);
});
