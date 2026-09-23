import {createStore} from '../server/store.mjs';
const cutoff=process.argv.find(value=>value.startsWith('--before='))?.slice(9);
if(!process.env.DATABASE_URL&&!process.env.FUNDED_STORE_PATH)throw new Error('Choose an explicit store. No default app database is selected.');
if((process.env.VITE_SOLANA_CLUSTER||process.env.SOLANA_CLUSTER||'devnet')!=='devnet')throw new Error('Receipt maintenance is Devnet-only pending production review.');
const apply=process.argv.includes('--apply');
if(apply&&process.env.FUNDED_RECEIPT_RETENTION_ENABLED!=='true')throw new Error('Applying retention requires FUNDED_RECEIPT_RETENTION_ENABLED=true after reviewing a dry run and backup.');
const store=createStore(process.env.FUNDED_STORE_PATH,process.env.FUNDED_STORE_PATH?'':process.env.DATABASE_URL);
try {console.log(JSON.stringify(await store.pruneReceiptProofs({before:cutoff,limit:Number(process.env.FUNDED_RETENTION_BATCH||100),apply})));}
finally{await store.close?.();}
