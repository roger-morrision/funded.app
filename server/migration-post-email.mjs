import {randomUUID} from 'node:crypto';
import {launchPostEmailEnabled,paidLaunchPromotion,launchPostEmailDraft} from './launch-post-email.mjs';
import {discoverMigrationEmailProof} from './promotion-migration-proof.mjs';

// Only watches explicitly queued paid launches. No historical email backfill.
export function createMigrationPostEmailWatcher({store,connection,cluster,env=process.env,
  discover=discoverMigrationEmailProof,now=Date.now,logger=console}) {
  const enabled=cluster==='devnet'&&launchPostEmailEnabled(env);
  let running=false,timer;
  async function tick(){
    if(!enabled||running)return {status:enabled?'busy':'disabled'};
    running=true;let claimed;
    try{
      claimed=await store.update(state=>{
        const row=Object.values(state.launchPostEmails||{}).filter(r=>r.cluster===cluster&&r.event==='migration'
          &&r.status==='awaiting-migration'&&(r.nextCheckAt||0)<=now()&&(!r.discoveryLease||r.discoveryLeaseUntil<=now()))
          .sort((a,b)=>(a.nextCheckAt||0)-(b.nextCheckAt||0))[0];
        if(!row)return null;
        Object.assign(row,{discoveryLease:randomUUID(),discoveryLeaseUntil:now()+300000});return structuredClone(row);
      });
      if(!claimed)return {status:'idle'};
      const launch=(await store.read()).launches?.[claimed.mint];
      if(!paidLaunchPromotion(launch)||launch.signature!==claimed.signature||launch.cluster!==cluster)throw Error('Paid launch identity changed.');
      const result=await discover({connection,cluster,mint:claimed.mint,launchSlot:launch.slot,before:claimed.before});
      const draft=result.proof?launchPostEmailDraft(launch,{cluster,origin:claimed.origin,event:'migration',migration:result.proof}):null;
      await store.update(state=>{
        const row=state.launchPostEmails?.[claimed.id];
        if(row?.discoveryLease!==claimed.discoveryLease||row.status!=='awaiting-migration')throw Error('Migration watch lease changed.');
        if(draft)Object.assign(row,draft,{status:'pending',nextAttemptAt:now(),attempts:0});
        else Object.assign(row,{before:result.before||null,nextCheckAt:now()+60000});
        Object.assign(row,{discoveryLease:null,discoveryLeaseUntil:0,reason:null});
      });
      return {status:draft?'queued':'waiting'};
    }catch{
      if(claimed)await store.update(state=>{
        const row=state.launchPostEmails?.[claimed.id];
        if(row?.discoveryLease===claimed.discoveryLease)Object.assign(row,{discoveryLease:null,discoveryLeaseUntil:0,
          nextCheckAt:now()+300000,reason:'migration-verification-unavailable'});
      }).catch(()=>{});
      logger.error(JSON.stringify({event:'migration_post_email_unavailable'}));return {status:'unavailable'};
    }finally{running=false;}
  }
  return {enabled,tick,start(){if(enabled&&!timer){void tick();timer=setInterval(()=>void tick(),60000);timer.unref();}},
    stop(){clearInterval(timer);timer=null;}};
}
