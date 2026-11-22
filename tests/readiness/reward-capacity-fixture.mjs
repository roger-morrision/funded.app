import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey} from '@solana/web3.js';
import {buildRewardManifest} from '../../reward-merkle.js';
import {rewardAddresses} from '../../server/automatic-reward-chain.mjs';
import {requirePayoutAttempt} from '../../server/reward-payout-journal.mjs';
import {historicalPayoutFixture,PAYOUT_ASSETS} from './reward-payout-fixture.mjs';

// Offline capacity INPUT, not admission or a chain simulator. Actual chain and
// journal construct/sign each different leaf. The transport never lands a tx.
// Only public signed messages/snapshots persist; deterministic keys stay in RAM.
export async function signedCapacityCohort({count,assetName}){
  assert(Number.isSafeInteger(count)&&count>=1&&count<=1001,'Declared local cohort must contain 1..1001 leaves.');
  const asset=PAYOUT_ASSETS.find(a=>a.name===assetName);assert(asset,'Unknown capacity asset.');
  const f=historicalPayoutFixture(asset),started=performance.now();f.autoLand=false;f.proofAvailable=false;
  const allocations=Array.from({length:count},(_,i)=>({recipient:String(Keypair.fromSeed(createHash('sha256')
    .update('offline-capacity-recipient:'+i).digest()).publicKey),amount:String(100+i%17)}));
  const cycleId=createHash('sha256').update('offline-capacity-cycle:'+assetName+':'+count).digest('hex');
  const manifest=buildRewardManifest({cycleId,asset:asset.asset,allocations});
  // Match the actual owned immutable cycle and reserve to the complete global
  // manifest, rather than grafting unrelated two-leaf attempts onto a large row.
  const cycleInfo=f.rows.get(String(f.cycle));f.rows.delete(String(f.cycle));
  const addresses=rewardAddresses({programId:f.program,authority:f.original,mint:f.mint,cycleId});f.cycle=addresses.cycle;
  const cycle=cycleInfo.data,reserve=f.rows.get(String(f.reserve)).data,total=BigInt(manifest.totalAmount);
  Buffer.from(cycleId,'hex').copy(cycle,40);
  cycle[172]=PublicKey.findProgramAddressSync([Buffer.from('reward-cycle-v1'),f.vault.toBuffer(),Buffer.from(cycleId,'hex')],f.program)[1];
  f.rows.set(String(f.cycle),cycleInfo);
  Buffer.from(manifest.root,'hex').copy(cycle,72);cycle.writeBigUInt64LE(total,136);cycle.writeBigUInt64LE(0n,144);cycle.writeUInt32LE(count,168);
  reserve.writeBigUInt64LE(total+41n,72);f.rows.delete(String(f.payment(f.paidLeaf)));f.signatures.clear();
  f.rows.get(String(f.vault)).lamports=Number(total)+5000;if(asset.asset!=='SOL')f.tokens.set(String(f.vaultToken),total+41n);
  f.plan={...f.plan,id:'capacity-'+assetName,cycle:String(f.cycle),kind:'holder',manifest,payments:{},payoutAttempts:{}};
  for(const leaf of manifest.leaves)f.balances.set(leaf.recipient,10000);
  // This serial in-memory staging store is only for generating canonical input;
  // the benchmark subsequently reopens the real locked/fsynced filesystem store.
  const state={schedules:{[f.plan.id]:f.plan}},staging={read:async()=>state,transaction:async mutate=>mutate(state)},chain=f.chain();
  const signatures=new Set(),wires=new Set();let minWire=Infinity,maxWire=0;
  for(const leaf of manifest.leaves){
    await assert.rejects(chain.submitLeaf(f.plan,leaf,{store:staging}),/exact finalized reconciliation/);
    const attempt=f.plan.payoutAttempts[leaf.recipient];assert.equal(attempt?.state,'prepared');
    requirePayoutAttempt(attempt,{plan:f.plan,leaf,programId:f.program,currentAuthority:f.operator,
      cluster:'devnet',expectedProgramDataSha256:f.release.programDataSha256});
    assert(!signatures.has(attempt.signature)&&!wires.has(attempt.transactionBase64),'Each leaf must own a different signed wire.');
    signatures.add(attempt.signature);wires.add(attempt.transactionBase64);
    const bytes=Buffer.from(attempt.transactionBase64,'base64').length;minWire=Math.min(minWire,bytes);maxWire=Math.max(maxWire,bytes);
  }
  assert.equal(f.sends,count);assert.equal(f.latestCalls,count);assert.equal(Object.keys(f.plan.payments).length,0);
  return {plan:f.plan,chain,f,options:{programId:f.program,currentAuthority:f.operator,cluster:'devnet',expectedProgramDataSha256:f.release.programDataSha256},
    profile:{asset:assetName,count,root:manifest.root,totalAmount:manifest.totalAmount,proofDepths:[...new Set(manifest.leaves.map(l=>l.proof.length))].sort((a,b)=>a-b),
      uniqueSignatures:signatures.size,uniqueWires:wires.size,minWire,maxWire,attemptBytes:Buffer.byteLength(JSON.stringify(f.plan.payoutAttempts)),
      planBytes:Buffer.byteLength(JSON.stringify(f.plan)),constructionMs:performance.now()-started,mockedSendCalls:f.sends,networkCalls:0,onChainTransactions:0}};
}
