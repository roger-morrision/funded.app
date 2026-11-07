import { PublicKey, SystemProgram } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { fetchVerifiedPoolSnapshot } from '../pump-trading.js';
import { readCurveMetrics } from '../explore-onchain-metrics.js';

// Market cap in SOL for callouts, read by the server so a caller cannot
// choose their own entry. One batched account read serves every mint in a
// feed page; results stay fresh for ttlMs so a busy feed costs one read.
export function readMint(data) {
  const bytes = Buffer.from(data || []);
  if (bytes.length < 45 || bytes[44] > 18) return null;
  return { supply: bytes.readBigUInt64LE(36), decimals: bytes[44] };
}

export function createCalloutMarketReader({ getConnection, ttlMs = 15_000, now = Date.now,
  decodeCurve = account => PUMP_SDK.decodeBondingCurveNullable(account),
  readPool = fetchVerifiedPoolSnapshot }) {
  const cache = new Map();
  const inflight = new Map();
  async function load(mints) {
    const keys = mints.map(mint => new PublicKey(mint));
    const connection = getConnection();
    const accounts = await connection.getMultipleAccountsInfo([...keys, ...keys.map(key => bondingCurvePda(key))], 'confirmed');
    return Promise.all(keys.map(async (key, index) => {
      const mint = mints[index];
      const mintInfo = readMint(accounts[index]?.data);
      const curveAccount = accounts[keys.length + index];
      if (!mintInfo || !curveAccount?.owner?.equals(PUMP_PROGRAM_ID)) return [mint, null];
      const curve = decodeCurve(curveAccount);
      if (!curve || (!curve.quoteMint?.equals(NATIVE_MINT) && !curve.quoteMint?.equals(SystemProgram.programId) && curve.quoteMint)) return [mint, null];
      let marketCapSol = null;
      if (curve.complete) {
        try { marketCapSol = Number((await readPool({ connection, mint: key, poolAddress: canonicalPumpPoolPda(key, NATIVE_MINT) })).spotPriceSol) * Number(mintInfo.supply) / 10 ** mintInfo.decimals; }
        catch { marketCapSol = null; }
      } else marketCapSol = readCurveMetrics(curve, mintInfo).curveCapSol;
      return [mint, Number.isFinite(marketCapSol) && marketCapSol > 0
        ? { marketCapSol, priceSol:mintInfo.supply>0n?marketCapSol/(Number(mintInfo.supply)/10**mintInfo.decimals):null,
          graduated: Boolean(curve.complete), observedAt: new Date(now()).toISOString() } : null];
    }));
  }
  // fresh: wait for a read newer than maxAgeMs (recording a call). Otherwise
  // serve the last known value now and refresh in the background, waiting at
  // most waitMs only for coins never read before (the public feed).
  return async function readMarketCaps(mintList, { maxAgeMs = ttlMs, fresh = false, waitMs = 2_000 } = {}) {
    const mints = [...new Set(mintList.filter(Boolean))].slice(0, 100);
    const stale = mints.filter(mint => !cache.has(mint) || now() - cache.get(mint).at >= maxAgeMs);
    const missing = stale.filter(mint => !inflight.has(mint));
    if (missing.length) {
      const request = load(missing).then(rows => { for (const [mint, value] of rows) cache.set(mint, { at: now(), value }); },
        error => { for (const mint of missing) if (!cache.has(mint)) cache.set(mint, { at: now(), value: null }); throw error; })
        .finally(() => { for (const mint of missing) inflight.delete(mint); });
      request.catch(() => {});
      for (const mint of missing) inflight.set(mint, request);
    }
    const waitFor = (fresh ? stale : stale.filter(mint => !cache.has(mint))).map(mint => inflight.get(mint)?.catch(() => null));
    if (waitFor.length) await (fresh ? Promise.all(waitFor) : Promise.race([Promise.all(waitFor), new Promise(resolve => setTimeout(resolve, waitMs))]));
    return Object.fromEntries(mints.map(mint => [mint, cache.get(mint)?.value ?? null]));
  };
}

// The share of supply the caller holds when they post, read on Solana, so the
// board can show which calls come with the caller's own money behind them.
export function createHolderShareReader({ getConnection, timeoutMs = 8_000 }) {
  return async function readHolderShare(owner, mint) {
    const connection = getConnection();
    const read = Promise.all([
      connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, 'confirmed'),
      connection.getTokenSupply(new PublicKey(mint), 'confirmed'),
    ]).then(([accounts, supply]) => {
      const total=BigInt(supply.value.amount);
      const held=accounts.value.reduce((sum,row)=>sum+BigInt(row.account.data.parsed.info.tokenAmount.amount),0n);
      return total > 0n ? Number(held)/Number(total)*100 : null;
    });
    let timer;
    try { return await Promise.race([read,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]); }
    catch { return null; }
    finally { clearTimeout(timer); }
  };
}
