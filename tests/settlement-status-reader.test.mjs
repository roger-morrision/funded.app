import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettlementStatusReader} from '../server/settlement-status-reader.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const proof = count => ({verified:true,scope:'all-recorded-v3-collections',recorded:count,checked:count});
function fixture(options={}) {
  const input={identity:{cluster:'devnet',build:'build',programId:'program',approvedHash:'hash',rpcUrl:'private-rpc'},
    state:{collections:{a:{scope:'per-mint-v3',cluster:'devnet',mint:'mint',signature:'sig',collectedLamports:100}},
      launches:{mint:{creatorWallet:'creator',pumpFeeRoute:{protocolSplit:{creator:80}}}},
      v3Settlements:{sig:{status:'finalized',settlementSignature:'settlement'}}}};
  let clock=1_000_000, reads=0, verifications=0;
  const read=createSettlementStatusReader({readSnapshot:async()=>{reads++;return input;},
    verify:async()=>{verifications++;return proof(1);},now:()=>clock,responseWaitMs:5,
    verificationTimeoutMs:1000,maxAgeMs:60_000,...options});
  return {input,read,setTime:value=>clock=value,counts:()=>({reads,verifications})};
}

test('fast verified results retain their original timestamp and expire at the exact boundary',async()=>{
  const f=fixture();const first=await f.read();
  assert.equal(first.verified,true);assert.equal(first.cached,false);assert.equal(first.status,'verified');
  f.setTime(1_059_999);const cached=await f.read();assert.equal(cached.cached,true);
  assert.equal(cached.checkedAt,first.checkedAt);assert.equal(cached.expiresAt,first.expiresAt);
  cached.checked=0;assert.equal((await f.read()).checked,1,'Consumers cannot alter the cached evidence');
  f.setTime(1_060_000);assert.equal((await f.read()).cached,false);assert.equal(f.counts().verifications,2);
  f.setTime(999_999);assert.equal((await f.read()).cached,false,'Clock rollback cannot extend verified freshness');
});

test('slow verification returns truthful pending counts and single-flights concurrent readers',async()=>{
  const gate=deferred();let calls=0;
  const f=fixture({verify:async()=>{calls++;return gate.promise;}});
  const pending=await Promise.all(Array.from({length:20},()=>f.read()));
  assert.equal(calls,1);assert.equal(f.counts().reads,1);
  assert(pending.every(row=>row.verified===false&&row.status==='pending'&&row.recorded===1&&row.checked===0));
  assert(pending.every(row=>!row.checkedAt&&!row.expiresAt));
  gate.resolve(proof(1));await tick();
  const ready=await f.read();assert.equal(ready.verified,true);assert.equal(calls,1);
});

test('every relevant record/config change invalidates a previously verified result',async()=>{
  const mutations=[
    f=>f.input.state.collections.a.collectedLamports++,
    ...['status','signature','mint','claimId','router','programId','onchainVerified','attribution'].map(key=>
      f=>f.input.state.collections.a[key]='different'),
    f=>f.input.state.collections.b={...f.input.state.collections.a,signature:'sig2'},
    f=>delete f.input.state.collections.a,
    f=>f.input.state.launches.mint.creatorWallet='different',
    f=>f.input.state.launches.mint.pumpFeeRoute.initialAuthority='different',
    f=>f.input.state.launches.mint.pumpFeeRoute.protocolSplit.creator=79,
    f=>f.input.state.v3Settlements.sig.settlementSignature='different',
    f=>f.input.state.v3Settlements.sig.status='pending',
    f=>f.input.state.v3Settlements.sig.categoryLamports=['different'],
    f=>f.input.state.v3Settlements.sig.authorization='different',
    ...['cluster','build','programId','approvedHash','rpcUrl','programEvidenceRpcUrl','enabled'].map(key=>
      f=>f.input.identity[key]='different'),
  ];
  for(const mutate of mutations){
    let calls=0;const gate=deferred();const f=fixture({verify:async()=>++calls===1?proof(1):gate.promise});
    assert.equal((await f.read()).verified,true);mutate(f);
    assert.equal((await f.read()).verified,false);assert.equal(calls,2);
    gate.resolve({verified:false,scope:'all-recorded-v3-collections',recorded:Object.keys(f.input.state.collections).length,checked:0});await tick();
  }
});

