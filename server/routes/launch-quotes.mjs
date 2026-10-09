import { PublicKey } from '@solana/web3.js';
import { LAUNCH_TIER_USD } from '../../launch-tier-quote.js';
import { allowedAuthOrigin } from '../x-auth.mjs';

// Dispatch after shared authorization and rate checks; preserve caller route order.
export function createLaunchQuoteRoutes({
  store, body, clientKey, currentLaunchTierPricing, fundedTokenMint, id,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleLaunchQuoteRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/launch-tier-quote') {
      try { return json(res, 200, await currentLaunchTierPricing()); }
      catch (error) { return json(res, 503, { error: String(error.message || 'The $FUNDED tier price is unavailable.') }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/launch-tier-quote') {
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Request the launch quote from funded.vip.' });
      if (!await store.chargeRpcRate(`launch-tier-quote:${clientKey(req)}`, 1, 8, Math.floor(Date.now() / 60_000) * 60_000))
        return json(res, 429, { error:'Too many launch quotes; retry shortly.' });
      const input = await body(req);
      const tier = String(input.tier || '');
      if (!Object.hasOwn(LAUNCH_TIER_USD, tier)) return json(res, 400, { error:'Choose Pro or Premier for a paid launch quote.' });
      let payer;
      try { payer = new PublicKey(String(input.payer || '')).toBase58(); }
      catch { return json(res, 400, { error:'Connect a valid Devnet wallet before requesting a paid tier quote.' }); }
      let pricing;
      try { pricing = await currentLaunchTierPricing(); }
      catch (error) { return json(res, 503, { error:String(error.message || 'The $FUNDED tier price is unavailable.') }); }
      const now = Date.now();
      const quote = { id:id('launch_tier'), tier, payer, fundedMint:fundedTokenMint,
        amountTokens:pricing.amounts[tier], usd:LAUNCH_TIER_USD[tier], tokenPriceUsd:pricing.tokenPriceUsd,
        pool:pricing.pool, slot:pricing.slot, source:pricing.source,
        createdAt:new Date(now).toISOString(), expiresAt:new Date(now + 10 * 60_000).toISOString() };
      await store.update(current => {
        current.launchTierQuotes ||= {};
        for (const [key, old] of Object.entries(current.launchTierQuotes))
          if (Date.parse(old.expiresAt) < now - 48 * 3_600_000) delete current.launchTierQuotes[key];
        current.launchTierQuotes[quote.id] = quote;
      });
      return json(res, 201, quote);
    }
    return false;
  };
}
