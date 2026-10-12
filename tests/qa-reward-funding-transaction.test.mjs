import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Transaction } from '@solana/web3.js';
import { buildMintRouterSettlementInstruction } from '../server/mint-router-payout.mjs';
import { verifyPreparedRewardFundingTransaction } from '../scripts/qa-reward-funding-transaction.mjs';

const address = byte => Keypair.fromSeed(Buffer.alloc(32, byte)).publicKey.toBase58();
const input = {
  programId:address(1), mint:address(2), authority:address(3), creator:address(4),
  recipient:address(5), amountLamports:'1790808', requestId:'fixture:holders',
  claimDomain:'holder-funding',
};

function prepared(options = {}) {
  const details = { ...input, ...options };
  const settlement = buildMintRouterSettlementInstruction({ programId:details.programId,
    mint:details.mint, authority:details.authority, creator:details.creator,
    recipient:details.recipient, amountLamports:details.amountLamports,
    obligationId:details.requestId, claimDomain:details.claimDomain });
  return new Transaction({ feePayer:Keypair.fromSeed(Buffer.alloc(32, 3)).publicKey,
    recentBlockhash:address(6) }).add(settlement.instruction)
    .serialize({ requireAllSignatures:false, verifySignatures:false }).toString('base64');
}

test('bounded QA accepts only the exact unsigned settlement instruction and fee payer', () => {
  const serializedTransaction = prepared();
  const result = verifyPreparedRewardFundingTransaction({ ...input, serializedTransaction });
  assert.equal(result.transaction.instructions.length, 1);
  assert.equal(result.settlement.claimId.length, 32);
  assert.throws(() => verifyPreparedRewardFundingTransaction({ ...input,
    amountLamports:'1790809', serializedTransaction }), /differs from the capped allocation/);
  assert.throws(() => verifyPreparedRewardFundingTransaction({ ...input,
    recipient:address(7), serializedTransaction }), /differs from the capped allocation/);
  assert.throws(() => verifyPreparedRewardFundingTransaction({ ...input,
    authority:address(7), serializedTransaction }), /another fee payer/);
});
