import { PublicKey } from '@solana/web3.js';
import { LAUNCH_TIER_USD } from '../../launch-tier-quote.js';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { readServiceFees, serviceFeeRecipient } from '../service-fees.mjs';
import { launchTierAmounts } from '../../launch-tier-quote.js';

// Dispatch after shared authorization and rate checks; preserve caller route order.
export function createLaunchQuoteRoutes({
  store, body, clientKey, currentLaunchTierPricing, fundedTokenMint, id,
  respond,
  env = process.env,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleLaunchQuoteRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/service-fees') {
      const fees = await readServiceFees(store);
      return json(res,200,{ ...fees, cluster:'devnet', recipient:serviceFeeRecipient(env),
        tradeRecipient:new PublicKey(env.FUNDED_TRADE_FEE_OWNER).toBase58() });
    }
    if (req.method === 'POST' && url.pathname === '/api/launch-service-quote') {
      if (!allowedAuthOrigin(req,env.CORS_ORIGIN)) return json(res,403,{error:'Request the launch fee quote from funded.vip.'});
      if (!await store.chargeRpcRate(`launch-service:${clientKey(req)}`,1,8,Math.floor(Date.now()/60_000)*60_000)) return json(res,429,{error:'Too many launch fee quotes.'});
      const input = await body(req); let payer;
      try { payer = new PublicKey(input.payer).toBase58(); } catch { return json(res,400,{error:'A valid payer is required.'}); }
      const fees = await readServiceFees(store), now = Date.now(), recipient = serviceFeeRecipient(env);
      if (payer === recipient || input.expectedHash !== fees.hash) return json(res,409,{error:'Launch fees changed or payer equals treasury. Refresh and review before signing.'});
      const quote = { id:id('launch_service'), payer, recipient, amountLamports:fees.policy.launchLamports,
        policyHash:fees.hash, revision:fees.revision, createdAt:new Date(now).toISOString(), expiresAt:new Date(now+10*60_000).toISOString() };
      await store.update(state => { state.launchServiceQuotes ||= {}; state.launchServiceQuotes[quote.id] = quote; });
      return json(res,201,quote);
    }
    if (req.method === 'GET' && url.pathname === '/api/launch-tier-quote') {
      try { const pricing = await currentLaunchTierPricing(), fees = await readServiceFees(store); return json(res, 200, { ...pricing,
        amounts:launchTierAmounts(pricing.tokenPriceUsd,fees.policy), usdTargets:{pro:fees.policy.proUsd,premier:fees.policy.premierUsd}, serviceFees:fees }); }
      catch (error) { return json(res, 503, { error: String(error.message || 'The $FUNDED tier price is unavailable.') }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/launch-tier-quote') {
      if (!allowedAuthOrigin(req, env.CORS_ORIGIN)) return json(res, 403, { error:'Request the launch quote from funded.vip.' });
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
      const fees = await readServiceFees(store);
      const quote = { id:id('launch_tier'), tier, payer, fundedMint:fundedTokenMint,
        amountTokens:launchTierAmounts(pricing.tokenPriceUsd,fees.policy)[tier], usd:tier === 'pro' ? fees.policy.proUsd : fees.policy.premierUsd, tokenPriceUsd:pricing.tokenPriceUsd,
        serviceFeeHash:fees.hash,
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
