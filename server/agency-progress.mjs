import {deriveAgencyPolicyV3,decodeAgencyPolicyV3} from '../agency-mint-router-v3.js';
import {protocolGrossUnits} from '../mint-router-v3.js';
import {assertRpcNetwork} from '../solana-network.js';

// Display-only observations. These never authorize an agent or fund a trade.
export function createAgencyProgressReader({connection,readMarketCaps,readSolUsd,env=process.env,now=Date.now,decode=decodeAgencyPolicyV3}){
  let pending=null,cached=null,expires=0;
  return async(state)=>{
    const launches=Object.values(state.launches||{}).filter(row=>row.onchainVerified===true&&row.cluster==='devnet'&&!row.archivedAt
      &&row.pumpFeeRoute?.programId===env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID&&Array.isArray(row.marketingAgency?.selectedAgents));
    const key=launches.map(row=>row.mint).sort().join(',');
    if(cached?.key===key&&expires>now())return cached.rows;
    if(!pending){pending=(async()=>{
      await assertRpcNetwork(connection,'devnet');
      const result=[];
      const quote=await readSolUsd();const quoteAge=now()-Date.parse(quote?.fetchedAt);
      const rate=quote&&quoteAge>=0&&quoteAge<120000&&Number.isFinite(quote.priceUsd)&&quote.priceUsd>0?quote.priceUsd:null;
      for(let offset=0;offset<launches.length;offset+=40){
        const batch=launches.slice(offset,offset+40);
        const [snapshot,markets]=await Promise.all([
          connection.getMultipleAccountsInfoAndContext(batch.map(row=>deriveAgencyPolicyV3(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,row.mint).address),{commitment:'finalized'}),
          readMarketCaps(batch.map(row=>row.mint),{waitMs:2000})]);
        if(!Number.isSafeInteger(snapshot.context?.slot)||snapshot.context.slot<1)throw Error('Finalized policy unavailable');
        for(const [index,launch]of batch.entries()){
          try{
            const policy=decode(snapshot.value[index],{programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,mint:launch.mint,creator:launch.creatorWallet,
              initialAuthority:launch.pumpFeeRoute.initialAuthority,protocolUnits:protocolGrossUnits(launch.pumpFeeRoute.protocolSplit),
              shares:launch.feeDistribution?.creatorDirected?.shares,selectedAgents:launch.marketingAgency.selectedAgents});
            const market=markets[launch.mint],age=now()-Date.parse(market?.observedAt),cap=market?.marketCapSol;
            result.push({mint:launch.mint,targets:policy.rules?.marketCapUsd||null,completedMask:policy.completedMask,
              marketCapUsd:rate&&age>=0&&age<120000&&Number.isFinite(cap)&&cap>0?cap*rate:null,
              observedAt:market?.observedAt||null,checkedAt:new Date(now()).toISOString(),policySlot:snapshot.context.slot});
          }catch{result.push({mint:launch.mint,targets:null,marketCapUsd:null});}
        }
      }
      cached={key,rows:result};expires=now()+30000;return result;
    })().catch(()=>[]).finally(()=>{pending=null;});}
    let timer;try{return await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve([]),6500);})]);}finally{clearTimeout(timer);}
  };
}
