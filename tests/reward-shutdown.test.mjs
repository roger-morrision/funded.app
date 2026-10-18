import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {installRewardShutdown} from '../server/reward-shutdown.mjs';
test('shutdown stops HTTP acceptance once and waits for requests and ledger drain before exit',async()=>{
  const signals=new EventEmitter();let finishRequests,finishLedger,closes=0,exits=0,closedConnections=0;
  const drained=new Promise(resolve=>{finishLedger=resolve;}),logs=[];
  installRewardShutdown({signals,server:{close:callback=>{closes++;finishRequests=callback;},closeAllConnections:()=>closedConnections++},
    drain:()=>drained,exit:code=>{assert.equal(code,0);exits++;},logger:{log:line=>logs.push(JSON.parse(line))}});
  signals.emit('SIGTERM');signals.emit('SIGINT');assert.equal(closes,1);assert.equal(exits,0);
  finishLedger();await new Promise(resolve=>setImmediate(resolve));assert.equal(exits,0);
  finishRequests();await new Promise(resolve=>setImmediate(resolve));assert.equal(exits,1);assert.equal(closedConnections,1);
  assert.deepEqual(logs,[{event:'reward_ledger_drained',signal:'SIGTERM'}]);
});
