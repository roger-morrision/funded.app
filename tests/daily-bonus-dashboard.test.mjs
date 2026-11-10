import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {readBonusPool} from '../server/daily-bonus-dashboard.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
const key=()=>Keypair.generate().publicKey.toBase58();
function fixture(){
  const mint=key(),programId=key(),creator=key(),referrer=key(),now=Date.parse('2026-11-10T04:00:00Z')/1000;
  const state={launches:{[mint]:{cluster:'devnet',mint,creatorWallet:creator,onchainVerified:true,
    pumpFeeRoute:{programId,verified:true},feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}}},collections:{},v3Settlements:{}};
  for(const [signature,blockTime]of [['today',now-60],['old',now-86400]]){
    state.collections[signature]={signature,mint,cluster:'devnet',programId,status:'collected',onchainVerified:true,
      scope:'per-mint-v3',attribution:'mint-verified',claimId:'a'.repeat(64),collectedLamports:'1000'};
    state.v3Settlements[signature]={status:'finalized',cluster:'devnet',blockTime,settlementSignature:signature,referralUpline:[referrer]};
  }
  const calls=[];let fail=false;
  const args={state,programId,now,proofCache:new Map(),connection:{getGenesisHash:async()=>SOLANA_GENESIS.devnet,
    getTransaction:async signature=>{calls.push('collection:'+signature);return {blockTime:now-70};}},
    loadSettlement:async({signature})=>{calls.push('settlement:'+signature);return {blockTime:now-60,categoryLamports:[0,0,0,0,0,100]};},
    verifyCollection:async()=>fail?null:{claimId:Buffer.from('a'.repeat(64),'hex'),expectedLamports:1000}};
  return {args,calls,fail:value=>{fail=value;}};
}
test('provisional bonus pool excludes past days and reuses only verified unchanged receipts',async()=>{
  const f=fixture();const first=await readBonusPool(f.args);
  assert.equal(first.collections,1);assert.deepEqual(f.calls,['settlement:today','collection:today']);
  assert.deepEqual(await readBonusPool(f.args),first);assert.equal(f.calls.length,2);
  f.args.state.v3Settlements.today.referralUpline=[key()];
  await readBonusPool(f.args);assert.equal(f.calls.length,4);
  f.args.connection.getGenesisHash=async()=>SOLANA_GENESIS['mainnet-beta'];
  await assert.rejects(readBonusPool(f.args),/network does not match/);
});
test('incomplete proofs are never cached as bonus rankings',async()=>{
  const f=fixture();f.fail(true);await assert.rejects(readBonusPool(f.args),/collection proof/);
  assert.equal(f.args.proofCache.size,0);
  f.fail(false);assert.equal((await readBonusPool(f.args)).collections,1);
  assert.equal(f.calls.length,4);
});
