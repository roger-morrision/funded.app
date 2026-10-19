import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey} from '@solana/web3.js';
import {createAutomaticRewardChain,rewardAddresses} from '../server/automatic-reward-chain.mjs';
import {buildRewardManifest,SOL_ASSET_MINT} from '../reward-merkle.js';

function fixture(){
  const keys=Array.from({length:4},(_,n)=>Keypair.fromSeed(Buffer.alloc(32,n+90)));
  const [authority,program,mint,recipient]=keys,cycleId='a'.repeat(64);
  const manifest=buildRewardManifest({cycleId,asset:'SOL',allocations:[{recipient:recipient.publicKey.toBase58(),amount:'1000'}]});
  const plan={mint:mint.publicKey.toBase58(),cutoffAt:100,payoutAt:101,manifest},leaf=manifest.leaves[0];
  const addresses=rewardAddresses({programId:program.publicKey,authority:authority.publicKey,mint:mint.publicKey,cycleId,recipient:recipient.publicKey});
  const cycle=Buffer.alloc(174),payment=Buffer.alloc(100);
  createHash('sha256').update('account:RewardCycle').digest().copy(cycle,0,0,8);
  addresses.vault.toBuffer().copy(cycle,8);Buffer.from(cycleId,'hex').copy(cycle,40);Buffer.from(manifest.root,'hex').copy(cycle,72);
  new PublicKey(SOL_ASSET_MINT).toBuffer().copy(cycle,104);cycle.writeBigUInt64LE(1000n,136);cycle.writeBigUInt64LE(1000n,144);
  cycle.writeBigInt64LE(100n,152);cycle.writeBigInt64LE(101n,160);cycle.writeUInt32LE(1,168);cycle[173]=1;
  createHash('sha256').update('account:RewardPayment').digest().copy(payment,0,0,8);
  addresses.cycle.toBuffer().copy(payment,8);recipient.publicKey.toBuffer().copy(payment,40);
  payment.writeBigUInt64LE(1000n,72);payment.writeUInt32LE(0,80);payment.writeBigInt64LE(102n,84);payment.writeBigUInt64LE(1000n,92);
  const accounts=new Map([[addresses.cycle.toBase58(),{owner:program.publicKey,data:cycle}],
    [addresses.payment.toBase58(),{owner:program.publicKey,data:payment}]]);
  const commitments=[];
  const connection={getAccountInfo:async(address,commitment)=>{commitments.push(commitment);return accounts.get(address.toBase58())||null;},
    sendRawTransaction:()=>{throw new Error('Inspection must never submit a transaction.');}};
  return {chain:createAutomaticRewardChain({connection,programId:program.publicKey,authority}),plan,leaf,accounts,addresses,cycle,payment,commitments};
}

test('residual review can inspect an exact finalized payment without signing or writing',async()=>{
  const f=fixture(),proof=await f.chain.inspectLeaf(f.plan,f.leaf);
  assert.deepEqual(proof,{payment:f.addresses.payment.toBase58(),amount:'1000',amountReceived:'1000',finalized:true});
  assert.deepEqual(f.commitments,['finalized','finalized']);
  f.accounts.delete(f.addresses.payment.toBase58());
  assert.equal(await f.chain.inspectLeaf(f.plan,f.leaf),null);
});

test('inspection rejects altered cycle roots, wrong owners and conflicting paid amounts',async()=>{
  const root=fixture();root.cycle[72]^=1;
  await assert.rejects(root.chain.inspectLeaf(root.plan,root.leaf),/conflicts/);
  const owner=fixture();owner.accounts.get(owner.addresses.payment.toBase58()).owner=Keypair.generate().publicKey;
  await assert.rejects(owner.chain.inspectLeaf(owner.plan,owner.leaf),/conflicts/);
  const amount=fixture();amount.payment.writeBigUInt64LE(999n,72);
  await assert.rejects(amount.chain.inspectLeaf(amount.plan,amount.leaf),/conflicts/);
});
