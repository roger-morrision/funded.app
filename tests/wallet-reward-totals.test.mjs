import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {walletRewardTotals} from '../server/wallet-reward-totals.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey.toBase58();
const wallet=key(31),other=key(32),mint=key(33),payment=key(34),programId=key(35);
const history=rows=>({cluster:'devnet',status:'onchain-indexed',commitment:'finalized',payoutCoverage:{status:'verified'},verifiedPayouts:rows});
test('received totals use finalized net credits, isolate the wallet and deduplicate receipts',()=>{
  const row={to:wallet,signature:'bonus',source:'daily-bonus',actualReceivedLamports:'25',amountLamports:'100'};
  const result=walletRewardTotals({wallet,history:history([row,row,
    {...row,to:other,signature:'other',actualReceivedLamports:'1000'},
    {...row,signature:'holder',source:'automatic-holder',actualReceivedLamports:'41'},
    {...row,signature:'creator',source:'v3-creator-wallet',actualReceivedLamports:'9'}])});
  assert.equal(result.bonusLamports,'25');assert.equal(result.rewardsLamports,'50');assert.equal(result.airdrops,null);
});
test('unavailable or conflicting evidence never becomes a zero received total',()=>{
  const row={to:wallet,signature:'bonus',source:'daily-bonus',actualReceivedLamports:'25'};
  for(const data of [{}, {...history([row]),commitment:'confirmed'},history([{...row,actualReceivedLamports:null}]),
    history([row,{...row,actualReceivedLamports:'26'}])]){
    const result=walletRewardTotals({wallet,history:data});assert.equal(result.bonusLamports,null);assert.equal(result.rewardsLamports,null);
  }
});
test('airdrop totals keep each token separate and require fresh matching immutable allocations',()=>{
  const now=Date.now(),ledger={communityClaimIndex:{cluster:'devnet',status:'verified',commitment:'finalized',indexedAt:new Date(now).toISOString(),programId,
    payments:[{mint,payment,recipient:wallet,amountBaseUnits:'2000000'}]},
    communityDrops:{[mint]:{openingSignature:'opening',programId,reservedBaseUnits:'30000000',reservedTokens:30,
      manifest:{leaves:[{recipient:wallet,amount:'2000000'}]}}}};
  assert.deepEqual(walletRewardTotals({wallet,ledger,now,launches:{[mint]:{symbol:'ONE'}}}).airdrops,
    [{mint,symbol:'ONE',decimals:6,amountBaseUnits:'2000000'}]);
  assert.equal(walletRewardTotals({wallet,ledger,now:now+600001}).airdrops,null);
  ledger.communityDrops[mint].reservedBaseUnits=undefined;
  assert.equal(walletRewardTotals({wallet,ledger,now}).airdrops,null);
});
