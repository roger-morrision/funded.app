import { ComputeBudgetProgram, PublicKey } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID, bondingCurvePda } from '@pump-fun/pump-sdk';
import bs58 from 'bs58';
import { decodeDeveloperTokenLock, developerLockAddresses, developerLockInstruction, developerLockProgramId } from '../developer-token-lock.js';
import { normalizeDeveloperLockSeconds } from '../developer-lock-period.js';

// A coin paired with a token (USDC, ...) cannot fit its developer escrow in the
// atomic launch transaction, so the developer buy follows in one second
// transaction that buys on the curve and escrows every purchased token. This
// verifies that transaction: signed by the creator right after the launch,
// only Pump, the escrow and account setup, the creator ends holding none of the
// coin, and the escrow received exactly the purchase for the signed lock period.
export const PAIRED_DEVELOPER_BUY_MAX_SLOTS = 900;
const MAX_DEVELOPER_BASE_UNITS = 200_000_000n * 1_000_000n;

const keysOf = transaction => {
  const message = transaction.transaction.message;
  return [...(message.accountKeys || message.staticAccountKeys || []), ...(transaction.meta?.loadedAddresses?.writable || []),
    ...(transaction.meta?.loadedAddresses?.readonly || [])].map(key => new PublicKey(key.pubkey || key).toBase58());
};
const amountOf = row => BigInt(row?.uiTokenAmount?.amount || 0);

export async function verifyPairedDeveloperBuy({ connection, proof, buyTransaction, buySignature, config, serviceQuote, lockSeconds,
  maxSlots = PAIRED_DEVELOPER_BUY_MAX_SLOTS }) {
  lockSeconds = normalizeDeveloperLockSeconds(lockSeconds);
  if (!config?.ready) throw Error('The approved developer token escrow is unavailable.');
  const tx = buyTransaction;
  if (!tx || tx.meta?.err !== null || tx.transaction?.signatures?.[0] !== buySignature || !Number.isSafeInteger(tx.slot)
    || !Number.isSafeInteger(tx.blockTime))
    throw Error('A finalized developer buy transaction is required.');
  if (tx.slot <= proof.slot || tx.slot - proof.slot > maxSlots)
    throw Error('The developer buy must follow the launch within its verification window.');
  const keys = keysOf(tx), creator = proof.feePayer, mint = new PublicKey(proof.mint);
  if (keys[0] !== creator) throw Error('The creator must sign and pay for the developer buy.');
  const programId = developerLockProgramId(config.programId);
  const allowed = new Set([ComputeBudgetProgram.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), PUMP_PROGRAM_ID.toBase58(), programId]);
  const message = tx.transaction.message, instructions = message.instructions || message.compiledInstructions || [];
  if (instructions.some(ix => !allowed.has(keys[ix.programIdIndex])))
    throw Error('The developer buy may only buy on Pump and fund the escrow.');
  const addresses = developerLockAddresses({ mint, creator, programId });
  const lock = addresses.lock.toBase58(), curve = bondingCurvePda(mint).toBase58();
  const pre = (tx.meta.preTokenBalances || []).filter(row => row.mint === proof.mint);
  const post = (tx.meta.postTokenBalances || []).filter(row => row.mint === proof.mint);
  const preOf = owner => pre.filter(row => row.owner === owner).reduce((sum, row) => sum + amountOf(row), 0n);
  const postOf = owner => post.filter(row => row.owner === owner).reduce((sum, row) => sum + amountOf(row), 0n);
  const amount = postOf(lock) - preOf(lock);
  if (preOf(lock) !== 0n || amount <= 0n || amount > MAX_DEVELOPER_BASE_UNITS)
    throw Error('Developer allocation exceeds its verified 20% limit or was not escrowed.');
  // Every token that left the curve went into the escrow; the creator keeps none.
  const owners = new Set([...pre, ...post].map(row => row.owner));
  for (const owner of owners) {
    if (owner === lock || owner === curve) continue;
    if (postOf(owner) > preOf(owner) || owner === creator && postOf(owner) !== 0n)
      throw Error('The developer buy must escrow every purchased token; unexpected recipients were found.');
  }
  if (preOf(curve) - postOf(curve) !== amount) throw Error('The escrowed amount must equal the Pump purchase.');
  const expected = developerLockInstruction({ mint, creator, amount, quoteId: serviceQuote?.id, programId, lockSeconds }).instruction;
  const matches = instructions.filter(ix => keys[ix.programIdIndex] === programId
    && Buffer.from(typeof ix.data === 'string' ? bs58.decode(ix.data) : ix.data).equals(expected.data)
    && JSON.stringify(Array.from(ix.accounts || ix.accountKeyIndexes, index => keys[index])) === JSON.stringify(expected.keys.map(key => key.pubkey.toBase58())));
  if (matches.length !== 1) throw Error('The exact developer escrow instruction is missing from the developer buy.');
  const index = keys.indexOf(lock);
  if (index < 0 || tx.meta.preBalances[index] !== 0 || tx.meta.postBalances[index] <= 0)
    throw Error('Developer escrow must be initialized in the developer buy.');
  const saved = decodeDeveloperTokenLock(await connection.getAccountInfo(addresses.lock, 'finalized'), { mint, creator, programId });
  // The escrow records the validator clock, which can trail the block time by a few seconds.
  if (saved.amount !== String(amount) || saved.lockedAt > tx.blockTime || tx.blockTime - saved.lockedAt > 30 || saved.lockSeconds !== lockSeconds)
    throw Error('Developer escrow does not match the verified developer buy and time.');
  return { ...saved, version: 1, status: 'funded', verified: true, programId: config.programId, programDataSha256: config.programDataSha256,
    vault: addresses.vault.toBase58(), fundingSignature: buySignature, atomicWithLaunch: false, atomicBuyAndEscrow: true, lockSeconds };
}
