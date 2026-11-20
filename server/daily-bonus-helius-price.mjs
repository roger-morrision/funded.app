import { createHash } from 'node:crypto';
import bs58 from 'bs58';

// Pyth Core push accounts, shard 0, on Solana Mainnet. Helius supplies the
// immutable transaction history; the Pyth program verifies the price update.
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const PYTH_PUSH = 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT';
const PYTH_RECEIVER = 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ';
const UPDATE_DISCRIMINATOR = createHash('sha256').update('global:update_price_feed').digest().subarray(0, 8);
export const BONUS_USD_FEEDS = Object.freeze({
  SOL: Object.freeze({ account:'7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE',
    id:'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' }),
  USDC: Object.freeze({ account:'Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX',
    id:'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' }),
});

export function bonusUsdMicros({ asset, amountRaw, decimals, tradeTime, priceEvidence }) {
  const feed = BONUS_USD_FEEDS[asset];
  if (!feed || !/^(0|[1-9]\d*)$/.test(String(amountRaw))
    || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18
    || !Number.isSafeInteger(tradeTime) || priceEvidence?.source !== 'helius-finalized-pyth-mainnet-v1'
    || priceEvidence.feedAccount !== feed.account || priceEvidence.feedId !== feed.id
    || !Number.isSafeInteger(priceEvidence.blockTime) || priceEvidence.blockTime >= tradeTime
    || !Number.isSafeInteger(priceEvidence.publishTime) || priceEvidence.publishTime > priceEvidence.blockTime
    || tradeTime - priceEvidence.publishTime > 120
    || !Number.isSafeInteger(priceEvidence.exponent) || priceEvidence.exponent < -12 || priceEvidence.exponent > 0
    || !/^[1-9]\d*$/.test(String(priceEvidence.price)))
    throw new Error('Daily bonus USD score lacks a matching finalized historical price.');
  const numerator = BigInt(amountRaw) * BigInt(priceEvidence.price) * 1_000_000n;
  const denominator = 10n ** BigInt(decimals - priceEvidence.exponent);
  return String(numerator / denominator);
}

function keysOf(transaction) {
  const message = transaction?.transaction?.message;
  if (!message || !Array.isArray(message.accountKeys)) return null;
  return [...message.accountKeys, ...(transaction.meta?.loadedAddresses?.writable || []),
    ...(transaction.meta?.loadedAddresses?.readonly || [])].map(key => typeof key === 'string' ? key : key?.pubkey);
}

export function decodeFinalizedPythUpdate(transaction, { signature, account, id, beforeTime, maxAgeSeconds = 120,
  maxConfidenceBps = 100 }) {
  if (!transaction || transaction.meta?.err !== null || transaction.transaction?.signatures?.[0] !== signature
    || !Number.isSafeInteger(transaction.slot) || !Number.isSafeInteger(transaction.blockTime)
    || transaction.blockTime >= beforeTime || beforeTime - transaction.blockTime > maxAgeSeconds)
    return null;
  const keys = keysOf(transaction);
  if (!keys) return null;
  for (const [instructionIndex, ix] of (transaction.transaction.message.instructions || []).entries()) {
    if (keys[ix.programIdIndex] !== PYTH_PUSH || keys[ix.accounts?.[1]] !== PYTH_RECEIVER
      || keys[ix.accounts?.[5]] !== account || typeof ix.data !== 'string') continue;
    let data;
    try { data = Buffer.from(bs58.decode(ix.data)); } catch { continue; }
    // Pyth's update_price_feed instruction carries a big-endian PythNet
    // PriceFeedMessage inside a Borsh length-prefixed Merkle price update.
    if (data.length < 101 || !data.subarray(0, 8).equals(UPDATE_DISCRIMINATOR)
      || data.readUInt32LE(8) !== 85 || data[12] !== 0
      || data.subarray(13, 45).toString('hex') !== id) continue;
    const price = data.readBigInt64BE(45), conf = data.readBigUInt64BE(53), exponent = data.readInt32BE(61);
    const publishTime = Number(data.readBigInt64BE(65)), previousPublishTime = Number(data.readBigInt64BE(73));
    if (price <= 0n || exponent < -12 || exponent > 0 || !Number.isSafeInteger(publishTime)
      || !Number.isSafeInteger(previousPublishTime) || previousPublishTime > publishTime
      || publishTime > transaction.blockTime || beforeTime - publishTime > maxAgeSeconds
      || conf * 10_000n > price * BigInt(maxConfidenceBps)) continue;
    return { signature, slot:transaction.slot, blockTime:transaction.blockTime, instructionIndex,
      feedAccount:account, feedId:id, price:String(price), confidence:String(conf), exponent,
      publishTime, previousPublishTime, messageSha256:createHash('sha256').update(data.subarray(12, 97)).digest('hex'),
      source:'helius-finalized-pyth-mainnet-v1' };
  }
  return null;
}

