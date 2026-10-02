import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';

const tokenPrograms = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

function keyText(entry) { return entry?.pubkey?.toBase58?.() || String(entry?.pubkey || entry || ''); }

export function readVerifiedBurnChecked(transaction, { fundedMint, wallet, amountBaseUnits = null, expectedMemo = null }) {
  if (!transaction || transaction.meta?.err) throw new Error('The burn transaction is not confirmed successfully.');
  const keys = transaction.transaction?.message?.accountKeys || [];
  const feePayer = keyText(keys[0]);
  if (feePayer !== wallet) throw new Error('The burn transaction fee payer does not match the connected wallet.');
  if (expectedMemo != null) {
    const memoProgram = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
    const memos = (transaction.transaction?.message?.instructions || [])
      .filter(item => keyText(item.programId) === memoProgram)
      .map(item => {
        if (typeof item.parsed === 'string') return item.parsed;
        if (typeof item.parsed?.memo === 'string') return item.parsed.memo;
        try { return item.data ? Buffer.from(bs58.decode(item.data)).toString('utf8') : ''; } catch { return ''; }
      });
    if (memos.length !== 1 || memos[0] !== expectedMemo) throw new Error('The listing mint is not bound to this burn transaction.');
  }
  const instructions = (transaction.transaction?.message?.instructions || []).filter(item => {
    const program = keyText(item.programId);
    const parsed = item.parsed;
    const info = parsed?.info || {};
    return tokenPrograms.has(program) && parsed?.type === 'burnChecked'
      && String(info.mint || '') === fundedMint
      && String(info.authority || '') === wallet;
  });
  if (!instructions.length) throw new Error('No matching SPL BurnChecked instruction was found.');
  let totalAmount = 0n;
  let decimals = null;
  const tokenAccounts = [];
  for (const instruction of instructions) {
    const info = instruction.parsed.info;
    const amount = String(info.tokenAmount?.amount || '');
    const instructionDecimals = Number(info.tokenAmount?.decimals);
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n || !Number.isInteger(instructionDecimals)) throw new Error('The BurnChecked amount is invalid.');
    if (decimals != null && decimals !== instructionDecimals) throw new Error('BurnChecked instructions use inconsistent mint decimals.');
    decimals = instructionDecimals;
    const accountAddress = String(info.account || '');
    const accountIndex = keys.findIndex(entry => keyText(entry) === accountAddress);
    const pre = transaction.meta?.preTokenBalances?.find(row => row.accountIndex === accountIndex && row.mint === fundedMint && row.owner === wallet);
    const post = transaction.meta?.postTokenBalances?.find(row => row.accountIndex === accountIndex && row.mint === fundedMint && row.owner === wallet);
    if (!pre || !post || BigInt(pre.uiTokenAmount.amount) - BigInt(post.uiTokenAmount.amount) !== BigInt(amount)) {
      throw new Error('The token-account balance delta does not match the BurnChecked amount.');
    }
    totalAmount += BigInt(amount);
    tokenAccounts.push(accountAddress);
  }
  if (amountBaseUnits != null && BigInt(String(amountBaseUnits)) !== totalAmount) throw new Error('The submitted burn amount does not match the confirmed transaction.');
  return { feePayer, wallet, fundedMint, tokenAccount: tokenAccounts[0], tokenAccounts, amountBaseUnits: String(totalAmount), decimals, tokenProgram: keyText(instructions[0].programId) };
}

export async function verifyFundedBurn({ connection, signature, fundedMint, wallet, amountBaseUnits = null, expectedMemo = null }) {
  if (!signature || typeof signature !== 'string') throw new Error('A burn transaction signature is required.');
  new PublicKey(fundedMint);
  new PublicKey(wallet);
  const transaction = await connection.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  const burn = readVerifiedBurnChecked(transaction, { fundedMint, wallet, amountBaseUnits, expectedMemo });
  const supply = await connection.getTokenSupply(new PublicKey(fundedMint), 'finalized');
  return { ...burn, signature, slot: transaction.slot, blockTime: transaction.blockTime || null, supplyAfterBaseUnits: String(supply.value.amount), verifiedAt: new Date().toISOString() };
}
