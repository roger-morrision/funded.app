import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {installRewardShutdown} from '../server/reward-shutdown.mjs';
test('shutdown stops HTTP acceptance once and waits for requests and ledger drain before exit',async()=>{
  const signals=new EventEmitter();let finishRequests,finishLedger,closes=0,exits=0,closedConnections=0;
  const drained=new Promise(resolve=>{finishLedger=resolve;}),logs=[];
  const server=Object.assign(new EventEmitter(),{close:callback=>{closes++;finishRequests=callback;},closeAllConnections:()=>closedConnections++});
  installRewardShutdown({signals,server,handle:()=>{},
    drain:()=>drained,exit:code=>{assert.equal(code,0);exits++;},logger:{log:line=>logs.push(JSON.parse(line))}});
  signals.emit('SIGTERM');signals.emit('SIGINT');signals.emit('SIGTERM');assert.equal(closes,1);assert.equal(exits,0);
  finishLedger();await new Promise(resolve=>setImmediate(resolve));assert.equal(exits,0);assert.equal(closedConnections,1);
  finishRequests();await new Promise(resolve=>setImmediate(resolve));assert.equal(exits,1);assert.equal(closedConnections,1);
  assert.deepEqual(logs,[{event:'reward_shutdown_started',signal:'SIGTERM',handlers:0,writeResponses:0},
    {event:'reward_ledger_drained',signal:'SIGTERM'}]);
});
test('an unwrapped or preinstalled request listener cannot bypass shutdown admission',()=>{
  const server=new EventEmitter();assert.throws(()=>installRewardShutdown({server}),/admission/);
  server.on('request',()=>{});assert.throws(()=>installRewardShutdown({server,handle:()=>{}}),/admission/);
});
test('HTTP server close errors cannot emit a clean ledger attestation or exit',async()=>{
  const server=Object.assign(new EventEmitter(),{close:callback=>callback(Error('close failed')),closeAllConnections:()=>{}});
  const signals=new EventEmitter(),logs=[],errors=[];
  installRewardShutdown({server,signals,handle:()=>{},drain:async()=>{},exit:()=>assert.fail('Unsafe exit'),
    logger:{log:line=>logs.push(JSON.parse(line)),error:line=>errors.push(JSON.parse(line))}});
  signals.emit('SIGTERM');await new Promise(resolve=>setImmediate(resolve));
  assert(!logs.some(item=>item.event==='reward_ledger_drained'));
  assert.equal(errors[0].event,'reward_shutdown_failed');assert.equal(errors[0].stage,'http-connections');
});
