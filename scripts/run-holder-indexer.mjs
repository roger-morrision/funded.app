import fs from 'node:fs';
import {Connection} from '@solana/web3.js';
import {createAutomaticRewardStore,drainAutomaticRewardTransactions} from '../server/automatic-reward-store.mjs';
import {rewardLedgerPath} from '../server/reward-ledger-path.mjs';
import {createHolderHistoryIndexer} from '../server/holder-history-indexer.mjs';
import {createHolderSnapshotWorker} from '../server/holder-snapshot-worker.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';

if(process.env.SOLANA_CLUSTER!=='devnet')throw Error('Holder indexer requires explicit Devnet configuration.');
const store=createAutomaticRewardStore(rewardLedgerPath());
if(process.argv.includes('--health')) {
  const status=(await store.read()).holderIndexerStatus,age=Date.now()-Date.parse(status?.checkedAt);
  process.exit(status?.status==='active'&&age>=0&&age<120000?0:1);
}
const rpc=process.env.SOLANA_HOLDER_INDEX_RPC_URL||process.env.SOLANA_RPC_URL
  ||fs.readFileSync(process.env.SOLANA_RPC_URL_FILE,'utf8').trim();
const connection=new Connection(rpc,{commitment:'finalized',disableRetryOnRateLimit:true,
  fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})});
const indexer=createHolderHistoryIndexer({connection,store,rpcUrl:rpc,expectedGenesisHash:DEVNET_GENESIS_HASH});
const worker=createHolderSnapshotWorker({store,indexer});
let stopped=false,wake;
const stop=()=>{stopped=true;wake?.();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
while(!stopped){
  try{const result=await worker.tick();console.log(JSON.stringify({event:'holder-snapshot-cycle',...result}));}
  catch{console.error('Holder snapshot cycle unavailable; no payout or synthetic history was created.');}
  if(!stopped)await new Promise(resolve=>{const timer=setTimeout(resolve,10000);wake=()=>{clearTimeout(timer);resolve();};});
}
await drainAutomaticRewardTransactions();
