import { panel,el,link,array,button,address,utc } from './view-utils.js';
import { APP_NET } from '../shared/app-network.js';
export function initializeCreatorWalletFacts(app){
  const parent=document.querySelector('#wallet-page');if(!parent)return;
  const details=el('details',null,'flow-panel');details.append(el('summary','Creator delivery facts'));const body=panel('creator-wallet-facts','Creator delivery facts','Open to check recorded launch and reward-delivery coverage for this wallet.');details.append(body);parent.append(details);
  let serial=0,last='';
  async function refresh(){const wallet=app.getWalletDetailAddress();if(!details.open||!address(wallet)||last===wallet)return;last=wallet;const id=++serial;body.replaceChildren(el('h3','Checking creator delivery records…'));body.removeAttribute('aria-labelledby');
    try{const response=await app.apiRequest('/api/financial/operations',{signal:AbortSignal.timeout(18000)});if(id!==serial||wallet!==app.getWalletDetailAddress())return;
      if(!response.available||response.data?.cluster!==APP_NET||response.data.evidence!=='recorded-finalized-v3')throw new Error();
      const row=array(response.data.creators).find(row=>row.wallet===wallet);body.replaceChildren(el('h3','Recorded creator facts'));
      if(!row)body.append(el('p','This wallet has no creator entry in the returned coverage. This does not prove it has never launched or paid rewards.'));
      else body.append(el('p',`${row.launches} registered launches · ${row.verifiedPaymentReceipts} recorded payment receipts · ${row.returningRecipients} returning paid wallets`),el('p',array(row.badges).join(' · ')),el('p',response.data.retentionCoverage));
      body.append(el('p',`Recorded ${utc(response.data.generatedAt)}. Badges describe recorded events; they are not an endorsement, risk score or reward entitlement.`),link('Inspect receipt coverage','#payments/activity'));
    }catch{if(id===serial){body.replaceChildren(el('p','Creator delivery facts unavailable from the current API.'),button('Retry creator facts',()=>{last='';void refresh();}));last='';}}
  }
  details.addEventListener('toggle',()=>void refresh());window.addEventListener('funded:route-change',()=>{serial++;last='';body.replaceChildren(el('p','Open to check this wallet’s recorded delivery facts.'));void refresh();});
}
