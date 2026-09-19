import { PUMP_SDK, bondingCurvePda, isSolLikeQuoteMint } from '@pump-fun/pump-sdk';

const TRADE_EVENT_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const DAY_SECONDS = 24 * 60 * 60;

export function decodePumpTrades(logMessages, mint) {
  const trades = [];
  for (const log of logMessages || []) {
    if (!log.startsWith('Program data: ')) continue;
    const bytes = Buffer.from(log.slice('Program data: '.length), 'base64');
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(TRADE_EVENT_DISCRIMINATOR)) continue;
    try {
      const event = PUMP_SDK.decodeTradeEventBc(bytes.subarray(8));
      if (!event.mint.equals(mint) || !isSolLikeQuoteMint(event.quoteMint)) continue;
      const quoteReserves = Number(event.virtualQuoteReserves.toString());
      const tokenReserves = Number(event.virtualTokenReserves.toString());
      const priceRatio = quoteReserves > 0 && tokenReserves > 0 ? quoteReserves / tokenReserves : NaN;
      trades.push({ solLamports: BigInt(event.solAmount.toString()), priceRatio });
    } catch { /* Ignore events from other Pump layouts or programs. */ }
  }
  return trades;
}

export function summarizePumpTrades(records, { cutoffSeconds, complete, sinceLaunch = false }) {
  const recent = records.filter(item => item.blockTime >= cutoffSeconds).sort((a, b) => b.blockTime - a.blockTime || a.order - b.order);
  const older = records.filter(item => item.blockTime < cutoffSeconds).sort((a, b) => b.blockTime - a.blockTime || a.order - b.order);
  const pricedRecent = recent.filter(item => Number.isFinite(item.priceRatio));
  const volumeLamports = recent.reduce((sum, item) => sum + item.solLamports, 0n);
  const latest = pricedRecent[0];
  const baseline = older.find(item => Number.isFinite(item.priceRatio)) || (complete && sinceLaunch && pricedRecent.length > 1 ? pricedRecent.at(-1) : null);
  const changePercent = complete && latest && baseline && baseline.priceRatio > 0 && latest !== baseline
    ? (latest.priceRatio / baseline.priceRatio - 1) * 100 : null;
  return {
    volume24hSol: Number(volumeLamports) / 1_000_000_000,
    tradeCount24h: recent.length,
    priceChangePercent: Number.isFinite(changePercent) ? changePercent : null,
    priceChangeBasis: changePercent == null ? null : older.length ? '24h' : 'since-first-trade',
    coverage: complete ? 'complete' : 'partial',
  };
}

export async function readPumpMarketActivity({ connection, mint, nowSeconds = Math.floor(Date.now() / 1000), maxSignatures = 50 }) {
  const cutoffSeconds = nowSeconds - DAY_SECONDS;
  const signatures = await connection.getSignaturesForAddress(bondingCurvePda(mint), { limit: maxSignatures }, 'confirmed');
  if (!signatures.length) return { volume24hSol: null, tradeCount24h: null, priceChangePercent: null, priceChangeBasis: null, coverage: 'unavailable' };
  const firstOlder = signatures.find(item => item.blockTime != null && item.blockTime < cutoffSeconds);
  const recentSignatures = signatures.filter(item => !item.err && item.blockTime != null && item.blockTime >= cutoffSeconds);
  const olderSignatures = signatures.filter(item => !item.err && item.blockTime != null && item.blockTime < cutoffSeconds).slice(0, 5);
  const selected = [...recentSignatures, ...olderSignatures];
  const records = [];
  let missingTransactions = false;
  for (let start = 0; start < selected.length; start += 4) {
    const group = selected.slice(start, start + 4);
    const transactions = await Promise.all(group.map(item => connection.getTransaction(item.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null)));
    for (let index = 0; index < group.length; index += 1) {
      const transaction = transactions[index];
      if (!transaction) { missingTransactions = true; continue; }
      const blockTime = transaction.blockTime ?? group[index].blockTime;
      if (blockTime == null) { missingTransactions = true; continue; }
      for (const trade of decodePumpTrades(transaction.meta?.logMessages, mint)) records.push({ ...trade, blockTime, order: start + index });
    }
  }
  const complete = !missingTransactions && signatures.every(item => item.blockTime != null) && (signatures.length < maxSignatures || Boolean(firstOlder));
  return summarizePumpTrades(records, { cutoffSeconds, complete, sinceLaunch: !firstOlder && signatures.length < maxSignatures });
}
