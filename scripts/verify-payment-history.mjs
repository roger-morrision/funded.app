import assert from 'node:assert/strict';
import { createPaymentHistoryReader, verifyAutomaticPayment } from '../server/payment-history.mjs';

const sender = '7'.repeat(44), receiver = '8'.repeat(44), signature = '9'.repeat(88);
const schedule = { kind:'holder', asset:'SOL' };
const payment = { status:'paid', finalized:true, balanceDeltaVerified:true, signature, amount:'118812', paidAt:'2026-10-06T09:45:41Z' };
const transaction = { slot:508052118, blockTime:1791279941, transaction:{ signatures:[signature], message:{accountKeys:[sender,receiver]} },
  meta:{ err:null, fee:5000, preBalances:[1_000_000,1000], postBalances:[876188,119812] } };
const proof = verifyAutomaticPayment(schedule, receiver, payment, transaction);
assert.equal(proof.actualReceivedLamports,118812);
assert.equal(proof.feeLamports,5000);
assert.equal(proof.feePayer,sender);
assert.equal(verifyAutomaticPayment(schedule,receiver,payment,{...transaction,meta:{...transaction.meta,postBalances:[876188,119811]}}),null);
assert.equal(verifyAutomaticPayment(schedule,receiver,{...payment,finalized:false},transaction),null);
assert.equal(verifyAutomaticPayment(schedule,receiver,payment,{...transaction,meta:{...transaction.meta,err:{InstructionError:[0,'Custom']}}}),null);
const receiverPays = { ...transaction, transaction:{ ...transaction.transaction, message:{ accountKeys:[receiver,sender] } },
  meta:{ ...transaction.meta, preBalances:[1000,1_000_000], postBalances:[114812,881188] } };
assert.equal(verifyAutomaticPayment(schedule,receiver,payment,receiverPays)?.actualReceivedLamports,113812);

const ledger = { schedules:{ first:{ ...schedule, payments:{ [receiver]:payment } } } };
const read = createPaymentHistoryReader({ cluster:'devnet', officialGenesis:async()=>'devnet-test',
  readEvidence:async()=>({ cluster:'devnet', commitment:'finalized', status:'onchain-indexed', verifiedPayouts:[] }),
  rewardsStore:{ read:async()=>ledger },
  connectionFactory:()=>({ getGenesisHash:async()=>'devnet-test', getTransaction:async()=>transaction }) });
const result = await read();
assert.equal(result.status,'onchain-indexed');
assert.equal(result.verifiedPayouts.length,1);
assert.equal(result.verifiedPayouts[0].source,'automatic-holder');
assert.equal(result.verifiedPayouts[0].actualReceivedLamports,118812);
const wrongChain = createPaymentHistoryReader({ cluster:'devnet', officialGenesis:async()=>'wrong-chain',
  readEvidence:async()=>({ cluster:'devnet', commitment:'finalized', status:'onchain-indexed', verifiedPayouts:[] }),
  rewardsStore:{ read:async()=>ledger },
  connectionFactory:()=>({ getGenesisHash:async()=>'devnet-test' }) });
assert.equal((await wrongChain()).status,'partial');
assert.equal((await wrongChain()).verifiedPayouts.length,0);
console.log('Payment history verified payout time, fee payer, recipient delta, failed receipt rejection, and network guard (mocked RPC).');
