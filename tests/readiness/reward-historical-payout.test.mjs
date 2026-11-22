import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {createHash} from 'node:crypto';
import {rewardAddresses,rewardReserveAddress} from '../../server/automatic-reward-chain.mjs';
import {buildRewardManifest,SOL_ASSET_MINT} from '../../reward-merkle.js';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {readCommittedRewardContext} from '../../server/reward-committed-context.mjs';
import {createRewardScheduler} from '../../server/reward-scheduler.mjs';
import {expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';
import {historicalPayoutFixture,PAYOUT_ASSETS} from './reward-payout-fixture.mjs';

for(const asset of PAYOUT_ASSETS){
  test('existing '+asset.name+' commitment resolves original cycle without initializing successor accounts',async()=>{
    const f=historicalPayoutFixture(asset),result=await f.chain().ensureCycle(f.plan);
    assert.equal(result.address,String(f.cycle));assert.equal(result.created,false);assert.equal(result.receiptMode,'legacy');
    assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
    assert.equal(f.rows.has(String(rewardAddresses({programId:f.program,authority:f.operator,mint:f.mint}).vault)),false);
  });
  test('historical '+asset.name+' paid receipt is inspected in the original namespace',async()=>{
    const f=historicalPayoutFixture(asset),result=await f.chain().inspectLeaf(f.plan,f.paidLeaf);
    assert.equal(result.payment,String(f.payment(f.paidLeaf)));assert.equal(result.amount,'100');assert.equal(result.amountReceived,'100');assert.equal(result.finalized,true);
    assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
  });
  test('historical '+asset.name+' remaining entitlement uses current signer and original custody once',async()=>{
    const f=historicalPayoutFixture(asset),oldReceipt=Buffer.from(f.rows.get(String(f.payment(f.paidLeaf))).data);
    const result=await f.chain().submitLeaf(f.plan,f.leaf);
    assert.equal(result.payment,String(f.payment(f.leaf)));assert.equal(result.amountReceived,'200');assert.equal(result.balanceDeltaVerified,true);
    assert.equal(f.rows.get(String(f.cycle)).data.readBigUInt64LE(144),300n);assert.equal(f.rows.get(String(f.reserve)).data.readBigUInt64LE(72),41n);
    assert.ok(oldReceipt.equals(f.rows.get(String(f.payment(f.paidLeaf))).data));
    const repeat=await f.chain().submitLeaf(f.plan,f.leaf);assert.equal(repeat.alreadyPaid,true);assert.equal(f.sends,1);assert.equal(f.latestCalls,1);
    assert.equal(f.rows.has(String(rewardAddresses({programId:f.program,authority:f.operator,mint:f.mint}).vault)),false);
  });
}

function currentCommitment(f,{legacy=false}={}){
  const cycleId=Buffer.alloc(32,66).toString('hex'),manifest=buildRewardManifest({cycleId,asset:f.asset,allocations:f.plan.manifest.leaves.map(l=>({recipient:l.recipient,amount:l.amount}))});
  const addresses=rewardAddresses({programId:f.program,authority:f.operator,mint:f.mint,cycleId});
  const reserve=rewardReserveAddress({programId:f.program,vault:addresses.vault,asset:f.asset});
  const clone=a=>({...a,data:Buffer.from(a.data)}),vault=clone(f.rows.get(String(f.vault))),cycle=clone(f.rows.get(String(f.cycle))),liability=clone(f.rows.get(String(f.reserve)));
  f.operator.toBuffer().copy(vault.data,8);vault.data[72]=PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'),f.operator.toBuffer(),f.mint.toBuffer()],f.program)[1];
  addresses.vault.toBuffer().copy(cycle.data,8);Buffer.from(cycleId,'hex').copy(cycle.data,40);Buffer.from(manifest.root,'hex').copy(cycle.data,72);
  cycle.data[172]=PublicKey.findProgramAddressSync([Buffer.from('reward-cycle-v1'),addresses.vault.toBuffer(),Buffer.from(cycleId,'hex')],f.program)[1];
  if(legacy)cycle.data=cycle.data.subarray(0,173);
  addresses.vault.toBuffer().copy(liability.data,8);liability.data.writeBigUInt64LE(legacy?41n:241n,72);
  liability.data[80]=PublicKey.findProgramAddressSync([Buffer.from('reward-reserve-v1'),addresses.vault.toBuffer(),new PublicKey(f.asset==='SOL'?SOL_ASSET_MINT:f.asset).toBuffer()],f.program)[1];
  f.rows.set(String(addresses.vault),vault);f.rows.set(String(addresses.cycle),cycle);f.rows.set(String(reserve),liability);
  return {...addresses,reserve,plan:{...structuredClone(f.plan),id:'current-control',cycle:legacy?String(addresses.cycle):undefined,manifest,status:legacy?'distributing':'prepared',payments:{}}};
}

test('current-operator existing commitment still binds the caller plan for immediate payout use',async()=>{
  const f=historicalPayoutFixture(),current=currentCommitment(f),original=Buffer.from(f.rows.get(String(f.vault)).data);
  const result=await f.chain().ensureCycle(current.plan);assert.equal(result.address,String(current.cycle));assert.equal(current.plan.cycle,result.address);
  assert.equal(result.created,false);assert.equal(f.latestCalls,0);assert.equal(f.sends,0);assert.ok(original.equals(f.rows.get(String(f.vault)).data));
});

test('current-operator cycle binding rejects a foreign account before claiming a commitment',async()=>{
  const f=historicalPayoutFixture(),current=currentCommitment(f);f.rows.get(String(current.cycle)).owner=PublicKey.default;
  await assert.rejects(f.chain().ensureCycle(current.plan),/owned by/);assert.equal(current.plan.cycle,undefined);assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
});

test('fresh creation binds only an authenticated finalized current-operator cycle',async()=>{
  for(const foreign of [false,true]){
    const f=historicalPayoutFixture(),current=currentCommitment(f),created={...f.rows.get(String(current.cycle)),data:Buffer.from(f.rows.get(String(current.cycle)).data)};
    created.data.writeBigUInt64LE(0n,144);f.rows.delete(String(current.cycle));
    f.connection.sendRawTransaction=async wire=>{
      const tx=Transaction.from(wire),ix=tx.instructions.find(i=>i.programId.equals(f.program));assert.ok(tx.verifySignatures());
      assert.ok(ix.data.subarray(0,8).equals(createHash('sha256').update('global:create_reward_cycle').digest().subarray(0,8)));
      assert.deepEqual(ix.keys.slice(0,4).map(k=>String(k.pubkey)),[String(f.operator),String(current.vault),String(current.reserve),String(current.cycle)]);
      if(foreign)created.owner=PublicKey.default;
      f.rows.set(String(current.cycle),created);f.rows.get(String(current.reserve)).data.writeBigUInt64LE(541n,72);f.sends++;return bs58.encode(tx.signature);
    };
    if(foreign){await assert.rejects(f.chain().ensureCycle(current.plan),/expected state delta/);assert.equal(current.plan.cycle,undefined);}
    else{const result=await f.chain().ensureCycle(current.plan);assert.equal(result.created,true);assert.equal(current.plan.cycle,String(current.cycle));}
    assert.equal(f.sends,1);assert.equal(f.rows.get(String(f.reserve)).data.readBigUInt64LE(72),241n);
  }
});

test('same-operator legacy migration remains supported without moving another authority vault',async()=>{
  const f=historicalPayoutFixture(),current=currentCommitment(f,{legacy:true});
  f.connection.sendRawTransaction=async wire=>{
    const tx=Transaction.from(wire),ix=tx.instructions.find(i=>i.programId.equals(f.program));assert.ok(tx.verifySignatures());
    assert.ok(ix.data.subarray(0,8).equals(createHash('sha256').update('global:migrate_reward_cycle_sol').digest().subarray(0,8)));
    assert.deepEqual(ix.keys.slice(0,4).map(k=>String(k.pubkey)),[String(f.operator),String(current.vault),String(current.reserve),String(current.cycle)]);
    const saved=f.rows.get(String(current.cycle));saved.data=Buffer.concat([saved.data,Buffer.from([1])]);f.rows.get(String(current.reserve)).data.writeBigUInt64LE(241n,72);
    f.sends++;return bs58.encode(tx.signature);
  };
  const result=await f.chain().ensureCycle(current.plan);assert.equal(result.migrated,true);assert.equal(result.address,String(current.cycle));assert.equal(f.sends,1);
  assert.equal(f.rows.get(String(f.reserve)).data.readBigUInt64LE(72),241n);
});

test('unreserved legacy commitment owned by an outgoing authority cannot be silently migrated',async()=>{
  const f=historicalPayoutFixture();f.rows.get(String(f.cycle)).data=f.rows.get(String(f.cycle)).data.subarray(0,173);
  await assert.rejects(f.chain().ensureCycle(f.plan),/original-authority handling/);assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
});

test('known previous commitment without a saved cycle never falls into successor initialization',async()=>{
  for(const prior of [{status:'distributing'},{status:'prepared',cycleSignature:'saved-signature'},{status:'prepared',payments:{recipient:{status:'paid'}}}]){
    const f=historicalPayoutFixture();delete f.plan.cycle;Object.assign(f.plan,prior);
    await assert.rejects(f.chain().ensureCycle(f.plan),/saved cycle binding/);assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
  }
});

test('changed immutable commitment fields cannot reach namespace initialization or payout',async()=>{
  for(const mutate of [f=>{f.plan.manifest.root='00'.repeat(32);},f=>{f.plan.manifest.totalAmount='301';},f=>{f.plan.cutoffAt++;},
    f=>{f.plan.payoutAt++;},f=>{f.plan.manifest.leaves.pop();},f=>{f.plan.asset='wrong';}]){
    const f=historicalPayoutFixture();mutate(f);await assert.rejects(f.chain().ensureCycle(f.plan));assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
  }
});

test('owned vault/cycle/reserve seeds and current router cannot be substituted',async()=>{
  for(const name of ['vault','cycle','reserve','router']){
    const f=historicalPayoutFixture();f.rows.get(String(f[name])).owner=PublicKey.default;
    await assert.rejects(f.chain().ensureCycle(f.plan));assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
  }
  for(const [name,offset]of [['vault',72],['cycle',172],['reserve',80],['vault',40]]){
    const f=historicalPayoutFixture();f.rows.get(String(f[name])).data[offset]^=1;
    await assert.rejects(f.chain().ensureCycle(f.plan));assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
  }
});

test('stale snapshots and wrong network or original authority remain unresolved without signing',async()=>{
  const f=historicalPayoutFixture(),read=f.connection.getMultipleAccountsInfoAndContext;
  f.connection.getMultipleAccountsInfoAndContext=async(...args)=>({...await read(...args),context:{slot:f.slot-1}});
  await assert.rejects(f.chain().ensureCycle(f.plan),/Stale/);assert.equal(f.latestCalls,0);
  const g=historicalPayoutFixture();g.plan.originalAuthority=String(g.operator);await assert.rejects(g.chain().ensureCycle(g.plan));assert.equal(g.latestCalls,0);
  const h=historicalPayoutFixture();h.connection.getGenesisHash=async()=> 'wrong';await assert.rejects(h.chain().ensureCycle(h.plan));assert.equal(h.latestCalls,0);
});

test('namespace resolution does not clone or enumerate cohort leaves per recipient',async()=>{
  const f=historicalPayoutFixture(),leaves=f.plan.manifest.leaves;
  f.plan.manifest.leaves=new Proxy(leaves,{get(target,name){if(name==='length')return target.length;throw Error('Namespace reader must only read leaf count');}});
  const result=await f.chain().ensureCycle(f.plan);assert.equal(result.address,String(f.cycle));assert.equal(f.sends,0);
});

test('manifest mutation during an awaited namespace read cannot bind or pay a changed intent',async()=>{
  const f=historicalPayoutFixture(),read=f.connection.getMultipleAccountsInfoAndContext;
  f.connection.getMultipleAccountsInfoAndContext=async(...args)=>{const value=await read(...args);f.plan.manifest.root='00'.repeat(32);return value;};
  await assert.rejects(f.chain().ensureCycle(f.plan),/plan changed/);assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
});

test('closed cycles and foreign or conflicting paid receipts cannot authorize a fresh payout',async()=>{
  const f=historicalPayoutFixture();f.rows.get(String(f.cycle)).data[173]=0;
  await assert.rejects(f.chain().ensureCycle(f.plan),/closed/);
  await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf),/evidence unavailable/);assert.equal(f.latestCalls,0);assert.equal(f.sends,0);
  for(const mutate of [a=>{a.owner=PublicKey.default;},a=>{a.data[8]^=1;},a=>a.data.writeBigUInt64LE(99n,72)]){
    const g=historicalPayoutFixture();mutate(g.rows.get(String(g.payment(g.paidLeaf))));
    await assert.rejects(g.chain().submitLeaf(g.plan,g.paidLeaf));assert.equal(g.latestCalls,0);assert.equal(g.sends,0);
  }
});

