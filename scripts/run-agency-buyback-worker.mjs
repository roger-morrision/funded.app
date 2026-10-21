import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {createPostgresStore} from '../server/postgres-store.mjs';
import {runAgencyCycle} from './run-agency-worker.mjs';
import {runAgencyBuybackLoop} from '../server/agency-buyback-loop.mjs';

// This entry point has no publisher, outbox or X credential configuration.
export function agencyBuybackConfig(env,args=[]){
  if(args.some(arg=>!['--once','--loop','--execute'].includes(arg))||args.filter(arg=>['--once','--loop'].includes(arg)).length>1)
    throw new Error('Use --once or --loop; add --execute only for authorized Devnet buybacks.');
  const execute=args.includes('--execute');
  if(env.SOLANA_CLUSTER!=='devnet'||!/^postgres(?:ql)?:$/.test(new URL(env.DATABASE_URL).protocol))
    throw new Error('Agency buybacks require Devnet and durable PostgreSQL storage.');
  if(execute&&(env.FUNDED_V3_AGENCY_ENABLED!=='true'||env.FUNDED_V3_AGENCY_BUYBACK_ENABLED!=='true'))
    throw new Error('Agency buyback execution needs its explicit activation gates.');
  const programId=new PublicKey(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID).toBase58();
  const lookupAddress=new PublicKey(env.FUNDED_V3_BUYBACK_LOOKUP_TABLE).toBase58();
  if(!/^[a-f0-9]{64}$/.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256))||!/^[a-f0-9]{40}$/.test(String(env.FUNDED_BUILD_ID)))
    throw new Error('An exact reviewed agency ProgramData hash and committed build are required.');
  return{execute,mode:args.includes('--loop')?'loop':'once',buybacksOnly:true,cluster:'devnet',intervalMs:60000,
    programId,lookupAddress,approvedHash:env.FUNDED_V3_PROGRAM_DATA_SHA256,build:env.FUNDED_BUILD_ID};
}
async function main(args){
  const env={...process.env};
  for(const name of ['DATABASE_URL','SOLANA_RPC_URL','FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY'])
    if(!env[name]&&env[name+'_FILE'])env[name]=(await readFile(env[name+'_FILE'],'utf8')).trim();
  const config=agencyBuybackConfig(env,args),authority=Keypair.fromSecretKey(bs58.decode(env.FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY||''));
  const store=createPostgresStore(env.DATABASE_URL),connection=new Connection(env.SOLANA_RPC_URL,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(url,options)=>fetch(url,{...options,signal:options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})});
  let stopped=false,wake;const stop=()=>{stopped=true;wake?.();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{
    await runAgencyBuybackLoop({config,shouldStop:()=>stopped,
      runCycle:async()=>{const result=await runAgencyCycle({config,store,connection,authority,shouldStop:()=>stopped});console.log(JSON.stringify(result));return result;},
      onBlocked:async()=>{
        if(config.execute)await store.update(state=>{state.adminSettings||={};state.adminSettings.agencyBuybackWorker={status:'blocked',
          reason:'Reviewed Devnet deployment, protected custody, or execution proof is unavailable.',build:config.build,
          programId:config.programId,approvedHash:config.approvedHash,checkedAt:new Date().toISOString()};});
        console.error(JSON.stringify({event:'agency-buyback-worker-blocked',build:config.build}));
        if(config.mode!=='loop')process.exitCode=1;
      },
      wait:waitMs=>new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},waitMs);wake=()=>{clearTimeout(timer);wake=null;resolve();};}),
    });
  }finally{await store.close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(()=>{
  console.error('Agency buyback worker startup failed. No readiness is established.');process.exitCode=1;
});
