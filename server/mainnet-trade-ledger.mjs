import { Connection, PublicKey } from '@solana/web3.js';

// Mainnet trader ranking from on-chain evidence. Every trade placed on
// richpad.fun pays the app fee to the fee wallet in the same transaction, so the
// fee wallet's finalized history lists every app trade. A transaction counts as
// a trade when the fee payer (the trader) sent the fee and exactly one token
// balance of theirs changed. SOL volume = fee / fee rate.
const WSOL = 'So11111111111111111111111111111111111111112';
const KEEP_MS = 72 * 3600_000;

export function feeTradeFromTransaction(tx, { feeOwner, signature, feeBps = 100 }) {
  if (!tx || tx.meta?.err !== null || !Number.isSafeInteger(tx.blockTime)) return null;
  const message = tx.transaction?.message;
  const keys = (message?.accountKeys || []).map(key => String(key?.pubkey ?? key));
  const wallet = keys[0];
  if (!wallet) return null;
  const instructions = [...(message.instructions || []), ...(tx.meta.innerInstructions || []).flatMap(row => row.instructions || [])];
  let fee = 0n;
  for (const ix of instructions) {
    const info = ix?.parsed?.info;
    if (ix?.program === 'system' && ['transfer', 'transferWithSeed'].includes(ix.parsed?.type) && info?.destination === feeOwner && info.source === wallet)
      fee += BigInt(info.lamports || 0);
  }
  if (fee <= 0n) return null;
  const deltas = new Map();
  for (const [rows, sign] of [[tx.meta.preTokenBalances || [], -1n], [tx.meta.postTokenBalances || [], 1n]])
    for (const row of rows) if (row.owner === wallet && /^\d+$/.test(String(row.uiTokenAmount?.amount)))
      deltas.set(row.mint, (deltas.get(row.mint) || 0n) + sign * BigInt(row.uiTokenAmount.amount));
  const tokens = [...deltas].filter(([mint, delta]) => mint !== WSOL && delta !== 0n);
  if (tokens.length !== 1) return null;
  const [mint, delta] = tokens[0];
  return { signature, wallet, mint, side: delta > 0n ? 'buy' : 'sell', feeLamports: String(fee),
    volumeLamports: String(fee * 10_000n / BigInt(feeBps)), blockTime: tx.blockTime, slot: tx.slot };
}

export function rankLedgerTraders(trades, { sinceSeconds, limit = 100 } = {}) {
  const wallets = new Map(), mints = new Set();
  for (const trade of trades) {
    if (!(trade.blockTime >= sinceSeconds)) continue;
    mints.add(trade.mint);
    const row = wallets.get(trade.wallet) || { wallet: trade.wallet, tradeCount: 0, buyCount: 0, sellCount: 0, volumeLamports: 0n, tokens: new Set(), latestSignature: '', latestBlockTime: 0 };
    row.tradeCount += 1; row[trade.side === 'buy' ? 'buyCount' : 'sellCount'] += 1;
    row.volumeLamports += BigInt(trade.volumeLamports); row.tokens.add(trade.mint);
    if (trade.blockTime > row.latestBlockTime) { row.latestBlockTime = trade.blockTime; row.latestSignature = trade.signature; }
    wallets.set(trade.wallet, row);
  }
  const traders = [...wallets.values()]
    .sort((a, b) => a.volumeLamports === b.volumeLamports ? b.tradeCount - a.tradeCount || a.wallet.localeCompare(b.wallet) : a.volumeLamports > b.volumeLamports ? -1 : 1)
    .slice(0, limit).map(row => ({ wallet: row.wallet, tradeCount: row.tradeCount, buyCount: row.buyCount, sellCount: row.sellCount, sampleCapped: false,
      volumeSol: Number(row.volumeLamports) / 1e9, tokenCount: row.tokens.size, latestSignature: row.latestSignature, latestBlockTime: row.latestBlockTime }));
  return { tokenCount: mints.size, traders };
}

export function createMainnetTradeLedger({ store, rpcUrl, feeOwner, feeBps = 100, now = Date.now, connectionFactory = url => new Connection(url, 'finalized') }) {
  const owner = (() => { try { return new PublicKey(String(feeOwner || '')).toBase58(); } catch { return null; } })();
  let syncing = null, lastSync = 0, lastError = null;
  async function syncOnce() {
    const connection = connectionFactory(rpcUrl);
    const state = await store.read();
    const known = state.mainnetTrades || {}, newest = state.mainnetTradeCursor?.fee?.newest || null, cutoff = (now() - KEEP_MS) / 1000;
    const fresh = []; let before, top = null, done = false;
    for (let page = 0; page < 5 && !done; page += 1) {
      const rows = await connection.getSignaturesForAddress(new PublicKey(owner), { limit: 200, ...(before ? { before } : {}) }, 'finalized');
      if (!rows.length) break;
      top ||= rows[0].signature;
      for (const row of rows) {
        if (row.signature === newest || (Number.isFinite(row.blockTime) && row.blockTime < cutoff)) { done = true; break; }
        if (!row.err && !known[row.signature]) fresh.push(row.signature);
      }
      before = rows.at(-1).signature;
      if (rows.length < 200) break;
    }
    const trades = [];
    for (let index = 0; index < fresh.length; index += 5) {
      const batch = await Promise.all(fresh.slice(index, index + 5).map(signature =>
        connection.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 })
          .then(tx => feeTradeFromTransaction(tx, { feeOwner: owner, signature, feeBps })).catch(() => null)));
      trades.push(...batch.filter(Boolean));
    }
    await store.update(state => {
      const current = state.mainnetTrades ||= {};
      for (const trade of trades) current[trade.signature] = trade;
      for (const [signature, trade] of Object.entries(current)) if (trade.blockTime < cutoff) delete current[signature];
      const cursor = state.mainnetTradeCursor ||= {};
      cursor.fee = { newest: top || cursor.fee?.newest || null, syncedAt: new Date(now()).toISOString() };
    });
    lastSync = now(); lastError = null;
  }
  async function sync({ maxAgeMs = 60_000 } = {}) {
    if (!owner) throw Object.assign(new Error('The trade fee wallet is not configured.'), { statusCode: 503 });
    if (now() - lastSync < maxAgeMs) return;
    syncing ||= syncOnce().catch(error => { lastError = error; }).finally(() => { syncing = null; });
    return syncing;
  }
  async function board({ window = '24h' } = {}) {
    await Promise.race([sync(), new Promise(resolve => setTimeout(resolve, 12_000))]);
    const state = await store.read();
    const nowSeconds = Math.floor(now() / 1000);
    const sinceSeconds = window === 'today' ? Math.floor(Date.UTC(new Date(now()).getUTCFullYear(), new Date(now()).getUTCMonth(), new Date(now()).getUTCDate()) / 1000) : nowSeconds - 86400;
    return { window, sinceSeconds, syncedAt: state.mainnetTradeCursor?.fee?.syncedAt || null, stale: Boolean(lastError), ...rankLedgerTraders(Object.values(state.mainnetTrades || {}), { sinceSeconds }) };
  }
  return { sync, board, configured: Boolean(owner) };
}
