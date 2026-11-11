import { airdropClaimState } from '../../../airdrop-directory-model.js';
import { el, link, address, signature, array, utc } from './view-utils.js';
import { APP_NET } from '../shared/app-network.js';
const integer=value=>/^(0|[1-9]\d*)$/.test(String(value));
export function reserveFacts(data,mint){
  const row=data?.cluster===APP_NET?array(data.reserves).find(row=>row.mint===mint):null;
  if(!row||row.verified!==true)return null;
  return {...row,checkedAt:data.checkedAt,remainingBaseUnits:integer(row.remainingBaseUnits)?row.remainingBaseUnits:null,
    claimedBaseUnits:integer(row.claimedBaseUnits)?row.claimedBaseUnits:null,totalBaseUnits:integer(row.totalBaseUnits)?row.totalBaseUnits:null};
}
export function mountReserveFacts(root,app){
  const box=el('section');box.dataset.reserveFacts='';root.append(box);let serial=0,last='';
  async function refresh(){const mint=app.getCoinMintAddress();if(!root.open||!address(mint)||last===mint)return;last=mint;const id=++serial;box.replaceChildren(el('h3','Checking reserve custody…'));
    try{const response=await app.apiRequest('/api/airdrops/reserves?mint='+encodeURIComponent(mint),{signal:AbortSignal.timeout(45000)});
      if(id!==serial||mint!==app.getCoinMintAddress())return;
      const row=response.available?reserveFacts(response.data,mint):null;
      const reserved=row?.reservedTokens!=null?Number(row.reservedTokens).toLocaleString('en-US'):null;
      box.replaceChildren(el('h3','Airdrop rule'),
        el('p',`${reserved?reserved+' tokens of this coin are':'Part of this coin’s supply is'} reserved for $RICH holders. Hold $RICH until migration to receive tokens automatically, proportional to your share of eligible holdings. No claim is needed.`));
      if(row)box.append(el('p','Delivery status: '+airdropClaimState(row).label));
      box.append(link('Check your allocation', `/?airdropMint=${encodeURIComponent(mint)}#airdrops`));
      if(!row)last='';
    }catch{if(id===serial){box.replaceChildren(el('p','Reserve verification unavailable. Close and reopen these facts to retry.'));last='';}}
  }
  window.addEventListener('funded:coin-facts-loading',()=>{serial++;last='';box.replaceChildren();});root.addEventListener('toggle',()=>{last='';serial++;void refresh();});window.addEventListener('funded:coin-facts',()=>void refresh());
}
