import { marketingAgencyCapabilities } from '../marketing-agency-policy.mjs';
import {agencyPublicSummary} from '../agency-public-summary.mjs';

export function createMarketingAgencyRoutes({ respond,store,readLaunchConfig,env=process.env }) {
  return async function handleMarketingAgency(req, res, url) {
    if (url.pathname !== '/api/marketing-agency') return false;
    if (req.method !== 'GET') { respond(res, 405, { error: 'Agency execution is not activated.' }); return true; }
    if(env.FUNDED_V3_AGENCY_ENABLED==='true'&&store&&readLaunchConfig){
      try{
        const config=await readLaunchConfig();
        if(config.ready&&config.agency&&config.protocolSplit.agencyPercent===10){
          const state=await store.read();
          respond(res,200,{...marketingAgencyCapabilities(),status:'deployment-verified',active:true,executionEnabled:true,blockers:[],
            verification:{scope:'reviewed-devnet-program-and-fresh-worker',programId:config.programId,
              approvedHash:env.FUNDED_V3_PROGRAM_DATA_SHA256,build:env.FUNDED_BUILD_ID,configRevision:config.agency.configRevision},
            ...agencyPublicSummary({state,programId:config.programId,approvedHash:env.FUNDED_V3_PROGRAM_DATA_SHA256,build:env.FUNDED_BUILD_ID})});
          return true;
        }
      }catch{ /* Missing deployment/custody evidence retains explicit unavailable financials below. */ }
    }
    // Do not expose unverified DB balances as spendable funds. There are no
    // agency-enabled on-chain launches until contract support is verified.
    respond(res, 200, { ...marketingAgencyCapabilities(),
      funding: { status: 'unavailable', collectedLamports: null, spentLamports: null },
      launches: [], history: [], historyStatus: 'unavailable' });
    return true;
  };
}
