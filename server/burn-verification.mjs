import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const tokenPrograms = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

function keyText(entry) { return entry?.pubkey?.toBase58?.() || String(entry?.pubkey || entry || ''); }

export function readVerifiedBurnChecked(transaction, { fundedMint, wallet, amountBaseUnits = null }) {
  if (!transaction || transaction.meta?.err) throw new Error('The burn transaction is not confirmed successfully.');
  const keys = transaction.transaction?.message?.accountKeys || [];
  const feePayer = keyText(keys[0]);
  if (feePayer !== wallet) throw new Error('The burn transaction fee payer does not match the connected wallet.');
  const instruction = (transaction.transaction?.message?.instructions || []).find(item => {
    const program = keyText(item.programId);
    const parsed = item.parsed;
    const info = parsed?.info || {};
    return tokenPrograms.has(program) && parsed?.type === 'burnChecked'
      && String(info.mint || '') === fundedMint
      && String(info.authority || '') === wallet;
  });
  if (!instruction) throw new Error('No matching SPL BurnChecked instruction was found.');
  const info = instruction.parsed.info;
  const amount = String(info.tokenAmount?.amount || '');
  const decimals = Number(info.tokenAmount?.decimals);
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n || !Number.isInteger(decimals)) throw new Error('The BurnChecked amount is invalid.');
  if (amountBaseUnits != null && BigInt(String(amountBaseUnits)) !== BigInt(amount)) throw new Error('The submitted burn amount does not match the confirmed transaction.');
  const accountAddress = String(info.account || '');
  const accountIndex = keys.findIndex(entry => keyText(entry) === accountAddress);
  const pre = transaction.meta?.preTokenBalances?.find(row => row.accountIndex === accountIndex && row.mint === fundedMint && row.owner === wallet);
  const post = transaction.meta?.postTokenBalances?.find(row => row.accountIndex === accountIndex && row.mint === fundedMint && row.owner === wallet);
  if (!pre || !post || BigInt(pre.uiTokenAmount.amount) - BigInt(post.uiTokenAmount.amount) !== BigInt(amount)) {
    throw new Error('The token-account balance delta does not match the BurnChecked amount.');
  }
  return { feePayer, wallet, fundedMint, tokenAccount: accountAddress, amountBaseUnits: amount, decimals, tokenProgram: keyText(instruction.programId) };
}

export async function verifyFundedBurn({ connection, signature, fundedMint, wallet, amountBaseUnits = null }) {
  if (!signature || typeof signature !== 'string') throw new Error('A burn transaction signature is required.');
  new PublicKey(fundedMint);
  new PublicKey(wallet);
  const transaction = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const burn = readVerifiedBurnChecked(transaction, { fundedMint, wallet, amountBaseUnits });
  const supply = await connection.getTokenSupply(new PublicKey(fundedMint), 'confirmed');
  return { ...burn, signature, slot: transaction.slot, blockTime: transaction.blockTime || null, supplyAfterBaseUnits: String(supply.value.amount), verifiedAt: new Date().toISOString() };
}
