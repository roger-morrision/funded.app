import {createStore} from '../server/store.mjs';
import {receiptWorkerStatus} from '../server/receipt-worker-status.mjs';
if(!process.env.DATABASE_URL&&!process.env.FUNDED_STORE_PATH)throw new Error('Choose an explicit worker status store.');
if((process.env.VITE_SOLANA_CLUSTER||process.env.SOLANA_CLUSTER||'devnet')!=='devnet')throw new Error('Worker status is Devnet-only.');
const store=createStore(process.env.FUNDED_STORE_PATH,process.env.FUNDED_STORE_PATH?'':process.env.DATABASE_URL);
try {
  const status=receiptWorkerStatus(await store.readReceiptBackfillStatus('devnet'));
  console.log(JSON.stringify(status));
  if(process.argv.includes('--check')&&!['running','batch-finished','pass-finished'].includes(status.status))process.exitCode=1;
}finally{await store.close?.();}
