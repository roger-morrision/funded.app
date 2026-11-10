import test from 'node:test';
import assert from 'node:assert/strict';
import {walletRewardTotals} from '../server/wallet-reward-totals.mjs';
const wallet='ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const history=cluster=>({cluster,status:'onchain-indexed',commitment:'finalized',payoutCoverage:{status:'verified'},
  verifiedPayouts:[{to:wallet,signature:'receipt',source:'daily-bonus',actualReceivedLamports:'100'}]});
for(const cluster of ['devnet','mainnet-beta'])test(`wallet totals accept only finalized ${cluster} evidence`,()=>{
  const result=walletRewardTotals({wallet,cluster,history:history(cluster)});
  assert.equal(result.bonusLamports,'100');assert.equal(result.cluster,cluster);
  assert.equal(walletRewardTotals({wallet,cluster,history:history(cluster==='devnet'?'mainnet-beta':'devnet')}).bonusLamports,null);
  assert.equal(walletRewardTotals({wallet,cluster,history:{...history(cluster),payoutCoverage:{status:'partial'}}}).bonusLamports,null);
});
test('wallet totals require an explicit supported network',()=>{
  assert.throws(()=>walletRewardTotals({wallet,history:history('devnet')}),/Unsupported Solana network/);
});
