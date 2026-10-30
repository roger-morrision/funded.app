import { el, link, address, signature, array, utc } from './view-utils.js';
const integer=value=>/^(0|[1-9]\d*)$/.test(String(value));
export function reserveFacts(data,mint){
  const row=data?.cluster==='devnet'?array(data.reserves).find(row=>row.mint===mint):null;
  if(!row||row.verified!==true)return null;
  return {...row,checkedAt:data.checkedAt,remainingBaseUnits:integer(row.remainingBaseUnits)?row.remainingBaseUnits:null,
    claimedBaseUnits:integer(row.claimedBaseUnits)?row.claimedBaseUnits:null,totalBaseUnits:integer(row.totalBaseUnits)?row.totalBaseUnits:null};
}
export function mountReserveFacts(root,app){
  const box=el('section');box.dataset.reserveFacts='';root.append(box);let serial=0,last='';
  async function refresh(){const mint=app.getCoinMintAddress();if(!root.open||!address(mint)||last===mint)return;last=mint;const id=++serial;box.replaceChildren(el('h3','Checking reserve custody…'));
    try{const response=await app.apiRequest('/api/airdrops/reserves',{signal:AbortSignal.timeout(18000)});
      if(id!==serial||mint!==app.getCoinMintAddress())return;
      const row=response.available?reserveFacts(response.data,mint):null;
      box.replaceChildren(el('h3','Community reserve custody'));
      if(!row){box.append(el('p','Verified reserve custody unavailable for this mint. A launch allocation does not prove the tokens are funded.'));last='';return;}
      const active=['drop-active','drop-closed'].includes(row.status),list=el('dl');
      for(const [label,value] of [['Verified state',row.status],['Checked',utc(row.checkedAt)],['Funding authority',row.authority||'Unavailable'],
        ['Reserved allocation (whole tokens)',row.reservedTokens??'Unavailable'],['Funded amount (whole tokens)',row.fundedTokens??'Unavailable'],
        ['Active drop total (token base units)',active?row.totalBaseUnits??'Unavailable':'No verified active drop'],['Claimed (token base units)',active?row.claimedBaseUnits??'Unavailable':'Unavailable'],
        ['Remaining in drop (token base units)',active?row.remainingBaseUnits??'Unavailable':'Unavailable'],['Claim deadline',utc(row.expiresAt)],['Snapshot',row.snapshotHash||'Unavailable'],['Custody scope',row.scope||'Unavailable']])list.append(el('dt',label),el('dd',String(value)));
      box.append(list,el('p','Reserved allocation, custody, and recipient claims are separate. These token balances are not SOL rewards or supply burns.'));
      for(const [label,value] of [['Reserve vault',row.vault],['Drop token account',row.dropTokenAccount||row.tokenAccount]])if(address(value))box.append(link(`${label} ${value} ↗`,`https://explorer.solana.com/address/${value}?cluster=devnet`,true));
      for(const [label,value] of [['Funding receipt',row.fundingSignature],['Drop opening receipt',row.dropOpeningSignature]])if(signature(value))box.append(link(`${label} ↗`,`https://explorer.solana.com/tx/${value}?cluster=devnet`,true));
    }catch{if(id===serial){box.replaceChildren(el('p','Reserve verification unavailable. Close and reopen these facts to retry.'));last='';}}
  }
  window.addEventListener('funded:coin-facts-loading',()=>{serial++;last='';box.replaceChildren();});root.addEventListener('toggle',()=>void refresh());window.addEventListener('funded:coin-facts',()=>void refresh());
}
