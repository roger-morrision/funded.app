import { address, signature, array } from './view-utils.js';
import { receiptUrl } from './receipt-inspector.js';
export function typedSearch(query,launches,followed=[]){
  const term=String(query||'').trim(),lower=term.toLowerCase();if(!term)return [];
  if(signature(term))return [{mint:`tx:${term}`,name:'Transaction receipt',symbol:'TX',subtitle:term,href:receiptUrl(term),marketCap:'Evidence check required',stage:'Recorded coverage may be unavailable',type:'transaction'}];
  const rows=[];
  if(address(term))rows.push({mint:`wallet:${term}`,name:'Wallet profile',symbol:'WALLET',subtitle:term,href:`/wallet/${term}`,marketCap:'Public address',stage:'Identity and balances checked on profile',type:'wallet'});
  const wallets=new Map(array(launches).filter(row=>row.onchainVerified&&row.cluster==='devnet'&&address(row.creatorWallet)).map(row=>[row.creatorWallet,{address:row.creatorWallet,name:row.creatorName||'Launch creator wallet'}]));
  for(const row of array(followed))if(address(row.address))wallets.set(row.address,{...row,name:row.label||row.name||'Followed wallet'});
  for(const row of wallets.values())if(row.address!==term&&[row.address,row.name].some(value=>String(value).toLowerCase().includes(lower)))rows.push({mint:`creator:${row.address}`,name:row.name,symbol:'CREATOR',subtitle:row.address,href:`/wallet/${row.address}`,marketCap:'Recorded creator wallet',stage:'No endorsement or safety score',type:'creator'});
  return rows.slice(0,6);
}
export function creatorSearchCandidates(data){
  if(data?.cluster!=='devnet')return [];
  return array(data.creators).filter(row=>/^\d{1,24}$/.test(String(row.id))).slice(0,5).map(row=>({mint:`creator-x:${row.id}`,type:'creator',name:String(row.name||row.handle||'Creator').slice(0,80),symbol:'CREATOR',subtitle:String(row.handle||'').slice(0,30),href:`/creator/x/${row.id}`,marketCap:row.identityVerified?'Account ownership verified':'Named recipient; ownership unverified',stage:'Policy support is not endorsement'}));
}
export const candidateHref=row=>row?.href&&/^\/(?:wallet\/[1-9A-HJ-NP-Za-km-z]{32,44}|creator\/x\/\d{1,24}|\?receipt=[1-9A-HJ-NP-Za-km-z]{64,88}#payments\/activity)$/.test(row.href)?row.href:`/token/${encodeURIComponent(row?.mint||'')}`;
