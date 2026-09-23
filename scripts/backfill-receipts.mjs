import { Connection,clusterApiUrl } from '@solana/web3.js';
import { setTimeout as delay } from 'node:timers/promises';
import { createStore } from '../server/store.mjs';
import { createReceiptEvidenceReader } from '../server/receipt-service.mjs';
import { runReceiptBackfill } from '../server/receipt-backfill.mjs';

if(process.env.FUNDED_RECEIPT_BACKFILL_ENABLED!=='true')throw new Error('Backfill is disabled. Configure an approved Devnet store/RPC and explicitly enable FUNDED_RECEIPT_BACKFILL_ENABLED.');
const cluster=process.env.VITE_SOLANA_CLUSTER||process.env.SOLANA_CLUSTER||'devnet';
if(cluster!=='devnet')throw new Error('Only Devnet receipt backfill is supported.');
if(!process.env.DATABASE_URL&&!process.env.FUNDED_STORE_PATH)throw new Error('Choose an explicit backfill store. No default app data path is used.');
const store=createStore(process.env.FUNDED_STORE_PATH,process.env.FUNDED_STORE_PATH?'':process.env.DATABASE_URL);
const abort=new AbortController();
process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
const rpc=process.env.SOLANA_RPC_URL||clusterApiUrl('devnet');
const timedFetch=(url,options={})=>fetch(url,{...options,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000),...(options.signal?[options.signal]:[])])});
const config={commitment:'finalized',disableRetryOnRateLimit:true,fetch:timedFetch};
const readEvidence=createReceiptEvidenceReader({store,cluster,commitment:'finalized',maxActive:1,
  connectionFactory:()=>new Connection(rpc,config),officialGenesis:()=>new Connection(clusterApiUrl('devnet'),config).getGenesisHash()});
try {
  do {
    const result=await runReceiptBackfill({store,readEvidence,cluster,maxPages:Number(process.env.FUNDED_BACKFILL_PAGES||5),signal:abort.signal});
    console.log(JSON.stringify(result));
    if(!process.argv.includes('--watch')){if(result.status==='blocked')process.exitCode=2;break;}
    await delay(60000,undefined,{signal:abort.signal});
  }while(!abort.signal.aborted);
}catch(error){if(!abort.signal.aborted){console.error('Receipt worker failed. Inspect its private status and dependencies; raw dependency errors are not logged.');process.exitCode=1;}}finally{await store.close?.();}
