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
