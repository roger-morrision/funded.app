import {startCommunityClaimIndex,startV3HolderRewardWorker} from './background-maintenance.mjs';
import {startTradeFinancialWakeWorker} from './trade-financial-wakeup.mjs';
import {startFinancialFlowMonitor} from './financial-flow-monitor.mjs';
import {createCommunityDeliveryRuntime} from './community-delivery-runtime.mjs';
import {createDeveloperAutoRelease} from './developer-auto-release.mjs';

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
  if(context.solanaCluster==='mainnet-beta')return{mode:'mainnet-read-only',started:[]};
  let holder;
  const result=startApiFinancialWorkers({env:context.env,
    startCommunity:()=>startCommunityClaimIndex(context),
    startHolder:()=>{holder=startV3HolderRewardWorker(context);},
    startDailyBonus:()=>context.dailyBonusRuntime.start(),
  });
  if(result.mode==='api-and-workers'&&context.solanaCluster==='devnet'){
    const delivery=createCommunityDeliveryRuntime(context);
    delivery.start();
    if(delivery.enabled)result.started.push('community-auto-delivery');
    const developerRelease=createDeveloperAutoRelease(context);developerRelease.start();
    if(developerRelease.enabled)result.started.push('developer-auto-release');
    startTradeFinancialWakeWorker({store:context.automaticRewardStore,
      run:async()=>{await holder?.tick?.();await context.dailyBonusRuntime.tick();}});
    if(context.store)startFinancialFlowMonitor(context);
  }
  (context.logger||console).log(JSON.stringify({event:'api-financial-worker-role',...result}));
  return result;
}
