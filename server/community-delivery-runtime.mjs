import {SharedRpcConnection} from './rpc-connection.mjs';
import {communityProgramForLaunch} from './community-program-config.mjs';
import {createCommunityClaimService} from './community-claim-service.mjs';
import {createCommunityAutoDelivery} from './community-auto-delivery.mjs';
import {findRecentCommunityMigration} from './community-migration-discovery.mjs';
import {rpcQuotaExhausted,rpcWorkerWaitMs} from '../rpc-retry.js';

// Runs inside the primary API process. All sends have durable journals and
// on-chain payment PDAs, so process restarts and manual recovery cannot double pay.
export function createCommunityDeliveryRuntime({store,automaticRewardStore,solanaCluster,solanaRpcUrl,
  fundedTokenMint,v3AuthorityKeypair,env=process.env,logger=console,
  connection=new SharedRpcConnection(solanaRpcUrl,'finalized'),serviceFactory=createCommunityClaimService,
  deliveryFactory=createCommunityAutoDelivery,findMigration=findRecentCommunityMigration,
  scheduleTimeout=setTimeout,now=Date.now}) {
  const enabled=solanaCluster==='devnet'&&env.FUNDED_COMMUNITY_AUTO_DELIVERY_ENABLED==='true';
  const running={prepare:false,deliver:false},timers={},retryAfter={prepare:20_000,deliver:20_000};
  let stopped=false;
  async function tick({preparationOnly=false}={}){
    const mode=preparationOnly?'prepare':'deliver';
    if(!enabled||running[mode]||stopped)return;
    running[mode]=true;retryAfter[mode]=20_000;
    let submitted=0,paid=0,prepared=0,waiting=0,examined=0;
    const failures=[];
    try{
      const app=await store.read(),ledger=await automaticRewardStore.read();
      const configured=JSON.parse(env.FUNDED_COMMUNITY_RESERVE_RECEIPTS_JSON||'{}');
      const launches=Object.values(app.launches||{}).filter(launch=>launch.onchainVerified&&launch.cluster==='devnet'
        &&launch.pumpFeeRoute?.scope==='per-mint-v3'&&Number(launch.communityAirdrop?.reservedTokens)>0);
      for(const launch of launches){
        if(stopped)break;
        try{
          const config=communityProgramForLaunch(launch,env,v3AuthorityKeypair);
          const service=serviceFactory({connection,store:automaticRewardStore,programId:config.programId,
            authority:config.authority,eligibilityMint:fundedTokenMint,cluster:solanaCluster,
            expectedCommunityProgramDataSha256:config.expectedHash});
          let record=ledger.communityDrops?.[launch.mint];
          if(record&&record.snapshotBasis!=='pump-migration'){waiting++;continue;}
          if(record&&preparationOnly)continue;
          if(!record){
            if(!preparationOnly){waiting++;continue;}
            const fundingSignature=app.communityReserveReceipts?.[launch.mint]?.signature||configured[launch.mint];
            if(!fundingSignature){waiting++;continue;}
            const migrationSignature=await findMigration(connection,launch.mint);
            if(!migrationSignature){waiting++;continue;}
            record=await service.prepare({mint:launch.mint,creator:launch.creatorWallet,
              reservedTokens:Number(launch.communityAirdrop.reservedTokens),fundingSignature,migrationSignature});
            prepared++;
            continue;
          }
          const delivery=deliveryFactory({connection,store,service,authority:v3AuthorityKeypair(),
            programId:config.programId,approvedHash:config.expectedHash});
          if(!record.openingSignature){
            const result=await delivery.open(record);
            if(!['opened','finalized'].includes(result.status)){waiting++;continue;}
            record=await service.prepared(launch.mint);
          }
          // Rotate a bounded page so delayed recipients cannot starve later wallets.
          const count=record.manifest.leaves.length;
          const cursor=Number(ledger.communityDeliveryCursors?.[launch.mint]||0)%Math.max(1,count);
          let checked=0;
          for(;checked<Math.min(count,8);checked++){
            if(stopped)break;
            const leaf=record.manifest.leaves[(cursor+checked)%count];examined++;
            try{
              const result=await delivery.pay(record,leaf);
              if(result.status==='finalized'||result.status==='already-paid')paid++;
              else if(result.status==='verification-pending')submitted++;
              else if(['expired','ineligible','unavailable'].includes(result.status))waiting++;
              else failures.push({mint:launch.mint,recipient:leaf.recipient,reason:result.status});
            }catch(error){
              if(rpcQuotaExhausted(error))throw error;
              failures.push({mint:launch.mint,recipient:leaf.recipient,reason:safeReason(error)});
            }
          }
          await automaticRewardStore.transaction(state=>{(state.communityDeliveryCursors||={})[launch.mint]=(cursor+checked)%Math.max(1,count);});
        }catch(error){
          if(rpcQuotaExhausted(error))throw error;
          failures.push({mint:launch.mint,reason:safeReason(error)});
        }
      }
    }catch(error){
      if(rpcQuotaExhausted(error))retryAfter[mode]=rpcWorkerWaitMs(error,60_000);
      failures.push({reason:safeReason(error)});
    }finally{
      const status={status:failures.length?'degraded':submitted?'distributing':'ready',cluster:'devnet',
        checkedAt:new Date(now()).toISOString(),prepared,examined,paid,submitted,waiting,failures,retryAfterMs:retryAfter[mode]};
      try{await automaticRewardStore.transaction(state=>{state[preparationOnly?'communityPreparationStatus':'communityDeliveryStatus']=status;});}
      finally{running[mode]=false;}
      if(failures.length)logger.error(JSON.stringify({event:'community_delivery_degraded',mode,...status}));
    }
  }
  function safeReason(error){return String(error?.message||error).replace(/https?:\/\/[^\s"']+/g,'[redacted-url]').slice(0,180);}
  // Capture migration holdings independently of slow recipient payments.
  // A large distribution must not delay the next coin's exact-slot snapshot.
  function schedule(mode){timers[mode]=scheduleTimeout(async()=>{try{await tick({preparationOnly:mode==='prepare'});}catch(error){logger.error(safeReason(error));}if(!stopped)schedule(mode);},retryAfter[mode]);timers[mode].unref?.();}
  return {enabled,tick,start(){if(enabled&&!timers.prepare){schedule('prepare');schedule('deliver');}},stop(){stopped=true;for(const timer of Object.values(timers))clearTimeout(timer);}};
}