test('a changed source while work is pending cannot publish an old completion or overlap work',async()=>{
  const old=deferred();let calls=0;const seen=[];
  const f=fixture({verify:async context=>{calls++;seen.push(context);return calls===1?old.promise:proof(2);}});
  assert.equal((await f.read()).status,'pending');
  f.input.state.collections.b={...f.input.state.collections.a,signature:'other'};
  assert.equal((await f.read()).recorded,2);assert.equal(calls,1);
  assert.equal(Object.keys(seen[0].state.collections).length,1,'Verifier holds its immutable captured inputs');
  old.resolve(proof(1));await tick();
  const fresh=await f.read();assert.equal(fresh.verified,true);assert.equal(fresh.recorded,2);assert.equal(calls,2);
});

test('completion rechecks source identity even without an intervening request',async()=>{
  const gate=deferred();let calls=0;
  const f=fixture({verify:async()=>++calls===1?gate.promise:proof(1)});
  assert.equal((await f.read()).status,'pending');
  f.input.state.v3Settlements.sig.authorization='changed';
  gate.resolve(proof(1));await tick();
  assert.equal((await f.read()).cached,false);assert.equal(calls,2);
});

test('timeout aborts and releases the old generation; a late success cannot poison recovered proof',async()=>{
  const gate=deferred();let calls=0,signal;
  const f=fixture({verify:async context=>{calls++;signal=context.signal;return calls===1?gate.promise:proof(1);},
    verificationTimeoutMs:15,responseWaitMs:30});
  const timeout=await f.read();assert.equal(timeout.reason,'verification-timeout');assert.equal(signal.aborted,true);
  assert.equal((await f.read()).verified,false);assert.equal(calls,1,'Failure backoff prevents repeated proof work');
  f.setTime(1_060_000);const recovered=await f.read();assert.equal(recovered.verified,true);assert.equal(calls,2);
  gate.resolve(proof(1));await tick();
  assert.equal((await f.read()).checkedAt,recovered.checkedAt);assert.equal(calls,2);
});

test('slow or failed source reads are explicit, shared, and never reuse old verified evidence',async()=>{
  const gate=deferred();let calls=0;
  const f=fixture({readSnapshot:async()=>{calls++;return gate.promise;}});
  const rows=await Promise.all([f.read(),f.read()]);assert.equal(calls,1);
  assert(rows.every(row=>row.recorded===null&&row.verified===false&&row.reason==='snapshot-pending'));
  gate.reject(new Error('secret-url'));await tick();
  const failed=await f.read();assert.equal(failed.reason,'snapshot-unavailable');
  assert(!JSON.stringify(failed).includes('secret-url'));
});

test('a never-resolving inventory generation expires and later reads recover independently',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const old=deferred();let calls=0;const f=fixture();
  const read=createSettlementStatusReader({readSnapshot:async()=>++calls===1?old.promise:f.input,
    verify:async()=>proof(1)});
  const first=read();await tick();t.mock.timers.tick(250);assert.equal((await first).reason,'snapshot-pending');
  t.mock.timers.tick(5750);await tick();
  const recovered=await read();assert.equal(recovered.verified,true);
  old.resolve({identity:{build:'old'},state:{}});await tick();
  assert.equal((await read()).checkedAt,recovered.checkedAt);
});

test('timing configuration cannot extend supported response, scan, inventory or freshness budgets',()=>{
  for(const options of [{responseWaitMs:501},{verificationTimeoutMs:30001},{maxAgeMs:60001},
    {snapshotTimeoutMs:6001},{responseWaitMs:NaN},{snapshotTimeoutMs:0}])
    assert.throws(()=>fixture(options),/timing budgets/);
});

test('aborted raw scans are capped at two and capacity recovers when retired work quiesces',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const gates=[deferred(),deferred()],started=[deferred(),deferred()];let calls=0,active=0,maximum=0;
  const f=fixture({responseWaitMs:20,verificationTimeoutMs:10,verify:async()=>{
    const index=calls++;maximum=Math.max(maximum,++active);
    started[index]?.resolve();
    try{return index<2?await gates[index].promise:proof(1);}finally{active--;}
  }});
  // Synchronize admitted work, then advance the unchanged 10ms verification
  // budget before the unchanged 20ms response budget; wall-clock snapshot cost
  // must not turn this capacity/retirement assertion into a response race.
  const first=f.read();await tick();assert.equal(calls,1);await started[0].promise;
  t.mock.timers.tick(10);await tick();
  assert.equal((await first).reason,'verification-timeout');f.setTime(1_060_000);
  const second=f.read();await tick();assert.equal(calls,2);await started[1].promise;
  t.mock.timers.tick(10);await tick();
  assert.equal((await second).reason,'verification-timeout');f.setTime(1_120_000);
  assert.equal((await f.read()).reason,'verification-capacity-unavailable');assert.equal(calls,2);
  gates[0].resolve(proof(1));await tick();
  assert.equal((await f.read()).verified,true);assert.equal(calls,3);assert.equal(maximum,2);
  gates[1].resolve(proof(1));await tick();assert.equal((await f.read()).verified,true);
});

