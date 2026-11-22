import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {rewardAddresses} from '../../server/automatic-reward-chain.mjs';
import {readRewardExpiryContext,verifyRewardExpiryTransition} from '../../server/reward-expiry-context.mjs';
import {rewardExpiryFixture as fixture} from './reward-expiry-fixture.mjs';
import {expiryExecutionFixture,expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';

const key=n=>new PublicKey(new Uint8Array(32).fill(n));

for(const asset of ['SOL','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'])test('historical expiry authenticates original namespace and current signer for '+asset,async()=>{
  const f=fixture(asset),before=await readRewardExpiryContext(f.args()),ix=before.instruction;
  assert.equal(before.originalAuthority,String(f.original));assert.equal(ix.keys[0].pubkey.toBase58(),String(f.operator));
  assert.deepEqual(ix.keys.map(k=>[String(k.pubkey),k.isSigner,k.isWritable]),[[String(f.operator),true,false],[String(f.vault),false,false],
    [String(f.reserve),false,true],[String(f.cycle),false,true],[String(f.router),false,false]]);
  assert.notEqual(String(f.vault),String(rewardAddresses({programId:f.program,authority:f.operator,mint:f.plan.mint}).vault));
  f.expire();const after=await readRewardExpiryContext(f.args()),verified=verifyRewardExpiryTransition(before,after);
  assert.equal(verified.unpaidAmount,'200');assert.equal(after.liability.outstanding,'41');assert.equal(verified.liabilityDeltaVerified,true);
  assert.throws(()=>verifyRewardExpiryTransition(after,after));
});

test('missing saved cycle or unreviewed Mainnet release cannot select a fresh successor namespace',async()=>{
  const f=fixture();let calls=0;f.connection.getGenesisHash=async()=>{calls++;throw Error('No RPC allowed');};
  await assert.rejects(readRewardExpiryContext({...f.args(),release:null}));assert.equal(calls,0);
  f.plan.cycle=null;await assert.rejects(readRewardExpiryContext(f.args()));assert.equal(calls,0);
});

test('wrong genesis, plan network and changed reviewed program context reject historical expiry',async()=>{
  const f=fixture();f.connection.getGenesisHash=async()=> 'wrong';await assert.rejects(readRewardExpiryContext(f.args()));
  const g=fixture();g.plan.cluster='devnet';await assert.rejects(readRewardExpiryContext(g.args()));
  const h=fixture();h.programData.data[50]^=1;await assert.rejects(readRewardExpiryContext(h.args()));
});

test('changed immutable root, amount, time, asset and leaf count cannot authorize expiry',async()=>{
  for(const mutate of [f=>{f.plan.manifest.root='00'.repeat(32);},f=>{f.plan.manifest.totalAmount='301';},f=>{f.plan.cutoffAt++;},
    f=>{f.plan.payoutAt++;},f=>{f.plan.manifest.asset=String(key(90));},f=>{f.plan.manifest.leaves.push({...f.plan.manifest.leaves[0]});}]){
    const f=fixture();mutate(f);await assert.rejects(readRewardExpiryContext(f.args()));
  }
});

test('foreign or malformed original vault, cycle and reserve cannot be relabeled as historical state',async()=>{
  for(const field of ['vault','cycle','reserve'])for(const mutate of [a=>{a.owner=key(90);},a=>{a.data[8]^=1;},a=>{a.data[field==='cycle'?172:a.data.length-1]^=1;}]){
    const f=fixture();mutate(f.rows.get(String(f[field])));await assert.rejects(readRewardExpiryContext(f.args()));
  }
  const f=fixture();f.plan.originalAuthority=String(key(90));await assert.rejects(readRewardExpiryContext(f.args()));
});

test('old operator, paused guard, premature grace and missing time cannot construct expiry',async()=>{
  const f=fixture();await assert.rejects(readRewardExpiryContext({...f.args(),currentAuthority:f.original}));
  const g=fixture();g.rows.get(String(g.router)).data[106]=1;await assert.rejects(readRewardExpiryContext(g.args()),/paused/);
  const h=fixture();h.time--;await assert.rejects(readRewardExpiryContext(h.args()),/grace/);
  const i=fixture();i.time=null;await assert.rejects(readRewardExpiryContext(i.args()),/time/);
});

for(const asset of ['SOL','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'])test('equal cutoff and payout admit exact grace but reject reversed times for '+asset,async()=>{
  const equal=fixture(asset);equal.plan.payoutAt=equal.plan.cutoffAt;
  equal.rows.get(String(equal.cycle)).data.writeBigInt64LE(BigInt(equal.plan.payoutAt),160);
  equal.time=equal.plan.payoutAt+30*24*60*60;
  const before=await readRewardExpiryContext(equal.args());assert.equal(before.record.payoutAt,before.record.cutoffAt);
  equal.time--;await assert.rejects(readRewardExpiryContext(equal.args()),/grace/);
  equal.time+=2;assert.equal((await readRewardExpiryContext(equal.args())).record.reserved,true);
  equal.expire();assert.equal(verifyRewardExpiryTransition(before,await readRewardExpiryContext(equal.args())).unpaidAmount,'200');
  const reversed=fixture(asset);reversed.plan.payoutAt=reversed.plan.cutoffAt-1;
  reversed.rows.get(String(reversed.cycle)).data.writeBigInt64LE(BigInt(reversed.plan.payoutAt),160);
  reversed.time=reversed.plan.payoutAt+30*24*60*60;
  let reads=0;reversed.connection.getGenesisHash=async()=>{reads++;throw Error('No RPC permitted for reversed times');};
  await assert.rejects(readRewardExpiryContext(reversed.args()),/immutable reward cycle/);assert.equal(reads,0);
});

test('stale reads, unknown cycle layout and invalid unpaid liabilities remain unresolved',async()=>{
  const f=fixture(),read=f.connection.getMultipleAccountsInfoAndContext;f.connection.getMultipleAccountsInfoAndContext=async(...args)=>({...await read(...args),context:{slot:f.slot-1}});
  await assert.rejects(readRewardExpiryContext(f.args()),/Stale/);
  const g=fixture();g.rows.get(String(g.cycle)).data=Buffer.alloc(173);await assert.rejects(readRewardExpiryContext(g.args()));
  for(const mutate of [f=>f.rows.get(String(f.cycle)).data.writeBigUInt64LE(301n,144),f=>f.rows.get(String(f.reserve)).data.writeBigUInt64LE(199n,72)]){
    const f=fixture();mutate(f);await assert.rejects(readRewardExpiryContext(f.args()));
  }
});

test('expiry verification rejects wrong release, changed custody, paid amount and unrelated reserve fields',async()=>{
  for(const mutate of [f=>f.rows.get(String(f.reserve)).data.writeBigUInt64LE(40n,72),f=>{f.rows.get(String(f.vault)).lamports++;},
    f=>f.rows.get(String(f.cycle)).data.writeBigUInt64LE(101n,144),f=>{f.rows.get(String(f.reserve)).lamports++;}]){
    const f=fixture(),before=await readRewardExpiryContext(f.args());f.expire();mutate(f);
    await assert.rejects(async()=>verifyRewardExpiryTransition(before,await readRewardExpiryContext(f.args())));
  }
});

test('mocked Devnet adapter attributes the saved original cycle to the successor signature',async t=>{
  const f=expiryExecutionFixture(),{store}=await expiryExecutionStore(t,f),chain=f.chain();
  const result=await chain.expireCycle(f.plan,{store});assert.equal(result.unpaidAmount,'200');assert.equal(f.submitted,1);
  assert.equal(result.expiryTransactionVerified,true);
  const recovered=await f.chain().expireCycle(f.plan,{store});assert.equal(recovered.signature,result.signature);assert.equal(f.submitted,1);
});
