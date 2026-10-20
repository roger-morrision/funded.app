import {startCommunityClaimIndex,startV3HolderRewardWorker} from './background-maintenance.mjs';

// An API-only acceptance instance retains all signed routes and readiness
// checks; the primary app remains the sole internal payout scheduler.
export function startApiFinancialWorkers({env=process.env,startCommunity,startHolder,startDailyBonus}) {
  if(env.FUNDED_API_ONLY!==undefined&&!['true','false'].includes(env.FUNDED_API_ONLY))
    throw new Error('FUNDED_API_ONLY must be explicitly true or false.');
  if(env.FUNDED_API_ONLY==='true')return{mode:'api-only',started:[]};
  startCommunity();startHolder();startDailyBonus();
  return{mode:'api-and-workers',started:['community-index','holder-payouts','daily-bonuses']};
}

export function startApiFinancialWorkerServices(context) {
  return startApiFinancialWorkers({env:context.env,
    startCommunity:()=>startCommunityClaimIndex(context),
    startHolder:()=>startV3HolderRewardWorker(context),
    startDailyBonus:()=>context.dailyBonusRuntime.start(),
  });
}
