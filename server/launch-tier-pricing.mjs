import { Connection } from '@solana/web3.js';
import { fetchVerifiedPoolSnapshot as readVerifiedPoolSnapshot } from '../pump-trading.js';
import { launchTierAmounts } from '../launch-tier-quote.js';
import {assertRpcNetwork,requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';

// Created once by the server composition layer; state belongs to this instance.
export function createLaunchTierPricing({
  solanaCluster,
  fundedTokenMint,
  fundedSwapPool,
  solanaRpcUrl,
  readSolUsdQuote,
  fetchVerifiedPoolSnapshot = readVerifiedPoolSnapshot,
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
    if (!fundedTokenMint || !fundedSwapPool)
      throw new Error('The selected network $FUNDED mint and verified SOL pool must be configured.');
    const connection=connectionFactory(solanaRpcUrl);
    await assertRpcNetwork(connection,solanaCluster);
    const [sol, pool] = await Promise.all([
      readSolUsdQuote(),
      fetchVerifiedPoolSnapshot({ connection, mint:fundedTokenMint, poolAddress:fundedSwapPool }),
    ]);
    if (!sol || Date.now() - Date.parse(sol.fetchedAt) > 120_000)
      throw new Error('A fresh SOL/USD quote is unavailable.');
    const priceUsd = Number(pool.spotPriceSol) * Number(sol.priceUsd);
    const amounts = launchTierAmounts(priceUsd);
    const value = { cluster:solanaCluster, genesisHash:SOLANA_GENESIS[solanaCluster], fundedMint:fundedTokenMint, pool:pool.pool, slot:pool.slot,
      tokenPriceUsd:priceUsd, solUsd:Number(sol.priceUsd), amounts,
      observedAt:new Date().toISOString(), source:'verified-pump-swap-pool' };
    launchTierPriceCache = { value, expires:Date.now() + 30_000 };
    return value;
  }

  return { currentLaunchTierPricing };
}
