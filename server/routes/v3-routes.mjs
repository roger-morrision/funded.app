import { createV3CreatorSettlementRoutes } from './v3-creator-settlement.mjs';
import { createV3RewardFundingRoutes } from './v3-reward-funding.mjs';

// Keep V3 settlement before category funding at the same dispatch position.
export function createV3Routes(dependencies) {
  const settlement = createV3CreatorSettlementRoutes(dependencies);
  const rewardFunding = createV3RewardFundingRoutes(dependencies);
  return async (req, res, url) => await settlement(req, res, url)
    || await rewardFunding(req, res, url);
}
