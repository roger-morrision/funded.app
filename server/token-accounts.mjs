import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

export function normalizeLargestTokenAccounts(result) {
  const rows = Array.isArray(result?.value) ? result.value : [];
  const accounts = rows.flatMap(row => {
    const amount = String(row?.amount ?? '');
    const decimals = Number(row?.decimals);
    const address = row?.address?.toBase58?.() || String(row?.address || '');
    if (!address || !/^\d+$/.test(amount) || BigInt(amount) <= 0n || !Number.isInteger(decimals) || decimals < 0) return [];
    return [{ address, amount, decimals, uiAmountString: String(row?.uiAmountString ?? row?.uiAmount ?? Number(amount) / (10 ** decimals)) }];
  });
  return {
    accounts,
    count: accounts.length,
    coverage: rows.length >= 20 ? 'lower-bound' : 'complete-account-list',
    source: 'solana-getTokenLargestAccounts',
  };
}

export function attachVerifiedTokenAccountWallets(sample, infos, mint) {
  const mintBytes = new PublicKey(mint).toBuffer();
  return {
    ...sample,
    accounts: sample.accounts.map((account, index) => {
      const info = infos?.[index];
      const data = info?.data;
      const tokenProgram = info?.owner?.equals?.(TOKEN_PROGRAM_ID) || info?.owner?.equals?.(TOKEN_2022_PROGRAM_ID);
      const verified = tokenProgram && Buffer.isBuffer(data) && data.length >= 165
        && data[108] !== 0 && data.subarray(0, 32).equals(mintBytes);
      return { ...account, wallet: verified ? new PublicKey(data.subarray(32, 64)).toBase58() : null };
    }),
  };
}
