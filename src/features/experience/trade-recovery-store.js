const NET = String(import.meta.env?.VITE_SOLANA_CLUSTER || 'devnet').trim();
import { address, signature, array } from './view-utils.js';
const KEY = `funded.trade-recovery.${NET}.v1`;
let memory = [];
const unsaved=new Map(),key=row=>`${row.walletAddress}:${row.signature}`;
const progress=value=>['signed','confirmed','indexing'].includes(value)?value:'signed';
const publicRow=row=>({cluster:NET,signature:row.signature,walletAddress:row.walletAddress,mint:row.mint,side:row.side,
  lastValidBlockHeight:Number.isSafeInteger(row.lastValidBlockHeight)?row.lastValidBlockHeight:null,broadcastUncertain:row.broadcastUncertain!==false,
  symbol:typeof row.symbol==='string'?row.symbol.slice(0,32):'token',feeLamports:Number.isSafeInteger(row.feeLamports)&&row.feeLamports>=0?row.feeLamports:null,
  progress:progress(row.progress),state:row.state,at:row.at,updatedAt:Number.isFinite(Date.parse(row.updatedAt))?row.updatedAt:row.at});
export function readTradeRecovery(storage = globalThis.localStorage) {
  let readable=false;
  try { memory = array(JSON.parse(storage.getItem(KEY) || '[]')).filter(row => row.cluster === NET
    && address(row.walletAddress) && address(row.mint) && signature(row.signature)
    && ['buy','sell'].includes(row.side) && ['pending','verified','failed'].includes(row.state)
    && Number.isFinite(Date.parse(row.at))).slice(-100).map(publicRow);readable=true; } catch { /* In-tab recovery remains available. */ }
  memory=[...new Map([...memory,...unsaved.values()].map(row=>[key(row),row])).values()].slice(-100);
  return memory.map(row => ({...row,persisted:readable&&!unsaved.has(key(row))}));
}
export function recordTradeRecovery(row, storage = globalThis.localStorage) {
  if (!address(row.walletAddress) || !address(row.mint) || !signature(row.signature) || !['buy','sell'].includes(row.side)) return false;
  const prior = readTradeRecovery(storage).find(item => item.signature === row.signature && item.walletAddress === row.walletAddress);
  const next = {cluster:NET,signature:row.signature,walletAddress:row.walletAddress,mint:row.mint,side:row.side,
    lastValidBlockHeight:Number.isSafeInteger(row.lastValidBlockHeight)?row.lastValidBlockHeight:prior?.lastValidBlockHeight??null,
    broadcastUncertain:typeof row.broadcastUncertain==='boolean'?row.broadcastUncertain:prior?.broadcastUncertain??true,
    symbol:String(row.symbol || prior?.symbol || 'token').slice(0, 32),feeLamports:Number.isSafeInteger(row.feeLamports) && row.feeLamports >= 0 ? row.feeLamports : prior?.feeLamports ?? null,
    progress:progress(row.progress??prior?.progress),
    state:['verified','failed'].includes(row.state) ? row.state : prior?.state || 'pending',at:prior?.at || new Date().toISOString(),updatedAt:new Date().toISOString()};
  memory = [...memory.filter(item => item.signature !== row.signature || item.walletAddress !== row.walletAddress), next].slice(-100);
  unsaved.set(key(next),next);if(unsaved.size>100)unsaved.delete(unsaved.keys().next().value);
  let saved = false; try { storage.setItem(KEY, JSON.stringify(memory)); saved = true;unsaved.clear(); } catch { /* Do not store secrets or block receipt verification. */ }
  globalThis.dispatchEvent?.(new Event('funded:trade-recovery')); return saved;
}
export function uncertainTrade(wallet,mint,pending=new Map()){
 return [...pending.values(),...readTradeRecovery()].find(row=>row.walletAddress===wallet&&row.mint===mint
  &&(row.state==null||row.state==='pending')&&row.broadcastUncertain!==false)||null;
}
