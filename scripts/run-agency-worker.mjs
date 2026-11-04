import {DEFAULT_AGENCY_RULES} from '../config/agency-rules.js';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import bs58 from 'bs58';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {createPostgresStore} from '../server/postgres-store.mjs';
import {createXPostStore} from '../server/x-post-store.mjs';
import {createXPublisher} from '../server/x-post-client.mjs';
import {runXPostWorker} from '../server/x-post-worker.mjs';
import {xWorkerConfig} from './run-x-post-worker.mjs';
import {readAgencyDeployment,agencyWorkerHealth,agencyBuybackWorkerHealth} from '../server/agency-deployment.mjs';
import {readAgencyMintContext} from '../server/agency-mint-context.mjs';
import {runAgencyPromotion,createAgencyPublisher} from '../server/agency-promotion-executor.mjs';
import {runAgencyMilestone} from '../server/agency-buyback-executor.mjs';
import {xPostingRetryWait} from '../config/x-posting.js';
import {createAgencyDiagnostics,agencyErrorDiagnostics} from '../server/agency-worker-diagnostics.mjs';

export function agencyWorkerConfig(env,args=[]){
  if(args.includes('--status'))throw new Error('Use --once or --loop; omit --execute for a read-only execution preview.');
  const x=xWorkerConfig(env,args),programId=new PublicKey(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID).toBase58();
  if(x.handle!=='fundedvip'||!/^[0-9]{1,30}$/.test(String(env.X_POST_ACCOUNT_ID)))throw new Error('Pin the fundedvip X account ID for agency execution.');
  if(!/^[a-f0-9]{64}$/.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256)))throw new Error('An exact agency ProgramData hash is required.');
  if(x.execute&&env.FUNDED_V3_AGENCY_ENABLED!=='true')throw new Error('Agency execution requires explicit activation and --execute.');
  if(!/^[a-f0-9]{40}$/.test(String(env.FUNDED_BUILD_ID)))throw new Error('The exact committed agency build revision is required.');
  // Agency custody/readiness heartbeats must stay fresher than 90 seconds;
  // publication pacing is independently enforced by the shared outbox.
  return{...x,intervalMs:60000,programId,approvedHash:env.FUNDED_V3_PROGRAM_DATA_SHA256,build:env.FUNDED_BUILD_ID,
    lookupAddress:new PublicKey(env.FUNDED_V3_BUYBACK_LOOKUP_TABLE).toBase58()};
}
export function agencyWorkerBlocked(error,{config,authority,now=Date.now()}){
  const failures={
    401:['x-auth-rejected','The dedicated X publishing credentials were rejected. Refresh the matching credential set and restart the worker.'],
    402:['x-credits-unavailable','X publishing credits are unavailable.'],
    403:['x-permission-denied','X denied publishing-account or app access.'],
    429:['x-rate-limited','X rate limits prevent current publishing verification.'],
  };
  const diagnostics=agencyErrorDiagnostics(error),phase=diagnostics?.failure?.phase;
  const known=(!phase||phase==='publisher-account')&&!config.buybacksOnly
    &&Number.isInteger(error?.status)&&Object.hasOwn(failures,error.status)?failures[error.status]:null;
  const [reasonCode,reason]=known||[diagnostics?.failure?.reasonCode||'verification-unavailable',
    'Reviewed deployment, signing, funding, X access or finalized execution evidence is unavailable.'];
  return{status:'blocked',reasonCode,reason:config.buybacksOnly?'Reviewed Devnet deployment, protected custody, or execution proof is unavailable.':reason,
    ...(diagnostics?{diagnostics}:{}),build:config.build,programId:config.programId,
    approvedHash:config.approvedHash,authority:authority.publicKey.toBase58(),checkedAt:new Date(now).toISOString()};
}
export async function runAgencyCycle(input){
  const diagnostics=createAgencyDiagnostics({monotonicNow:input.monotonicNow,onStep:input.onDiagnosticStep});
  try{return{...await executeAgencyCycle({...input,diagnostics}),diagnostics:diagnostics.snapshot()};}
  catch(error){diagnostics.attach(error);throw error;}
}
async function executeAgencyCycle({config,store,outbox,connection,authority,publisher,diagnostics,shouldStop=()=>false,
  readDeployment=readAgencyDeployment,readContext=readAgencyMintContext,promotion=runAgencyPromotion,milestone=runAgencyMilestone,
  dispatch=runXPostWorker,now=()=>Date.now()}){
  const step=(phase,action,context={})=>diagnostics.step(phase,context,action);
  const deployment=await step('deployment',()=>readDeployment({connection,programId:config.programId,approvedHash:config.approvedHash,authority:authority.publicKey}));
  await step('lookup-table',async()=>{
  const lookup=(await connection.getAddressLookupTable(new PublicKey(config.lookupAddress),{commitment:'finalized'})).value;
  if(!lookup?.key.equals(new PublicKey(config.lookupAddress))||lookup.state.deactivationSlot!==0xffffffffffffffffn)
    throw Object.assign(new Error('Agency buyback lookup table is not active.'),{code:'AGENCY_LOOKUP_INACTIVE'});
  });
  const buybacksOnly=config.buybacksOnly===true;
  const account=config.execute&&!buybacksOnly?await step('publisher-account',()=>publisher.verifyAccount()):null;
  const state=await step('state-read',()=>store.read()),mints=Object.values(state.launches||{}).filter(row=>row.cluster==='devnet'
    &&row.pumpFeeRoute?.programId===config.programId&&row.pumpFeeRoute?.protocolSplit?.agencyPercent!==undefined).map(row=>row.mint).sort();
  const heartbeatKey=buybacksOnly?'agencyBuybackWorker':'agencyWorker';
  const mintLimit=config.mintLimit??5;
  if(!Number.isInteger(mintLimit)||mintLimit<1||mintLimit>5)throw new Error('Agency cycle mint limit must be between one and five.');
  const previous=state.adminSettings?.[heartbeatKey]?.lastMint||'',ordered=[...mints.filter(mint=>mint>previous),...mints.filter(mint=>mint<=previous)].slice(0,mintLimit);
  const base={store,outbox,connection,authority,publisher,programId:config.programId,approvedHash:config.approvedHash,
    lookupAddress:config.lookupAddress,readContext,diagnostics,publicOrigin:config.origin},events=[];
  const health=buybacksOnly?agencyBuybackWorkerHealth:agencyWorkerHealth;
  const identity={programId:config.programId,approvedHash:config.approvedHash,
    authority:authority.publicKey.toBase58(),revision:deployment.revision,build:config.build};
  const hadVerifiedReadiness=health(state,{...identity,now:now()});
  // A full cycle can take longer than the 90-second readiness window. Keep a
  // previously ready worker fresh only after this cycle has reverified its
  // deployment, lookup and (for publishing) X account. Every completed mint
  // step supplies another progress check; a stalled step still expires.
  const refreshProgress=async()=>{
    if(!config.execute||shouldStop()||!hadVerifiedReadiness)return;
    await step('heartbeat',()=>store.update(current=>{
      if(!health(current,{...identity,now:now()}))return;
      const row=current.adminSettings[heartbeatKey];
      if(events.some(event=>event.status==='execution-unavailable'))row.status='degraded';
      row.checkedAt=new Date(now()).toISOString();
      row.diagnostics=diagnostics.snapshot();
    }));
  };
  await refreshProgress();
  let readinessStatus=null;
  for(const mint of ordered){
    if(shouldStop())break;
    if(!config.execute){
      const context=await step('custody',()=>readContext({...base,mint,state,authority:authority.publicKey}),{mint});
      events.push({mint,status:'dry-run',selectedMask:context.policy.selectedMask,remainingLamports:context.remainingLamports});continue;
    }
    if(!buybacksOnly)events.push(await step('promotion',()=>promotion({...base,mint}),{mint}));
    for(const agent of [1,2]){
      if(shouldStop())break;
      try{events.push({...await step('milestone',()=>milestone({...base,mint,agent}),{mint,agent}),mint,agent});}
      catch(error){events.push({mint,agent,status:error?.code==='AGENCY_MARKET_NOT_MIGRATED'?'awaiting-migration':'execution-unavailable',
        diagnostic:diagnostics.failure(error)});}
      await refreshProgress();
    }
  }
  if(config.execute&&!shouldStop()){
    if(!buybacksOnly){
    const publish=createAgencyPublisher({...base});
    const sent=await step('x-dispatch',()=>dispatch({store:outbox,publish,enabled:true,dryRun:false,maxPosts:config.maxPosts,kinds:['agency_promotion']}));
    events.push({status:'x-dispatch',...sent});
    // Publication and billing are separate. Each billing re-fetches exact X
    // author/text/time and independently verifies finalized chain receipts.
    for(const mint of ordered){if(shouldStop())break;events.push(await step('promotion-billing',()=>promotion({...base,mint}),{mint}));}
    }
    const budgets={};
    for(const mint of ordered){
      if(shouldStop())break;
      const currentState=await step('state-read',()=>store.read(),{mint});
      const context=await step('custody',()=>readContext({...base,mint,state:currentState,authority:authority.publicKey}),{mint});
      // Each finalized custody read is verified progress, just like a milestone
      // check. Keep the existing readiness window fresh during this serial sweep.
      await refreshProgress();
      budgets[mint]={mint,programId:config.programId,approvedHash:config.approvedHash,build:config.build,
        checkedAt:new Date(now()).toISOString(),slot:context.slot,policyFingerprint:context.policyFingerprint,
        paidLamports:String(context.policy.paidLamports[7]),spentLamports:String(context.policy.withdrawnLamports[7]),
        selectedMask:context.policy.selectedMask,completedMask:context.policy.completedMask,agentRemaining:context.agentRemaining, rules:context.policy.rules || DEFAULT_AGENCY_RULES,
        milestoneChecks:events.filter(event=>event.mint===mint && [1,2].includes(event.agent)).map(event=>({
          agent:event.agent,status:event.status,...(event.observation?{observation:event.observation}:{})
        })),
        scope:'finalized-pump-sources-and-agency-vault',verified:true};
    }
    if(!shouldStop()){
    const status=events.some(row=>row.status==='execution-unavailable')?'degraded':'ready';
    await step('heartbeat',()=>store.update(current=>{
      current.adminSettings||={};current.adminSettings[heartbeatKey]={status,version:buybacksOnly?'agency-buyback-executor-v1':'agency-executor-v1',cluster:'devnet',
        programId:config.programId,approvedHash:config.approvedHash,authority:authority.publicKey.toBase58(),configRevision:deployment.revision,
        build:config.build,...(buybacksOnly?{}:{xAccountId:account.id}),capabilities:buybacksOnly?['buyback-100k','buyback-300k']:['x-promotion','buyback-100k','buyback-300k'],
        checkedAt:new Date(now()).toISOString(),lastMint:ordered.at(-1)||previous,diagnostics:diagnostics.snapshot(),
        pendingExecutions:events.filter(row=>!['finalized','not-payable','below-threshold','cadence-wait','x-dispatch'].includes(row.status)).length};
      current.adminSettings.agencyBudgets={...(current.adminSettings.agencyBudgets||{}),...budgets};
    }));
    readinessStatus=status;
    }
  }
  return{mode:config.execute?'execute':'dry-run',cluster:'devnet',build:config.build,readinessStatus,events};
}
async function main(args){
  const env={...process.env};
  for(const name of ['DATABASE_URL','SOLANA_RPC_URL','FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY','X_POST_API_KEY','X_POST_API_SECRET','X_POST_ACCESS_TOKEN','X_POST_ACCESS_TOKEN_SECRET'])
    if(!env[name]&&env[`${name}_FILE`])env[name]=(await readFile(env[`${name}_FILE`],'utf8')).trim();
  const config=agencyWorkerConfig(env,args),authority=env.FUNDED_V3_ROUTER_AUTHORITY_KEYPAIR_PATH
    ?Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(env.FUNDED_V3_ROUTER_AUTHORITY_KEYPAIR_PATH,'utf8'))))
    :Keypair.fromSecretKey(bs58.decode(env.FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY||''));
  const store=createPostgresStore(env.DATABASE_URL),outbox=createXPostStore({databaseUrl:env.DATABASE_URL,accountId:config.handle,
    minIntervalMs:config.minIntervalMs,maxHourlyPosts:config.maxHourlyPosts,maxDailyPosts:config.maxDailyPosts});
  const connection=new Connection(env.SOLANA_RPC_URL,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(url,options)=>fetch(url,{...options,signal:options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})});
  const publisher=config.execute?createXPublisher({expectedHandle:config.handle,expectedAccountId:env.X_POST_ACCOUNT_ID,
    ...(env.X_POST_ACCESS_TOKEN_SECRET?{oauth1:{apiKey:env.X_POST_API_KEY,apiSecret:env.X_POST_API_SECRET,accessToken:env.X_POST_ACCESS_TOKEN,
      accessTokenSecret:env.X_POST_ACCESS_TOKEN_SECRET}}:{accessToken:env.X_POST_ACCESS_TOKEN})}):null;
  let stopped=false,wake;const stop=()=>{stopped=true;wake?.();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{
    await outbox.init();
    if(config.execute&&(await outbox.safetyStatus()).paused)throw new Error('The durable X account pause is active. No provider request was made.');
    do{
      let waitMs=config.intervalMs;
      try{console.log(JSON.stringify(await runAgencyCycle({config,store,outbox,connection,authority,publisher,shouldStop:()=>stopped,
        onDiagnosticStep:row=>console.log(JSON.stringify({event:'agency-worker-step',...row}))})));}
      catch(error){
        waitMs=xPostingRetryWait(error,waitMs);
        const blocked=agencyWorkerBlocked(error,{config,authority});
        console.error(JSON.stringify({event:'agency-worker-blocked',...blocked}));
        if(config.execute)await store.update(state=>{state.adminSettings||={};state.adminSettings.agencyWorker=blocked;});
        if(config.mode!=='loop')process.exitCode=1;
      }
      if(config.mode!=='loop'||stopped)break;
      await new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},waitMs);wake=()=>{clearTimeout(timer);wake=null;resolve();};});
    }while(!stopped);
  }finally{await store.close();await outbox.close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(()=>{
  console.error('Agency worker configuration or startup failed. No activation is established.');process.exitCode=1;
});
