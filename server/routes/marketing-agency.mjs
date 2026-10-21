import { marketingAgencyCapabilities } from '../marketing-agency-policy.mjs';
import {agencyPublicSummary} from '../agency-public-summary.mjs';

export function createMarketingAgencyRoutes({ respond,store,readLaunchConfig,env=process.env }) {
  return async function handleMarketingAgency(req, res, url) {
    if (url.pathname !== '/api/marketing-agency') return false;
    if (req.method !== 'GET') { respond(res, 405, { error: 'Agency execution is not activated.' }); return true; }
    let state={},config=null;
    try{if(store)state=await store.read();}catch{}
    const published=state.adminSettings?.protocolFeePolicy;
    const feePolicy={status:Number.isFinite(published?.split?.agencyPercent)?'published':'unavailable',revision:published?.revision??null};
    const xPaused=env.X_POST_ENABLED!=='true'||env.X_POST_ACCOUNT_STATUS!=='active';
    const agents=enabled=>marketingAgencyCapabilities().policy.agents.map((agent,index)=>{
      const available=enabled&&(index===0?!xPaused:env.FUNDED_V3_AGENCY_BUYBACK_ENABLED==='true'||!xPaused);
      return{id:agent.id,enabled:available,status:index===0&&xPaused?'paused':available?'available':'not-activated',
        reason:index===0&&xPaused?'X publishing is paused pending account reinstatement. Its budget remains reserved.':null};
    });
    if(env.FUNDED_V3_AGENCY_ENABLED==='true'&&store&&readLaunchConfig){
      try{
        config=await readLaunchConfig();
        if(config.ready&&config.agency&&Number.isFinite(config.protocolSplit.agencyPercent)){
          state=await store.read();
          respond(res,200,{...marketingAgencyCapabilities({split:config.protocolSplit,rules:config.agency.rules}),status:'deployment-verified',active:true,executionEnabled:true,blockers:[],
            agents:agents(true),feePolicy,publishingPaused:xPaused,
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
      agents:agents(false),feePolicy,publishingPaused:xPaused,
      ...(config?.reasons?.length?{blockers:config.reasons}:{}),
      funding: { status: 'unavailable', collectedLamports: null, spentLamports: null },
      launches: [], history: [], historyStatus: 'unavailable' });
    return true;
  };
}
