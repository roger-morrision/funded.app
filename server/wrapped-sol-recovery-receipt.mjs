import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

const discriminator = createHash('sha256').update('global:recover_mint_wrapped_sol').digest().subarray(0, 8);
const address = key => key?.toBase58?.() || String(key || '');

// The recovered fee is the wSOL token amount. Closing its ATA also returns
// rent to the router; rent is not creator-fee revenue or distributable.
export function verifyWrappedSolRecoveryReceipt({ transaction, signature, mint, router, programId }) {
  if (!transaction || transaction.meta?.err !== null || !transaction.transaction?.signatures?.includes(signature)) return null;
  const message = transaction.transaction.message;
  const keys = (message.accountKeys || message.staticAccountKeys || []).map(address);
  const mintKey = new PublicKey(mint);
  const routerKey = new PublicKey(router);
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, routerKey, true, TOKEN_PROGRAM_ID).toBase58();
  const indexes = [router, ata, programId, mint].map(value => keys.indexOf(value));
  if (indexes.some(index => index < 0)) return null;
  const [routerIndex, ataIndex, programIndex, mintIndex] = indexes;
  const pre = transaction.meta.preBalances;
  const post = transaction.meta.postBalances;
  if (!Array.isArray(pre) || !Array.isArray(post) || pre.length !== keys.length || post.length !== keys.length) return null;
  const tokenBefore = transaction.meta.preTokenBalances?.find(row => row.accountIndex === ataIndex
    && row.mint === NATIVE_MINT.toBase58() && row.owner === router);
  const amount = Number(tokenBefore?.uiTokenAmount?.amount);
  const rent = pre[ataIndex] - amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(rent) || rent <= 0
    || post[ataIndex] !== 0 || post[routerIndex] - pre[routerIndex] !== pre[ataIndex]) return null;
  const recovery = message.instructions?.find(instruction => {
    if (instruction.programIdIndex !== programIndex || instruction.accounts?.length < 5) return false;
    const accounts = instruction.accounts.map(index => keys[index]);
    if (accounts[1] !== mintKey.toBase58() || accounts[2] !== router || accounts[3] !== ata
      || accounts[4] !== TOKEN_PROGRAM_ID.toBase58()) return false;
    try { return Buffer.from(bs58.decode(instruction.data)).subarray(0, 8).equals(discriminator); }
    catch { return false; }
  });
  if (!recovery) return null;
  return { signature, mint, router, wrappedSolAccount:ata, collectedLamports:amount,
    rentRefundLamports:rent, slot:transaction.slot, blockTime:transaction.blockTime || null };
}
