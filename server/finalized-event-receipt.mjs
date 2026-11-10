import {Connection} from '@solana/web3.js';
import {successfulEventLogs} from './product-trade-index.mjs';
import {SOLANA_GENESIS,requireSolanaCluster} from '../solana-network.js';

const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const identity=receipt=>canonical({slot:receipt.slot,blockTime:receipt.blockTime,transaction:receipt.transaction,
  meta:Object.fromEntries(['err','preBalances','postBalances','preTokenBalances','postTokenBalances','loadedAddresses']
    .map(key=>[key,receipt.meta?.[key]]))});

// Some providers truncate otherwise finalized receipts. Recover only missing
// event logs, never accept a different transaction or changed balance evidence.
export async function completeFinalizedEventReceipt({connection,transaction,signature,cluster='devnet',
  rpcUrl=process.env.FUNDED_PROGRAM_EVIDENCE_RPC_URL||'',timeoutMs=8000,
  connectionFactory=(url,signal)=>new Connection(url,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(target,options)=>fetch(target,{...options,signal})})}) {
  requireSolanaCluster(cluster);
  try {successfulEventLogs(transaction?.meta?.logMessages);return transaction;}
  catch(error){if(!['logs-incomplete','logs-unavailable'].includes(error.reason)||!rpcUrl)throw error;}
  if(!transaction||transaction.meta?.err!==null||transaction.transaction?.signatures?.[0]!==signature)
    throw Error('A successful finalized receipt is required.');
  const url=new URL(rpcUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Invalid receipt evidence RPC configuration.');
  const controller=new AbortController();let timer;
  try {
    return await Promise.race([(async()=>{
      const reader=connectionFactory(rpcUrl,controller.signal);
      const [primary,alternate]=await Promise.all([connection.getGenesisHash(),reader.getGenesisHash()]);
      if(primary!==SOLANA_GENESIS[cluster]||alternate!==primary)throw Error('Receipt providers must agree on the selected network.');
      const complete=await reader.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
      if(!complete||identity(complete)!==identity(transaction))throw Error('Finalized receipt providers disagree.');
      successfulEventLogs(complete.meta.logMessages);
      return complete;
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Complete receipt verification timed out.'));},timeoutMs);})]);
  }finally{clearTimeout(timer);controller.abort();}
}