export function createHeliusBonusPriceReader({ rpcUrl, fetchImpl = globalThis.fetch, maxAgeSeconds = 120,
  maxPages = 5, pageSize = 100 } = {}) {
  const url = new URL(rpcUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'mainnet.helius-rpc.com' || url.username || url.password
    || !url.searchParams.get('api-key')) throw new Error('A private Helius Mainnet RPC URL is required.');
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 600
    || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new Error('Invalid historical price search bounds.');
  let networkChecked = false;
  const rpc = async (method, params = []) => {
    const response = await fetchImpl(url, { method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ jsonrpc:'2.0', id:1, method, params }), signal:AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Helius historical price RPC HTTP ${response.status}.`);
    const body = await response.json();
    if (body.error) throw new Error(`Helius historical price RPC ${body.error.code}.`);
    return body.result;
  };
  return async function read({ asset, beforeTime }) {
    const feed = BONUS_USD_FEEDS[asset];
    if (!feed || !Number.isSafeInteger(beforeTime) || beforeTime <= maxAgeSeconds)
      throw new Error('Unsupported bonus price asset or timestamp.');
    if (!networkChecked) {
      if (await rpc('getGenesisHash') !== MAINNET_GENESIS) throw new Error('Historical price RPC is not Solana Mainnet.');
      networkChecked = true;
    }
    let paginationToken;
    for (let page = 0; page < maxPages; page++) {
      const result = await rpc('getTransactionsForAddress', [feed.account, {
        transactionDetails:'full', sortOrder:'desc', limit:pageSize,
        ...(paginationToken ? { paginationToken } : {}),
        filters:{ status:'succeeded', blockTime:{ gte:beforeTime - maxAgeSeconds, lte:beforeTime - 1 } },
      }]);
      if (!Array.isArray(result?.data) || result.data.length > pageSize) throw new Error('Helius historical price page is invalid.');
      for (const item of result.data) {
        const signature = item.transaction?.signatures?.[0];
        if (!signature || !Number.isSafeInteger(item.slot) || !Number.isSafeInteger(item.blockTime)) continue;
        const provisional = decodeFinalizedPythUpdate(item, { signature, ...feed, beforeTime, maxAgeSeconds });
        if (!provisional) continue;
        const [transaction, statuses] = await Promise.all([
          rpc('getTransaction', [signature, { commitment:'finalized', encoding:'json', maxSupportedTransactionVersion:1 }]),
          rpc('getSignatureStatuses', [[signature], { searchTransactionHistory:true }]),
        ]);
        if (transaction?.slot !== item.slot || transaction?.blockTime !== item.blockTime
          || statuses?.value?.[0]?.confirmationStatus !== 'finalized' || statuses.value[0].slot !== item.slot)
          throw new Error('Pyth price update finality or identity changed.');
        const verified = decodeFinalizedPythUpdate(transaction, { signature, ...feed, beforeTime, maxAgeSeconds });
        if (!verified || JSON.stringify(verified) !== JSON.stringify(provisional))
          throw new Error('Pyth price update differs from its archived evidence.');
        return verified;
      }
      if (!result.paginationToken) break;
      paginationToken = result.paginationToken;
    }
    throw new Error(`No finalized Pyth ${asset}/USD update within ${maxAgeSeconds} seconds before the trade.`);
  };
}
