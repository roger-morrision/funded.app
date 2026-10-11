import assert from 'node:assert/strict';
import { createPaymentHistoryReader, verifyAutomaticPayment } from '../server/payment-history.mjs';
import { filterPaymentHistory } from '../src/features/payments/receipt-view.js';

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

const mint = '5'.repeat(44), obligationId = 'x-obligation', sourceId = 'x-funding';
const xState = { launches:{ [mint]:{ mint, cluster:'devnet', onchainVerified:true, xUserId:'123',
  feeDistribution:{ creatorDirected:{ recipients:{ xAccount:'@JohnTrand83' } } } } },
  obligations:{ [obligationId]:{ mint, xUserId:'123' } },
  claims:{ claim:{ obligationId, publicKey:receiver, xUserId:'123', xAttestation:{ subject:'123' } } } };
const xLedger = { fundingRequests:{ [sourceId]:{ kind:'x', mint, recipient:receiver, obligationId } },
  schedules:{ x:{ kind:'x', asset:'SOL', mint, sourceId, payments:{ [receiver]:payment } } } };
const xReader = (state, evidence = []) => createPaymentHistoryReader({ cluster:'devnet',
  officialGenesis:async()=>'devnet-test', readEvidence:async()=>({ cluster:'devnet', commitment:'finalized',
    status:'onchain-indexed', verifiedPayouts:evidence }), rewardsStore:{ read:async()=>xLedger },
  store:{ read:async()=>state }, connectionFactory:()=>({ getGenesisHash:async()=>'devnet-test',
    getTransaction:async()=>transaction }) });
assert.equal((await xReader(xState)()).verifiedPayouts[0].xHandle,'@JohnTrand83');
assert.equal((await xReader({ ...xState, claims:{} })()).verifiedPayouts[0].xHandle,undefined);
assert.equal((await xReader({ ...xState, obligations:{ [obligationId]:{ mint, xUserId:'456' } } })()).verifiedPayouts[0].xHandle,undefined);
const legacy = { ...proof, source:'mint-router-settle-mint' };
const legacyState = { ...xState, payouts:{ claim:{ source:'mint-router-settle-mint', status:'paid',
  cluster:'devnet', mint, obligationId, signature, from:sender, to:receiver, amountLamports:118812 } } };
const legacyReader = createPaymentHistoryReader({ cluster:'devnet', officialGenesis:async()=>'devnet-test',
  readEvidence:async()=>({ cluster:'devnet', commitment:'finalized', status:'onchain-indexed', verifiedPayouts:[legacy] }),
  rewardsStore:{ read:async()=>({ schedules:{} }) }, store:{ read:async()=>legacyState }, connectionFactory:()=>({}) });
assert.equal((await legacyReader()).verifiedPayouts[0].xHandle,'@JohnTrand83');
const historical = createPaymentHistoryReader({ cluster:'devnet', officialGenesis:async()=>'devnet-test',
  readEvidence:async()=>({ cluster:'devnet', commitment:'finalized', status:'partial', verifiedPayouts:[] }),
  rewardsStore:{ read:async()=>({ schedules:{} }) }, store:{ read:async()=>legacyState },
  connectionFactory:()=>({ getGenesisHash:async()=>'devnet-test', getTransaction:async()=>({ ...transaction,
    meta:{ ...transaction.meta, preBalances:[1_000_000,1000], postBalances:[876188,119812] } }) }) });
assert.equal((await historical()).verifiedPayouts[0].xHandle,'@JohnTrand83');
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const allEvidence = Array.from({length:35}, (_, index) => ({ ...proof, signature:alphabet[index].repeat(88), slot:index + 1, blockTime:1791279941 - index }));
const fullReader = createPaymentHistoryReader({ cluster:'devnet', officialGenesis:async()=>'devnet-test',
  readEvidence:async()=>({ cluster:'devnet', commitment:'finalized', status:'onchain-indexed', verifiedPayouts:allEvidence }),
  rewardsStore:{ read:async()=>({ schedules:{} }) }, store:{ read:async()=>({}) }, connectionFactory:()=>({}) });
assert.equal((await fullReader()).verifiedPayouts.length,35);
assert.equal(filterPaymentHistory([
  { source:'automatic-holder', blockTime:Date.parse('2026-10-06T23:59:59Z') / 1000 },
  { source:'automatic-holder', blockTime:Date.parse('2026-10-07T00:00:00Z') / 1000 },
  { source:'automatic-x', blockTime:null },
], { type:'holder', from:'2026-10-07', to:'2026-10-07' }).length,1);
console.log('Payment history verified payout deltas, network guard, and X handle attribution (mocked RPC).');
