import { apiRequest } from '../../../client.js';
import { currentServiceFees, setCurrentServiceFees, serviceFeeSol, validateServiceFees } from '../../../service-fees.js';
import { setListingPriceUsd } from '../../../listing-policy.js';

export async function refreshServiceFees(appState = null) {
  const response = await (appState?.apiRequest || apiRequest)('/api/service-fees', { signal:AbortSignal.timeout(8000) });
  const data = response.data;
  if (!response.available || data?.cluster !== 'devnet' || !/^[a-f0-9]{64}$/.test(data.hash || '')
    || !Number.isSafeInteger(data.revision) || data.revision < 0 || typeof data.recipient !== 'string'
    || typeof data.tradeRecipient !== 'string') throw new Error('Current app service fees are unavailable. Refresh before signing.');
  validateServiceFees(data.policy);
  setCurrentServiceFees(data.policy); setListingPriceUsd(data.policy.listingUsd);
  if (appState) appState.serviceFeeConfig = data;
  globalThis.window?.dispatchEvent(new CustomEvent('funded:service-fees', { detail:data }));
  return data;
}
export const appTradeBps = appState => appState.serviceFeeConfig?.policy.tradeBps ?? appState.TRADE_FEE_BPS;
export const appTradeRecipient = appState => appState.serviceFeeConfig?.tradeRecipient ?? appState.TRADE_FEE_OWNER;
export async function quoteLaunchServiceFee(appState,fees,payer) {
  const key=`${payer}:${fees.hash}`;
  const valid=q=>q?.payer===payer && q.policyHash===fees.hash && q.amountLamports===fees.policy.launchLamports
    && q.recipient===fees.recipient && Date.parse(q.expiresAt)>Date.now()+60000;
  if(valid(appState.serviceFeeQuoteCache))return appState.serviceFeeQuoteCache;
  if(appState.serviceFeeQuoteFlight?.key===key)return appState.serviceFeeQuoteFlight.promise;
  const promise=(async()=>{
    const response=await appState.apiRequest('/api/launch-service-quote',{method:'POST',body:{payer,expectedHash:fees.hash}});
    if(!response.available || !valid(response.data))throw new Error('Launch service fee quote is unavailable.');
    appState.serviceFeeQuoteCache=response.data;return response.data;
  })();
  appState.serviceFeeQuoteFlight={key,promise};
  try{return await promise;}finally{if(appState.serviceFeeQuoteFlight?.promise===promise)appState.serviceFeeQuoteFlight=null;}
}
export function serviceFeeGuide() {
  const f = currentServiceFees();
  return `App trading: ${f.tradeBps/100}% on buys and sells. Every coin launch: ${serviceFeeSol(f.launchLamports)} SOL service fee. Optional Pro: $${f.proUsd} in $FUNDED burned; Premier: $${f.premierUsd} in $FUNDED burned, plus the launch service fee. External coin listing: $${f.listingUsd} in $FUNDED burned. Listing is included for coins launched through funded.vip. Pump/pool fees, network costs, account rent and community reserve purchases are separate. Service fees are accounted for separately from the 80/20 collected creator-fee distribution. Issued quotes retain their reviewed amounts until expiry; admin edits apply to new quotes.`;
}
export function initServiceFeeCopy() {
  const render = () => {
    const f = currentServiceFees();
    for (const tier of ['pro','premier']) {
      const label = document.querySelector(`.creator-burn-section [data-burn-tier="${tier}"] > span`);
      if (label) label.textContent = `${tier.toUpperCase()} · $${f[tier+'Usd']}`;
    }
    const promotions = document.querySelector('.creator-burn-section');
    if(promotions && !document.getElementById('launch-service-fee-note')) { const p=document.createElement('p'); p.id='launch-service-fee-note'; p.className='field-help'; promotions.append(p); }
    const note=document.getElementById('launch-service-fee-note'); if(note)note.textContent=`Every launch pays ${serviceFeeSol(f.launchLamports)} SOL, plus network, reserve and account costs. Pro and Premier add the displayed promotion burn. Listing is included.`;
    const target = document.querySelector('#capital-flow');
    if (target && !document.getElementById('service-fee-guide')) {
      const p = document.createElement('p'); p.id = 'service-fee-guide'; p.className = 'panel-explainer'; target.append(p);
    }
    const p = document.getElementById('service-fee-guide'); if (p) p.textContent = serviceFeeGuide();
    const launch = document.querySelector('#cost-tier-label');
    if (launch) launch.textContent = `Launch service fee: ${serviceFeeSol(f.launchLamports)} SOL`;
  };
  window.addEventListener('funded:service-fees', render);
  let last = 0;
  const refresh = () => { if (!document.hidden && Date.now()-last > 30_000) { last = Date.now(); void refreshServiceFees().catch(() => {}); } };
  window.addEventListener('hashchange', refresh); render(); refresh();
}
