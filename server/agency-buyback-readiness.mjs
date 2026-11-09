import {buybackPriceService,priceSignerActivated} from './buyback-price-signer.mjs';

// Deployment/worker readiness does not prove that a milestone can be signed.
export async function readAgencyBuybackReadiness({connection,programId,env=process.env}) {
  if(env.FUNDED_V3_AGENCY_BUYBACK_ENABLED!=='true')
    return {ready:false,reason:'Milestone buybacks are disabled.'};
  try {
    const service=buybackPriceService(env);
    if(!service)return {ready:false,reason:'Independent buyback price signer is not configured.'};
    if(!await priceSignerActivated(connection,programId,service.signer))
      return {ready:false,reason:'Independent buyback price signer is not activated on Devnet.'};
    return {ready:true,reason:null};
  } catch {
    return {ready:false,reason:'Independent buyback price signer verification is unavailable.'};
  }
}
