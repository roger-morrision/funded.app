import { createV3CreatorSettlementRoutes } from './v3-creator-settlement.mjs';
import { createV3RewardFundingRoutes } from './v3-reward-funding.mjs';
import { createV3XClaimRoutes } from './v3-x-claims.mjs';
import { createV3BuybackRoutes } from './v3-buyback.mjs';

const retiredV2Path = path => path === '/api/settlements/claims'
  || path === '/api/payout-obligations/sol'
  || path === '/api/x-fee/obligations'
  || path === '/api/referral-claims/prepare'
  || path === '/api/keeper/reconcile-wrapped-sol'
  || /^\/api\/sol-claims\/[^/]+\/(?:prepare|verify|attest|execute)$/.test(path)
  || /^\/api\/referral-claims\/[^/]+\/(?:verify|execute)$/.test(path)
  || /^\/api\/tokens\/[^/]+\/creator-claim\/(?:prepare|request|settle)$/.test(path)
  || /^\/api\/tokens\/[^/]+\/reward-funding\/(?:pending|settle)$/.test(path);

// Keep V3 settlement before category funding at the same dispatch position.
export function createV3Routes(dependencies) {
  const settlement = createV3CreatorSettlementRoutes(dependencies);
  const rewardFunding = createV3RewardFundingRoutes(dependencies);
  const xClaims = createV3XClaimRoutes(dependencies);
  const buyback = createV3BuybackRoutes(dependencies);
  return async (req, res, url) => {
    if (['GET', 'POST'].includes(req.method) && retiredV2Path(url.pathname)) {
      dependencies.respond(res, 410, { error:'The V2 fee route is retired. This action requires a verified V3 launch and payout path.' });
      return true;
    }
    return await settlement(req, res, url) || await rewardFunding(req, res, url)
      || await xClaims(req, res, url) || await buyback(req, res, url);
  };
}
