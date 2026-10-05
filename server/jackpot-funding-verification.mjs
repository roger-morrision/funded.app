import { jackpotContribution } from './jackpot-model.mjs';
import { verifyJackpotTraderEntry } from './jackpot-entry-verification.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const key = row => typeof row.pubkey === 'string' ? row.pubkey : row.pubkey?.toBase58?.();

// Verify a Solana transfer from the configured app-fee owner, backed by the
// exact finalized trade signatures whose fees it contributes to this round.
export async function verifyTraderJackpotFunding({ connection, expectedGenesisHash,
  sourceSignatures, fundingSignature, feeOwner, vault, window }) {
  if (!connection || !expectedGenesisHash || await connection.getGenesisHash() !== expectedGenesisHash)
    throw new Error('Trusted Solana RPC is required.');
  if (!ADDRESS.test(String(feeOwner || '')) || !ADDRESS.test(String(vault || ''))
    || feeOwner === vault || !SIGNATURE.test(String(fundingSignature || ''))
    || !Array.isArray(sourceSignatures) || !sourceSignatures.length
    || sourceSignatures.length > 1000
    || sourceSignatures.some(value => !SIGNATURE.test(String(value || '')))
    || new Set(sourceSignatures).size !== sourceSignatures.length
    || sourceSignatures.includes(fundingSignature))
    throw new Error('Funding source signatures and vault are invalid.');
  const trades = [];
  for (const signature of sourceSignatures) {
    trades.push(await verifyJackpotTraderEntry({ connection, expectedGenesisHash,
      signature, feeOwner, window }));
  }
  const fees = trades.reduce((sum, row) => sum + BigInt(row.feeLamports), 0n);
  const expected = BigInt(jackpotContribution(fees.toString(), 500));
  if (expected <= 0n) throw new Error('Verified trade fees cannot fund a positive jackpot transfer.');
  const tx = await connection.getParsedTransaction(fundingSignature,
    { commitment:'finalized', maxSupportedTransactionVersion:0 });
  if (!tx || tx.meta?.err || !Number.isSafeInteger(tx.blockTime)
    || tx.blockTime < window.start || tx.blockTime >= window.end
    || tx.blockTime < Math.max(...trades.map(row => row.blockTime))
    || tx.transaction?.message?.instructions?.length !== 1)
    throw new Error('A finalized in-window funding transfer after the source trades is required.');
  const instruction = tx.transaction.message.instructions[0];
  if (instruction.program !== 'system' || instruction.parsed?.type !== 'transfer'
    || instruction.parsed.info.source !== feeOwner || instruction.parsed.info.destination !== vault
    || String(instruction.parsed.info.lamports) !== expected.toString())
    throw new Error('Jackpot vault transfer does not match 5% of verified app fees.');
  const keys = tx.transaction.message.accountKeys;
  const sourceIndex = keys.findIndex(row => key(row) === feeOwner);
  const vaultIndex = keys.findIndex(row => key(row) === vault);
  const meta = tx.meta;
  if (sourceIndex < 0 || vaultIndex < 0 || sourceIndex === vaultIndex
    || keys[sourceIndex].signer !== true || !Number.isSafeInteger(meta.fee)
    || ![meta.preBalances?.[sourceIndex], meta.postBalances?.[sourceIndex],
      meta.preBalances?.[vaultIndex], meta.postBalances?.[vaultIndex]].every(Number.isSafeInteger)
    || BigInt(meta.postBalances[vaultIndex] - meta.preBalances[vaultIndex]) !== expected
    || BigInt(meta.preBalances[sourceIndex] - meta.postBalances[sourceIndex])
      !== expected + BigInt(meta.fee))
    throw new Error('Finalized jackpot funding balance changes do not match.');
  return { kind:'trader', cluster:'devnet', finalized:true, onchainVerified:true,
    feeSourceVerified:true, signature:fundingSignature, vault,
    sourceSignatures:[...sourceSignatures].sort(), sourceFeeLamports:fees.toString(),
    transferLamports:expected.toString(), blockTime:tx.blockTime };
}