test('Mainnet namespace reader preserves default admission, current guard and bitmap exclusion',async()=>{
  const f=historicalPayoutFixture();f.plan.cluster='mainnet-beta';f.connection.getGenesisHash=async()=>SOLANA_GENESIS['mainnet-beta'];
  const header=Buffer.alloc(131);f.rows.get(String(f.router)).data.copy(header);f.rows.get(String(f.router)).data=header;
  const args={connection:f.connection,programId:f.program,currentAuthority:f.operator,plan:f.plan,cluster:'mainnet-beta',expectedProgramDataSha256:f.release.programDataSha256};
  await assert.rejects(readCommittedRewardContext(args),/Reviewed/);
  assert.equal(String((await readCommittedRewardContext({...args,release:f.release})).vault),String(f.vault));
  header[106]=1;await assert.rejects(readCommittedRewardContext({...args,release:f.release}),/paused/);header[106]=0;
  const cycle=Buffer.alloc(179);f.rows.get(String(f.cycle)).data.copy(cycle);createHash('sha256').update('account:RewardBitmapCycle').digest().copy(cycle,0,0,8);cycle.writeUInt32LE(1,174);
  f.rows.get(String(f.cycle)).data=cycle;await assert.rejects(readCommittedRewardContext({...args,release:f.release}),/receipt mode/);
});

test('actual scheduler retains historical commitment and records only the remaining payout',async t=>{
  const f=historicalPayoutFixture(),{store}=await expiryExecutionStore(t,f),scheduler=createRewardScheduler({store,chain:f.chain(),indexer:{},cluster:'devnet'});
  const result=await scheduler.execute(200010,[f.plan.id]);assert.equal(result.submitted,1);assert.equal(f.sends,1);
  const row=(await store.read()).schedules[f.plan.id];assert.equal(row.cycle,String(f.cycle));assert.equal(row.status,'paid');
  assert.equal(Object.keys(row.payments).length,2);assert.equal(f.rows.get(String(f.reserve)).data.readBigUInt64LE(72),41n);
});
