// Fallback trade list from Birdeye (paid, used last): only when the free
// GeckoTerminal feed returns nothing, e.g. while it rate-limits the server.
// Rows match the GeckoTerminal-based shape the token page already renders.
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function birdeyeTradeRows(items, { mint, wsol, solUsd }) {
  if (!Array.isArray(items)) return null;
  const rows = [];
  for (const item of items) {
    const side = item?.tx_type === 'buy' || item?.side === 'buy' ? 'buy' : item?.tx_type === 'sell' || item?.side === 'sell' ? 'sell' : null;
    const token = [item?.from, item?.to].find(leg => leg?.address === mint);
    const other = [item?.from, item?.to].find(leg => leg && leg.address !== mint);
    const blockTime = Number(item?.block_unix_time);
    const usd = Number(item?.volume_usd);
    if (!side || !token || !/^\d+$/.test(String(token.amount || '')) || BigInt(token.amount) <= 0n || !Number.isSafeInteger(blockTime)
      || typeof item.tx_hash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(item.tx_hash)) continue;
    // SOL leg when the pair is quoted in SOL; otherwise the USD value converted at the SOL price.
    const sol = other?.address === wsol && /^\d+$/.test(String(other.amount || '')) ? Number(other.amount) / 1e9
      : Number.isFinite(usd) && solUsd > 0 ? usd / solUsd : null;
    if (!Number.isFinite(sol) || sol < 0) continue;
    rows.push({ signature: item.tx_hash, blockTime, side, trader: MINT.test(item.owner || '') ? item.owner : null,
      solLamports: String(Math.round(sol * 1e9)), tokenAmountRaw: String(token.amount), usd: Number.isFinite(usd) ? usd : null });
  }
  return rows.sort((a, b) => b.blockTime - a.blockTime);
}

export async function readBirdeyeTrades(fetchBirdeye, { mint, wsol, solUsd }) {
  if (typeof fetchBirdeye !== 'function' || !MINT.test(mint || '')) return null;
  const response = await fetchBirdeye('/defi/v3/token/txs', { address: mint, offset: 0, limit: 100, tx_type: 'swap' }).catch(() => null);
  if (!response?.configured || !Array.isArray(response.data?.items)) return null;
  const decimals = response.data.items.map(item => [item?.from, item?.to].find(leg => leg?.address === mint)?.decimals).find(Number.isInteger);
  const trades = birdeyeTradeRows(response.data.items, { mint, wsol, solUsd });
  return trades?.length ? { trades, decimals: Number.isInteger(decimals) ? decimals : null } : null;
}
