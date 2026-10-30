import { financialReceipt, financialOperations } from '../product-insights.mjs';
import { Connection, PublicKey } from '@solana/web3.js';
import { verifyTradeWake } from './trade-financial-wakeup.mjs';
import { publicCreatorUpdates } from '../creator-announcements.mjs';
export function createProductInsightsRoutes({store,automaticRewardStore,solanaCluster,clientKey,respond,solanaRpcUrl,
  connectionFactory=url=>new Connection(url,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:(target,options)=>fetch(target,{...options,signal:AbortSignal.timeout(12000)})}),verifyTrade=verifyTradeWake}) {
  let cached = null, expires = 0;
  return async (req,res,url) => {
    if (req.method !== 'GET' || !(url.pathname === '/api/financial/activity' || url.pathname === '/api/financial/operations' || url.pathname.startsWith('/api/financial/receipts/'))) return false;
    const json = (status,value) => {respond(res,status,value);return true;};
    if (solanaCluster !== 'devnet') return json(503,{error:'Financial insights are available on Devnet only.'});
    if (!await store.chargeRpcRate(`financial-insights:${clientKey(req)}`,1,20,Math.floor(Date.now()/60000)*60000)) return json(429,{error:'Please wait before refreshing financial insights.'});
    const selected = url.pathname.match(/^\/api\/financial\/receipts\/([1-9A-HJ-NP-Za-km-z]{64,88})$/)?.[1];
    if (url.pathname.startsWith('/api/financial/receipts/') && !selected) return json(400,{error:'A valid transaction signature is required.'});
    const [state,rewards] = await Promise.all([store.read(),automaticRewardStore.read().catch(()=>null)]);
    if (url.pathname === '/api/financial/activity') {
      const statements=Object.values(state.creatorProfiles || {}).filter(row=>row.identityVerified===true&&row.listed===true&&!row.optedOut&&/^\d{1,24}$/.test(String(row.id))).flatMap(profile=>
        publicCreatorUpdates(profile.updates).map(row=>({id:row.id,creatorId:profile.id,text:row.text,at:row.publishAt || row.createdAt,
          creatorWallet:Object.values(state.launches || {}).find(launch=>String(launch.xUserId)===String(profile.id)&&launch.cluster===solanaCluster&&launch.onchainVerified)?.creatorWallet || null})))
        .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,50);
      return json(200,{cluster:solanaCluster,statements,evidence:'verified-account-statements-not-financial-proof'});
    }
    if (selected) {
      const receipt = financialReceipt(state,rewards,solanaCluster,selected);
      if (receipt) return json(200,receipt);
      if (url.searchParams.has('wallet') && url.searchParams.has('mint')) {
        let mint,wallet;try {mint=new PublicKey(url.searchParams.get('mint')).toBase58();wallet=new PublicKey(url.searchParams.get('wallet')).toBase58();}
        catch{return json(400,{error:'A valid trade wallet and mint are required.'});}
        if (!state.launches?.[mint]?.onchainVerified || state.launches[mint].cluster !== solanaCluster) return json(404,{error:'Verified launch context is unavailable.'});
        try {
          const trade = await verifyTrade({connection:connectionFactory(solanaRpcUrl),mint,wallet,signature:selected,maxAgeMs:Infinity});
          return json(200,{cluster:solanaCluster,signature:selected,evidence:'finalized-rpc-trade',currentRpcRecheck:true,
            events:[{mint,kind:`trade-${trade.side}`,label:`${trade.side} trade verified`,signature:selected,amountLamports:trade.solLamports,at:trade.blockTime ? new Date(trade.blockTime*1000).toISOString() : null}],
            trade:{wallet,mint,side:trade.side,tokenAmountRaw:trade.tokenAmountRaw,decimals:trade.decimals,solLamports:trade.solLamports,networkFeeLamports:trade.networkFeeLamports??null,feePayer:trade.feePayer||null},
            recipients:[],burns:[],sourceSignatures:[],coverage:'Genuine Pump/PumpSwap trade event and directional token balance change verified at finalized commitment. No profit claim.'});
        } catch {return json(503,{error:'Trade receipt verification is unavailable. This does not establish failure; inspect the recorded signature.'});}
      }
      return json(404,{error:'No matching recorded V3 receipt. This does not establish that the transaction failed.'});
    }
    if (!cached || expires < Date.now()) {cached = financialOperations(state,rewards,solanaCluster);expires = Date.now()+15000;}
    return json(200,cached);
  };
}
