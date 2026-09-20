import { PUMP_SDK, bondingCurvePda, isSolLikeQuoteMint } from '@pump-fun/pump-sdk';

const TRADE_EVENT_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const DAY_SECONDS = 24 * 60 * 60;
const ACTIVITY_WINDOWS = { '1h': 60 * 60, '6h': 6 * 60 * 60, '24h': DAY_SECONDS };

function summarizeActivityWindow(records, cutoffSeconds, complete) {
  const selected = records.filter(item => item.blockTime >= cutoffSeconds);
  const buy = selected.filter(item => item.isBuy === true);
  const sell = selected.filter(item => item.isBuy === false);
  const totalLamports = selected.reduce((sum, item) => sum + item.solLamports, 0n);
  const buyLamports = buy.reduce((sum, item) => sum + item.solLamports, 0n);
  const sellLamports = sell.reduce((sum, item) => sum + item.solLamports, 0n);
  const largestLamports = selected.reduce((largest, item) => item.solLamports > largest ? item.solLamports : largest, 0n);
  return {
    tradeCount: selected.length,
    buyCount: buy.length,
    sellCount: sell.length,
    volumeSol: Number(totalLamports) / 1_000_000_000,
    buyVolumeSol: Number(buyLamports) / 1_000_000_000,
    sellVolumeSol: Number(sellLamports) / 1_000_000_000,
    traderCount: new Set(selected.map(item => item.trader).filter(Boolean)).size,
    largestTradeSol: Number(largestLamports) / 1_000_000_000,
    coverage: complete ? 'complete' : 'partial',
  };
}

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
      trades.push({
        solLamports: BigInt(event.solAmount.toString()),
        tokenAmountRaw: BigInt(event.tokenAmount.toString()),
        isBuy: Boolean(event.isBuy),
        trader: event.user.toBase58(),
        priceRatio,
      });
    } catch { /* Ignore events from other Pump layouts or programs. */ }
  }
  return trades;
}

export function summarizePumpTrades(records, { cutoffSeconds, complete, sinceLaunch = false }) {
  const recent = records.filter(item => item.blockTime >= cutoffSeconds).sort((a, b) => b.blockTime - a.blockTime || a.order - b.order);
  const older = records.filter(item => item.blockTime < cutoffSeconds).sort((a, b) => b.blockTime - a.blockTime || a.order - b.order);
  const pricedRecent = recent.filter(item => Number.isFinite(item.priceRatio));
  const volumeLamports = recent.reduce((sum, item) => sum + item.solLamports, 0n);
  const buyVolumeLamports = recent.reduce((sum, item) => sum + (item.isBuy === true ? item.solLamports : 0n), 0n);
  const sellVolumeLamports = recent.reduce((sum, item) => sum + (item.isBuy === false ? item.solLamports : 0n), 0n);
  const latest = pricedRecent[0];
  const baseline = older.find(item => Number.isFinite(item.priceRatio)) || (complete && sinceLaunch && pricedRecent.length > 1 ? pricedRecent.at(-1) : null);
  const changePercent = complete && latest && baseline && baseline.priceRatio > 0 && latest !== baseline
    ? (latest.priceRatio / baseline.priceRatio - 1) * 100 : null;
  const nowSeconds = cutoffSeconds + DAY_SECONDS;
  const activityWindows = Object.fromEntries(Object.entries(ACTIVITY_WINDOWS).map(([period, seconds]) =>
    [period, summarizeActivityWindow(records, nowSeconds - seconds, complete)]));
  return {
    activityWindows,
    volume24hSol: Number(volumeLamports) / 1_000_000_000,
    buyVolume24hSol: Number(buyVolumeLamports) / 1_000_000_000,
    sellVolume24hSol: Number(sellVolumeLamports) / 1_000_000_000,
    tradeCount24h: recent.length,
    buyCount24h: recent.filter(item => item.isBuy === true).length,
    sellCount24h: recent.filter(item => item.isBuy === false).length,
    recentTrades: recent.filter(item => item.signature && item.trader && typeof item.isBuy === 'boolean').slice(0, 20).map(item => ({
      signature: item.signature,
      blockTime: item.blockTime,
      side: item.isBuy ? 'buy' : 'sell',
      solLamports: item.solLamports.toString(),
      tokenAmountRaw: item.tokenAmountRaw.toString(),
      trader: item.trader,
      priceRatio: Number.isFinite(item.priceRatio) ? item.priceRatio : null,
    })),
    priceChangePercent: Number.isFinite(changePercent) ? changePercent : null,
    priceChangeBasis: changePercent == null ? null : older.length ? '24h' : 'since-first-trade',
    coverage: complete ? 'complete' : 'partial',
  };
}

export async function readPumpMarketActivity({ connection, mint, nowSeconds = Math.floor(Date.now() / 1000), maxSignatures = 50 }) {
  const cutoffSeconds = nowSeconds - DAY_SECONDS;
  const signatures = await connection.getSignaturesForAddress(bondingCurvePda(mint), { limit: maxSignatures }, 'confirmed');
  if (!signatures.length) return { volume24hSol: null, buyVolume24hSol: null, sellVolume24hSol: null, tradeCount24h: null, buyCount24h: null, sellCount24h: null, recentTrades: [], activityWindows: null, priceChangePercent: null, priceChangeBasis: null, coverage: 'unavailable' };
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
      for (const trade of decodePumpTrades(transaction.meta?.logMessages, mint)) records.push({ ...trade, signature: group[index].signature, blockTime, order: start + index });
    }
  }
  const complete = !missingTransactions && signatures.every(item => item.blockTime != null) && (signatures.length < maxSignatures || Boolean(firstOlder));
  return summarizePumpTrades(records, { cutoffSeconds, complete, sinceLaunch: !firstOlder && signatures.length < maxSignatures });
}
