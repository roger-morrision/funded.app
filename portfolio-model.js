export function aggregateTokenAccounts(accounts){
  const totals = new Map();
  for (const account of accounts || []) {
    const info = account?.account?.data?.parsed?.info;
    const mint = info?.mint;
    const amount = info?.tokenAmount?.amount;
    const decimals = Number(info?.tokenAmount?.decimals);
    if (!mint || !/^\d+$/.test(String(amount)) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) continue;
    const raw = BigInt(amount);
    if (raw <= 0n) continue;
    const previous = totals.get(mint);
    if (previous && previous.decimals !== decimals) continue;
    totals.set(mint, { mint, raw: (previous?.raw || 0n) + raw, decimals });
  }
  return [...totals.values()].map(item => ({ ...item, quantity: Number(item.raw) / 10 ** item.decimals }));
}

// Only close lots bought within the observed window. Older positions and transfers
// have unknown cost basis, so they never enter this P&L calculation.
export function matchedTradePnl(trades, decimalsByMint){
  const lots = new Map();
  let pnlSol = 0;
  let matchedSales = 0;
  for (const trade of [...(trades || [])].sort((a, b) => Number(a.blockTime) - Number(b.blockTime))) {
    const decimals = decimalsByMint.get(trade.mint);
    const raw = String(trade.tokenAmountRaw ?? '');
    const sol = Number(trade.solAmount);
    if (!Number.isInteger(decimals) || !/^\d+$/.test(raw) || !Number.isFinite(sol) || sol <= 0) continue;
    const quantity = Number(raw) / 10 ** decimals;
    if (!(quantity > 0) || !Number.isFinite(quantity)) continue;
    const queue = lots.get(trade.mint) || [];
    if (trade.side === 'buy') queue.push({ quantity, costPerToken: sol / quantity });
    if (trade.side === 'sell') {
      let remaining = quantity;
      let basis = 0;
      let matched = 0;
      while (remaining > 1e-10 && queue.length) {
        const lot = queue[0];
        const take = Math.min(remaining, lot.quantity);
        matched += take;
        basis += take * lot.costPerToken;
        remaining -= take;
        lot.quantity -= take;
        if (lot.quantity < 1e-10) queue.shift();
      }
      if (matched > 0) {
        pnlSol += sol * (matched / quantity) - basis;
        matchedSales += 1;
      }
    }
    lots.set(trade.mint, queue);
  }
  return { pnlSol, matchedSales };
}
