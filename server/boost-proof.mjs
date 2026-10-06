import { ComputeBudgetProgram, PublicKey, SystemProgram } from '@solana/web3.js';
import { BOOST_MEMO_PROGRAM, boostMemo } from '../boost-offer.js';

function address(value) { return value?.toBase58?.() || String(value || ''); }

export function verifyBoostPayment(transaction, quote) {
  if (!transaction || !transaction.meta || transaction.meta.err !== null || !Number.isSafeInteger(transaction.blockTime))
    throw new Error('A finalized, successful transaction with a block time is required.');
  const transactionTime = transaction.blockTime * 1000;
  if (transactionTime < Date.parse(quote.createdAt) - 30_000 || transactionTime > Date.parse(quote.expiresAt) + 30_000)
    throw new Error('The payment was outside the quote window.');
  const message = transaction.transaction?.message;
  const keys = message?.accountKeys || [];
  if (address(keys[0]?.pubkey || keys[0]) !== quote.payer || !keys[0]?.signer || keys.filter(key => key.signer).length !== 1)
    throw new Error('The quoted wallet must be the only transaction signer and fee payer.');
  const instructions = message?.instructions || [];
  const paymentStart = instructions.findIndex(instruction => address(instruction.programId) !== ComputeBudgetProgram.programId.toBase58());
  if (paymentStart < 0 || instructions.slice(paymentStart).some(instruction => address(instruction.programId) === ComputeBudgetProgram.programId.toBase58())
    || instructions.length - paymentStart !== 2)
    throw new Error('The payment must contain exactly one transfer and one boost memo.');
  const [transfer, memo] = instructions.slice(paymentStart);
  if (address(transfer.programId) !== SystemProgram.programId.toBase58() || transfer.parsed?.type !== 'transfer'
    || transfer.parsed?.info?.source !== quote.payer || transfer.parsed?.info?.destination !== quote.recipient
    || Number(transfer.parsed?.info?.lamports) !== quote.lamports)
    throw new Error('The payment transfer does not match the quote.');
  if (address(memo.programId) !== BOOST_MEMO_PROGRAM || memo.parsed !== boostMemo(quote.id))
    throw new Error('The payment memo does not match the quote.');
  if (quote.cluster !== 'devnet' || new PublicKey(quote.recipient).toBase58() !== quote.recipient)
    throw new Error('Boost payment configuration is invalid.');
  return { slot: transaction.slot, startsAt: new Date(transactionTime).toISOString(),
    expiresAt: new Date(transactionTime + quote.hours * 3_600_000).toISOString() };
}
