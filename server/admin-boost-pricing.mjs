import {createHash} from 'node:crypto';
import {DEFAULT_BOOST_PRICES,validateBoostPrices,pricedBoostPackages} from '../boost-pricing.js';
export function boostPricingSnapshot(state={}){
  const saved=state.adminSettings?.boostPricing,prices=validateBoostPrices(saved?.prices||DEFAULT_BOOST_PRICES),revision=saved?.revision??0;
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid boost pricing revision.');
  return{prices,revision,packages:pricedBoostPackages(prices),hash:createHash('sha256').update(JSON.stringify({prices,revision})).digest('hex')};
}
export async function handleAdminBoostPricing({req,res,url,store,body,json,session}){
  if(url.pathname!=='/api/admin/boost-prices')return false;
  if(req.method==='GET')return json(res,200,boostPricingSnapshot(await store.read()));
  if(req.method!=='POST')return json(res,405,{error:'Use GET or POST.'});
  try{
    const input=await body(req),prices=validateBoostPrices(input.prices);
    if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>500)throw Error('Enter a 10–500 character audit reason.');
    const result=await store.update(state=>{
      const prior=boostPricingSnapshot(state);
      if(input.expectedRevision!==prior.revision||input.expectedHash!==prior.hash)throw Error('Boost prices changed. Refresh before saving.');
      state.adminSettings||={};state.adminAudit||={};
      const at=new Date().toISOString(),revision=prior.revision+1;
      state.adminSettings.boostPricing={prices,revision,updatedAt:at,updatedBy:session.wallet};
      state.adminAudit[`boost-prices:${revision}`]={action:'boost-prices',previous:prior.prices,prices,revision,wallet:session.wallet,reason:input.reason.trim(),at};
      return boostPricingSnapshot(state);
    });return json(res,200,result);
  }catch(error){return json(res,409,{error:error.message});}
}
