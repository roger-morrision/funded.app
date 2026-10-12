import assert from 'node:assert/strict';
import { PublicKey, Transaction } from '@solana/web3.js';
import { buildMintRouterSettlementInstruction } from '../server/mint-router-payout.mjs';

export function verifyPreparedRewardFundingTransaction({ serializedTransaction, programId, mint,
  authority, creator, recipient, amountLamports, requestId, claimDomain }) {
  const settlement = buildMintRouterSettlementInstruction({ programId, mint, authority, creator,
    recipient, amountLamports, obligationId:requestId, claimDomain });
  const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'));
  assert.equal(transaction.feePayer?.toBase58(), new PublicKey(authority).toBase58(),
    'The prepared transaction has another fee payer.');
  const exact = new Transaction({ feePayer:new PublicKey(authority),
    recentBlockhash:transaction.recentBlockhash }).add(settlement.instruction);
  assert(transaction.serializeMessage().equals(exact.serializeMessage()),
    'Prepared transaction differs from the capped allocation.');
  return { transaction, settlement };
}
