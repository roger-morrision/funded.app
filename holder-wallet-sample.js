const walletAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// A full distribution is shown only when every non-zero token account has a
// verified owner and its raw balance reconciles with the mint supply.
export function summarizeFullHolderDistribution(accounts, vaultTokenAccount, mintSupplyRaw) {
  if (!Array.isArray(accounts) || !walletAddress.test(String(vaultTokenAccount || ''))
    || !/^\d+$/.test(String(mintSupplyRaw ?? '')) || BigInt(mintSupplyRaw) <= 0n) return null;
  const supply = BigInt(mintSupplyRaw);
  const seen = new Set();
  const holders = new Map();
  let vaultRaw = null;
  let totalRaw = 0n;
  for (const row of accounts) {
    const address = String(row?.address || '');
    const wallet = String(row?.wallet || '');
    const amount = String(row?.amount ?? '');
    if (!walletAddress.test(address) || !walletAddress.test(wallet) || seen.has(address)
      || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) return null;
    seen.add(address);
    const raw = BigInt(amount);
    totalRaw += raw;
    if (address === vaultTokenAccount) vaultRaw = raw;
    else holders.set(wallet, (holders.get(wallet) || 0n) + raw);
  }
  if (vaultRaw == null || totalRaw !== supply) return null;
  const percent = raw => Number(raw * 1_000_000n / supply) / 10_000;
  return {
    accountCount: accounts.length,
    walletCount: holders.size,
    vaultRaw: vaultRaw.toString(),
    holderRaw: (supply - vaultRaw).toString(),
    vaultShare: percent(vaultRaw),
    holderShare: percent(supply - vaultRaw),
    holders: [...holders].sort((a, b) => a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1)
      .map(([wallet, raw]) => ({ wallet, amountRaw: raw.toString(), share: percent(raw) })),
  };
}

// Largest-account RPC results are bounded. Count distinct verified owners only,
// and exclude the known protocol token vault before calling them holders.
export function summarizeHolderWalletSample(sample, vaultTokenAccount, { mintSupplyRaw = null, creatorWallet = null } = {}) {
  if (!Array.isArray(sample?.accounts) || !walletAddress.test(String(vaultTokenAccount || ''))) return null;
  const nonVault = sample.accounts.filter(row => row?.address !== vaultTokenAccount);
  const wallets = new Set(nonVault.map(row => row?.wallet).filter(wallet => walletAddress.test(String(wallet || ''))));
  if (nonVault.length && !wallets.size) return null;
  const complete = sample.coverage === 'complete-account-list'
    && nonVault.every(row => walletAddress.test(String(row?.wallet || '')));
  if (!complete && !wallets.size) return null;
  let topTenHolderPercent = null;
  let devHoldingPercent = null;
  const rawSupply = String(mintSupplyRaw ?? '');
  if (complete && /^\d+$/.test(rawSupply) && BigInt(rawSupply) > 0n
    && nonVault.every(row => /^\d+$/.test(String(row.amount ?? '')))) {
    const balances = new Map();
    for (const row of nonVault) balances.set(row.wallet, (balances.get(row.wallet) || 0n) + BigInt(row.amount));
    const supply = BigInt(rawSupply);
    const percent = amount => Number(amount * 1_000_000n / supply) / 10_000;
    const topTen = [...balances.values()].sort((a, b) => a === b ? 0 : a > b ? -1 : 1).slice(0, 10);
    topTenHolderPercent = percent(topTen.reduce((sum, amount) => sum + amount, 0n));
    if (walletAddress.test(String(creatorWallet || ''))) devHoldingPercent = percent(balances.get(creatorWallet) || 0n);
  }
  return { count: wallets.size, coverage: complete ? 'complete-account-list' : 'lower-bound', sampledAccounts: nonVault.length,
    topTenHolderPercent, devHoldingPercent };
}