test('timed-out inventory reads are capped and their late results cannot replace healthy input',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const gates=[deferred(),deferred()],f=fixture();let calls=0;
  const read=createSettlementStatusReader({readSnapshot:async()=>{const index=calls++;return index<2?gates[index].promise:f.input;},
    verify:async()=>proof(1)});
  for(let i=0;i<2;i++){
    const pending=read();await tick();t.mock.timers.tick(250);assert.equal((await pending).verified,false);
    t.mock.timers.tick(5750);await tick();
  }
  assert.equal((await read()).reason,'snapshot-unavailable');assert.equal(calls,2);
  gates[0].resolve({identity:{build:'old'},state:{}});await tick();
  assert.equal((await read()).verified,true);
  gates[1].resolve({identity:{build:'old'},state:{}});await tick();assert.equal((await read()).verified,true);
});

test('invalid, empty, partial and rejected proof results fail closed',async()=>{
  for(const value of [null,{...proof(1),scope:'other'},proof(2),{...proof(1),checked:0},
    {...proof(1),checked:-1},{...proof(1),failed:1},{...proof(1),failures:[{}]},
    {...proof(1),verified:'true'}]){
    const f=fixture({verify:async()=>value});const result=await f.read();
    assert.equal(result.verified,false);assert.equal(result.reason,'invalid-verification-result');
  }
  const f=fixture({verify:async()=>{throw Error('secret-endpoint');}});
  const failed=await f.read();assert.equal(failed.reason,'finalized-evidence-unavailable');
  assert(!JSON.stringify(failed).includes('secret-endpoint'));
  for(const count of [0,101]){
    const f=fixture({verify:async()=>proof(count)});
    f.input.state.collections=Object.fromEntries(Array.from({length:count},(_,index)=>[
      String(index),{scope:'per-mint-v3',cluster:'devnet',mint:'mint',signature:'sig'}]));
    assert.equal((await f.read()).verified,false);
  }
});

test('expired proof becomes pending immediately and cannot gain a sliding expiry from reads',async()=>{
  const gate=deferred();let calls=0;
  const f=fixture({verify:async()=>++calls===1?proof(1):gate.promise});
  const initial=await f.read();f.setTime(1_059_999);
  assert.equal((await f.read()).expiresAt,initial.expiresAt);
  f.setTime(1_060_000);const pending=await f.read();
  assert.equal(pending.verified,false);assert.equal(pending.status,'pending');assert.equal(calls,2);
  gate.resolve(proof(1));await tick();assert.equal((await f.read()).verified,true);
});

test('server instances are isolated and mismatched request config cannot consume a joined snapshot',async()=>{
  const first=fixture(),second=fixture();await first.read();await second.read();
  assert.equal(first.counts().verifications,1);assert.equal(second.counts().verifications,1);
  const result=await first.read({...first.input.identity,build:'different'});
  assert.equal(result.verified,false);assert.equal(result.status,'pending');
  assert(!JSON.stringify(result).includes('private-rpc'));
});

test('proof output never forwards unknown fields or endpoint text in reasons',async()=>{
  const f=fixture({verify:async()=>({verified:false,scope:'all-recorded-v3-collections',recorded:1,checked:1,
    reason:'https://private-rpc/?api-key=secret',secret:'private',failed:1,verifiedRecords:0,
    failures:[{mint:'private-mint',collectionSignature:'private-signature',reason:'https://private-rpc'}]})});
  const result=await f.read();assert.equal(result.failed,1);assert.equal(result.verifiedRecords,0);
  assert(!JSON.stringify(result).includes('private'));assert(!JSON.stringify(result).includes('secret'));
  const recovered=fixture({verify:async()=>({...proof(1),recoveredRecords:1})});
  assert.equal((await recovered.read()).recoveredRecords,1);
});
