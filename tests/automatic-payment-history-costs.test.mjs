import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentHistoryReader, verifyAutomaticPayment } from '../server/payment-history.mjs';

const wallet='7'.repeat(44), receipt='8'.repeat(44), signature='9'.repeat(88);
const schedule={kind:'holder',asset:'SOL'};
const payment={status:'paid',finalized:true,balanceDeltaVerified:true,signature,
  amount:'215886',payment:receipt};
const transaction={slot:512461000,blockTime:1792332646,
  transaction:{signatures:[signature],message:{accountKeys:[wallet,receipt]}},
  meta:{err:null,fee:5000,preBalances:[2000000,0],postBalances:[1052646,1158240]}};

test('a self-paid holder reward reconciles gross reward, fee, receipt rent and signed wallet change',()=>{
  const proof=verifyAutomaticPayment(schedule,wallet,payment,transaction);
  assert.equal(proof.amountLamports,215886);
  assert.equal(proof.actualReceivedLamports,-947354);
  assert.equal(proof.recipientRentLamports,1158240);
  assert.equal(proof.amountLamports-proof.feeLamports-proof.recipientRentLamports,proof.actualReceivedLamports);
  for(const tx of [
    {...transaction,meta:{...transaction.meta,postBalances:[1052647,1158240]}},
    {...transaction,meta:{...transaction.meta,preBalances:[2000000,1]}},
    {...transaction,meta:{...transaction.meta,postBalances:[1052646,0]}},
    {...transaction,meta:{...transaction.meta,err:{InstructionError:[0,'failed']}}},
  ]) assert.equal(verifyAutomaticPayment(schedule,wallet,payment,tx),null);
  assert.equal(verifyAutomaticPayment(schedule,wallet,{...payment,payment:'6'.repeat(44)},transaction),null);
});

test('verified negative net changes remain in history instead of being hidden or represented as gains',async()=>{
  const read=createPaymentHistoryReader({cluster:'devnet',officialGenesis:async()=>'devnet',
    readEvidence:async()=>({cluster:'devnet',commitment:'finalized',status:'onchain-indexed',verifiedPayouts:[]}),
    rewardsStore:{read:async()=>({schedules:{one:{...schedule,payments:{[wallet]:payment}}}})},
    connectionFactory:()=>({getGenesisHash:async()=>'devnet',getTransaction:async()=>transaction})});
  const history=await read();
  assert.equal(history.status,'onchain-indexed');assert.equal(history.verifiedPayouts.length,1);
  assert.equal(history.verifiedPayouts[0].actualReceivedLamports,-947354);
  assert.match(history.note,/net debit/);
});
