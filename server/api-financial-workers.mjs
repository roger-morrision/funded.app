import {startOutflowAlerts} from './outflow-alert-runtime.mjs';
import {startCommunityClaimIndex,startV3HolderRewardWorker} from './background-maintenance.mjs';
import {startTradeFinancialWakeWorker} from './trade-financial-wakeup.mjs';
import {startFinancialFlowMonitor} from './financial-flow-monitor.mjs';
import {createCommunityDeliveryRuntime} from './community-delivery-runtime.mjs';
import {createDeveloperAutoRelease} from './developer-auto-release.mjs';
import {startV3PairedTokenWorker} from './v3-paired-token-worker.mjs';
import {selectPreparedTokenConversionRecovery} from './token-conversion-bootstrap.mjs';

// The public server currently supplies no private conversion runtime. An
// explicitly injected, reviewed recovery-only controller can be selected for
// manual pages; selection never starts its timer or opens a signing route.
export function selectMainnetTokenConversionRecovery(context){
  const runtime=context.preparedTokenConversionRuntime;
  if(runtime===undefined)return null;
  if(context.solanaCluster!=='mainnet-beta')throw Error('Private conversion recovery requires Mainnet context.');
  return selectPreparedTokenConversionRecovery(runtime);
}

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
  const privateRecovery=selectMainnetTokenConversionRecovery(context);
  // Outflow alerts watch treasuries on every network, including Mainnet.
  try{startOutflowAlerts(context);}catch{console.error(JSON.stringify({event:'outflow_alerts_start_failed'}));}
  if(context.solanaCluster==='mainnet-beta')return privateRecovery
    ?{mode:'mainnet-read-only',started:[],privateRecoveryWorker:privateRecovery}
    :{mode:'mainnet-read-only',started:[]};
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
    const pairedToken=startV3PairedTokenWorker(context);
    if(pairedToken)result.started.push('paired-token-fees');
    startTradeFinancialWakeWorker({store:context.automaticRewardStore,
      run:async()=>{await holder?.tick?.();await context.dailyBonusRuntime.tick();}});
    if(context.store)startFinancialFlowMonitor(context);
  }
  (context.logger||console).log(JSON.stringify({event:'api-financial-worker-role',...result}));
  return result;
}
