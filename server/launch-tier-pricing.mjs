import { Connection } from '@solana/web3.js';
import { fetchVerifiedPoolSnapshot as readVerifiedPoolSnapshot } from '../pump-trading.js';
import { launchTierAmounts } from '../launch-tier-quote.js';

// Created once by the server composition layer; state belongs to this instance.
export function createLaunchTierPricing({
  solanaCluster,
  fundedTokenMint,
  fundedSwapPool,
  solanaRpcUrl,
  readSolUsdQuote,
  fetchVerifiedPoolSnapshot = readVerifiedPoolSnapshot,
}) {
  let launchTierPriceCache = null;

  async function currentLaunchTierPricing() {
    if (launchTierPriceCache && launchTierPriceCache.expires > Date.now()) return launchTierPriceCache.value;
    if (solanaCluster !== 'devnet' || !fundedTokenMint || !fundedSwapPool)
      throw new Error('The Devnet $FUNDED mint and verified SOL pool must be configured.');
    const [sol, pool] = await Promise.all([
      readSolUsdQuote(),
      fetchVerifiedPoolSnapshot({ connection:new Connection(solanaRpcUrl, 'confirmed'), mint:fundedTokenMint, poolAddress:fundedSwapPool }),
    ]);
    if (!sol || Date.now() - Date.parse(sol.fetchedAt) > 120_000)
      throw new Error('A fresh SOL/USD quote is unavailable.');
    const priceUsd = Number(pool.spotPriceSol) * Number(sol.priceUsd);
    const amounts = launchTierAmounts(priceUsd);
    const value = { cluster:'devnet', fundedMint:fundedTokenMint, pool:pool.pool, slot:pool.slot,
      tokenPriceUsd:priceUsd, solUsd:Number(sol.priceUsd), amounts,
      observedAt:new Date().toISOString(), source:'verified-pump-swap-pool' };
    launchTierPriceCache = { value, expires:Date.now() + 30_000 };
    return value;
  }

  return { currentLaunchTierPricing };
}
