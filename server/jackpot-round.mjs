import { createHash } from 'node:crypto';
import { CREATOR_SHARE_BPS, TRADER_FEE_BPS, JACKPOT_PERIOD_SECONDS,
  eligibleJackpotEntries, jackpotContribution, selectJackpotWinner,
  verifiedJackpotPayout } from './jackpot-model.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

// Isolated round calculation. The caller must supply receipts verified against
// finalized Solana transactions; this module does not turn claims into proof.
export function prepareJackpotRound({ kind, window, nowSeconds, entryReceipts,
  contributionReceipts, entropyProof, vault }) {
  if (!['creator', 'trader'].includes(kind)) throw new Error('Invalid jackpot kind.');
  if (!window || !Number.isSafeInteger(window.start) || !Number.isSafeInteger(window.end)
    || window.start % JACKPOT_PERIOD_SECONDS !== 0
    || window.end - window.start !== JACKPOT_PERIOD_SECONDS
    || !Number.isSafeInteger(nowSeconds) || nowSeconds < window.end)
    throw new Error('Jackpot round is not closed.');
  if (!ADDRESS.test(String(vault || ''))) throw new Error('Invalid jackpot vault.');
  if (!entropyProof || entropyProof.cluster !== 'devnet' || entropyProof.finalized !== true
    || entropyProof.independent !== true || !SIGNATURE.test(String(entropyProof.sourceSignature || ''))
    || !Number.isSafeInteger(entropyProof.blockTime) || entropyProof.blockTime < window.end
    || entropyProof.blockTime > nowSeconds)
    throw new Error('Independent finalized draw entropy is missing.');

  const entries = eligibleJackpotEntries(kind, entryReceipts, window);
  if (!entries.length) throw new Error('No eligible entries.');
  const bps = kind === 'creator' ? CREATOR_SHARE_BPS : TRADER_FEE_BPS;
  const seen = new Set();
  const seenSources = new Set();
  let prize = 0n;
  let sourceFees = 0n;
  const funding = [];
  for (const row of contributionReceipts || []) {
    if (!row || row.cluster !== 'devnet' || row.kind !== kind || row.finalized !== true
      || row.onchainVerified !== true || row.feeSourceVerified !== true
      || row.vault !== vault || !SIGNATURE.test(String(row.signature || ''))
      || !Array.isArray(row.sourceSignatures) || !row.sourceSignatures.length
      || row.sourceSignatures.some(source => !SIGNATURE.test(String(source || ''))
        || seenSources.has(source))
      || new Set(row.sourceSignatures).size !== row.sourceSignatures.length
      || !Number.isSafeInteger(row.blockTime) || row.blockTime < window.start
      || row.blockTime >= window.end || seen.has(row.signature))
      throw new Error('Invalid or duplicate jackpot funding receipt.');
    if (!/^[1-9]\d*$/.test(String(row.sourceFeeLamports || ''))
      || !/^[1-9]\d*$/.test(String(row.transferLamports || '')))
      throw new Error('Jackpot funding does not match the fee share.');
    seen.add(row.signature);
    row.sourceSignatures.forEach(source => seenSources.add(source));
    sourceFees += BigInt(row.sourceFeeLamports);
    prize += BigInt(row.transferLamports);
    funding.push({ signature:row.signature, sourceSignatures:[...row.sourceSignatures].sort(),
      sourceFeeLamports:String(row.sourceFeeLamports), amountLamports:String(row.transferLamports) });
  }
  if (!funding.length || prize <= 0n) throw new Error('Jackpot has no verified funding.');
  if (prize !== BigInt(jackpotContribution(sourceFees.toString(), bps)))
    throw new Error('Jackpot funding does not match the aggregate fee share.');
  funding.sort((a, b) => a.signature < b.signature ? -1 : 1);
  const entrySnapshot = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  const fundingSnapshot = createHash('sha256').update(JSON.stringify(funding)).digest('hex');
  const id = `${kind}:${window.start}`;
  const draw = selectJackpotWinner(entries, entropyProof.entropyHex, id);
  return { id, kind, cluster:'devnet', status:'drawn', windowStart:window.start,
    windowEnd:window.end, vault, prizeLamports:prize.toString(), entryCount:entries.length,
    entrySnapshot, fundingSnapshot, funding, entropySource:entropyProof.sourceSignature,
    ...draw };
}

export function settleJackpotRound(round, proof, existingReceipts = []) {
  if (existingReceipts.some(row => row.roundId === round?.id || row.signature === proof?.signature))
    throw new Error('Jackpot payout already recorded.');
  return verifiedJackpotPayout({ round, proof });
}

// Query finalized chain data rather than accepting a caller's payout flags.
// expectedGenesisHash must be the trusted test network genesis hash from deployment config.
export async function verifyJackpotPayoutOnchain({ connection, expectedGenesisHash,
  round, signature, existingReceipts = [] }) {
  if (!connection || !expectedGenesisHash || !SIGNATURE.test(String(signature || '')))
    throw new Error('Trusted test network RPC and payout signature are required.');
  if (await connection.getGenesisHash() !== expectedGenesisHash)
    throw new Error('Payout RPC is on the wrong Solana cluster.');
  const tx = await connection.getParsedTransaction(signature,
    { commitment:'finalized', maxSupportedTransactionVersion:0 });
  if (!tx || tx.meta?.err || !Number.isSafeInteger(tx.blockTime)
    || !Array.isArray(tx.transaction?.message?.instructions)
    || tx.transaction.message.instructions.length !== 1)
    throw new Error('Payout transaction is missing, failed, or not a single transfer.');
  const instruction = tx.transaction.message.instructions[0];
  if (instruction.program !== 'system' || instruction.parsed?.type !== 'transfer'
    || instruction.parsed?.info?.source !== round?.vault
    || instruction.parsed?.info?.destination !== round?.winner
    || String(instruction.parsed?.info?.lamports) !== String(round?.prizeLamports))
    throw new Error('Payout transfer does not match the draw.');
  const keys = tx.transaction.message.accountKeys.map(row =>
    typeof row.pubkey === 'string' ? row.pubkey : row.pubkey?.toBase58?.());
  const fromIndex = keys.indexOf(round.vault);
  const toIndex = keys.indexOf(round.winner);
  const amount = BigInt(round.prizeLamports);
  const meta = tx.meta;
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex
    || !tx.transaction.message.accountKeys[fromIndex].signer
    || !Array.isArray(meta?.preBalances) || !Array.isArray(meta?.postBalances)
    || !Number.isSafeInteger(meta.fee) || meta.fee < 0
    || ![meta.preBalances[fromIndex], meta.postBalances[fromIndex],
      meta.preBalances[toIndex], meta.postBalances[toIndex]].every(Number.isSafeInteger)
    || BigInt(meta.postBalances[toIndex]) - BigInt(meta.preBalances[toIndex]) !== amount
    || BigInt(meta.preBalances[fromIndex]) - BigInt(meta.postBalances[fromIndex])
      !== amount + BigInt(meta.fee))
    throw new Error('Finalized payout balance changes do not match the draw.');
  const proof = { signature, cluster:'devnet', commitment:'finalized',
    transactionSucceeded:true, balanceDeltaVerified:true, from:round.vault,
    to:round.winner, amountLamports:round.prizeLamports, blockTime:tx.blockTime };
  return settleJackpotRound(round, proof, existingReceipts);
}
