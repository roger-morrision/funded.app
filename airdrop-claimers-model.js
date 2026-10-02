export function claimerRate(row) {
  const amount = Number(row?.amount);
  const allocation = Number(row?.allocation);
  return Number.isFinite(amount) && Number.isFinite(allocation) && allocation > 0
    ? amount / allocation : null;
}

export function sortClaimers(rows, sort = 'amount') {
  return [...rows].sort((a, b) => {
    if (sort === 'rate') {
      const byRate = (claimerRate(b) ?? -1) - (claimerRate(a) ?? -1);
      if (byRate) return byRate;
    }
    return Number(b.amount) - Number(a.amount);
  });
}

export function claimantWalletLabel(wallet, privateMode) {
  const value = String(wallet || '');
  return privateMode && value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}
