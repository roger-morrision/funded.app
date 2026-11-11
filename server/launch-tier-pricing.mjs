import { Connection } from '@solana/web3.js';
import { fetchRichMarketSnapshot } from '../rich-market.js';
import { launchTierAmounts } from '../launch-tier-quote.js';
import {assertRpcNetwork,requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';

// Created once by the server composition layer; state belongs to this instance.
export function createLaunchTierPricing({
  solanaCluster,
  fundedTokenMint,
  fundedSwapPool,
  solanaRpcUrl,
  readSolUsdQuote,
  readIndexedPriceUsd = null,
  readMarket = fetchRichMarketSnapshot,
  connectionFactory=url=>new Connection(url,'confirmed'),
}) {
  let launchTierPriceCache = null;
  let launchTierPriceRead = null;

  // Concurrent requests after the 30-second cache expires share one RPC read.
  function currentLaunchTierPricing() {
    if (launchTierPriceCache && launchTierPriceCache.expires > Date.now()) return Promise.resolve(launchTierPriceCache.value);
    launchTierPriceRead ??= readLaunchTierPricing().finally(() => { launchTierPriceRead = null; });
    return launchTierPriceRead;
  }

  async function readLaunchTierPricing() {
    requireSolanaCluster(solanaCluster);
    if (!fundedTokenMint)
      throw new Error('The selected network $RICH mint must be configured.');
    // Mainnet $RICH outside a Pump curve/PumpSwap pool (or without a configured
    // pool) is priced from the indexed Jupiter price; Devnet keeps the pool proof.
    if (solanaCluster === 'mainnet-beta' && readIndexedPriceUsd && !fundedSwapPool) return indexedPricing();
    const connection=connectionFactory(solanaRpcUrl);
    await assertRpcNetwork(connection,solanaCluster);
    const [sol, pool] = await Promise.all([
      readSolUsdQuote(),
      readMarket({ connection, mint:fundedTokenMint, poolAddress:fundedSwapPool }),
    ]);
    if (!sol || !Number.isFinite(Date.parse(sol.fetchedAt))
      || Math.abs(Date.now() - Date.parse(sol.fetchedAt)) > 120_000
      || !Number.isFinite(Number(sol.priceUsd)) || Number(sol.priceUsd)<=0)
      throw new Error('A fresh SOL/USD quote is unavailable.');
    const priceUsd = Number(pool.spotPriceSol) * Number(sol.priceUsd);
    const amounts = launchTierAmounts(priceUsd);
    const value = { cluster:solanaCluster, genesisHash:SOLANA_GENESIS[solanaCluster], fundedMint:fundedTokenMint, pool:pool.pool, slot:pool.slot,
      market:pool.market,bondingCurve:pool.bondingCurve,
      tokenPriceUsd:priceUsd, solUsd:Number(sol.priceUsd), amounts,
      observedAt:new Date().toISOString(), source:pool.market==='pump-curve'?'verified-pump-bonding-curve':'verified-pump-swap-pool' };
    launchTierPriceCache = { value, expires:Date.now() + 30_000 };
    return value;
  }

  async function indexedPricing() {
    const [sol, priceUsd] = await Promise.all([readSolUsdQuote(), readIndexedPriceUsd(fundedTokenMint)]);
    if (!Number.isFinite(Number(priceUsd)) || Number(priceUsd) <= 0) throw new Error('An indexed $RICH price is unavailable. No payment was requested.');
    if (!sol || !Number.isFinite(Number(sol.priceUsd)) || Number(sol.priceUsd) <= 0) throw new Error('A fresh SOL/USD quote is unavailable.');
    const value = { cluster:solanaCluster, genesisHash:SOLANA_GENESIS[solanaCluster], fundedMint:fundedTokenMint, pool:null, slot:null, market:'indexed', bondingCurve:null,
      tokenPriceUsd:Number(priceUsd), solUsd:Number(sol.priceUsd), amounts:launchTierAmounts(Number(priceUsd)), observedAt:new Date().toISOString(), source:'jupiter-indexed-price' };
    launchTierPriceCache = { value, expires:Date.now() + 30_000 };
    return value;
  }

  return { currentLaunchTierPricing };
}
