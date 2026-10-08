import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { Connection } from '@solana/web3.js';
import { pgPoolConfig } from '../server/db-config.mjs';
import { indexProductTrades, productTradeReport } from '../server/product-trade-index.mjs';

async function setting(name) {
  return process.env[name] || (process.env[`${name}_FILE`] ? (await readFile(process.env[`${name}_FILE`],'utf8')).trim() : '');
}
let pool;
try {
  const database=await setting('DATABASE_URL');
  const rpc=await setting('SOLANA_DEVNET_RPC_URL') || await setting('SOLANA_RPC_URL');
  if (!database || !rpc) throw new Error('Configuration unavailable.');
  pool=new pg.Pool({...pgPoolConfig(database),max:2});
  const connection=new Connection(rpc,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:async (url,options={})=>{await setTimeout(200);return fetch(url,{...options,signal:AbortSignal.timeout(15000)});}});
  const launches=(await pool.query("SELECT payload FROM launches WHERE payload->>'cluster'='devnet' AND payload->>'onchainVerified'='true' ORDER BY mint")).rows.map(row=>row.payload);
  const pass=await indexProductTrades({connection,pool,launches,maxPages:Number(process.argv[2] || 4),maxGapRetries:Number(process.argv[3] || 4)});
  const report=await productTradeReport(pool,'devnet');
  console.log(JSON.stringify({pass,report},null,2));
  if(pass.blocked || report.unresolvedProofs) process.exitCode=2;
}catch {console.error('Trade index pass could not complete. Check database/RPC availability and page budget. No transaction was submitted.');process.exitCode=1;}
finally{await pool?.end();}
