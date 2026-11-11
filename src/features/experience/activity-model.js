import { address, signature, array } from './view-utils.js';
import { APP_NET } from '../shared/app-network.js';
const secondsDate = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 8640000000000 ? new Date(Number(value)*1000).toISOString() : null;
export function activityRows(launches, experience, trades = [], statements = []) {
  const rows = [];
  for (const row of array(launches)) if (row.onchainVerified === true && row.cluster === APP_NET && address(row.mint)) rows.push({id:`launch:${row.mint}`,kind:'launch',mint:row.mint,
    creator:row.creatorWallet,title:`${row.symbol || row.name || 'Token'} launched`,at:row.createdAt || secondsDate(row.createdTimestamp),href:`/token/${row.mint}`,evidence:'Verified launch record'});
  if (experience?.cluster === APP_NET && ['recorded-finalized-v3','onchain-indexed'].includes(experience.evidence?.status)) for (const row of array(experience.events)) {
    if (!address(row.mint) || !signature(row.signature) || !(row.kind === 'buyback-burned' || String(row.kind).endsWith('-paid') && row.feeSourceVerified === true)) continue;
    rows.push({id:`${row.kind}:${row.signature}:${row.mint}`,kind:'receipt',mint:row.mint,signature:row.signature,amountLamports:row.amountLamports,title:row.label || row.kind,at:row.at,
      creator:array(launches).find(launch=>launch.mint===row.mint)?.creatorWallet,evidence:'Recorded finalized receipt'});
  }
  for (const row of array(trades)) if (address(row.mint) && address(row.trader) && signature(row.signature) && ['buy','sell'].includes(row.side)) rows.push({
    id:`trade:${row.signature}:${row.mint}`,kind:'trade',mint:row.mint,creator:row.trader,wallet:row.trader,signature:row.signature,
    title:`Observed ${row.side} · ${row.symbol || row.mint.slice(0,6)}`,at:secondsDate(row.blockTime),evidence:'Observed indexed trade; no profit claim'});
  for (const row of array(statements)) if (/^[a-f0-9]{24}$/.test(row.id || '') && /^\d{1,24}$/.test(String(row.creatorId)) && typeof row.text === 'string') rows.push({
    id:`statement:${row.id}`,kind:'statement',creatorId:String(row.creatorId),creator:row.creatorWallet || null,title:'Creator update',text:row.text.slice(0,1120),at:row.at,href:`/creator/x/${row.creatorId}`,evidence:'Creator statement; claims not independently verified'});
  return [...new Map(rows.map(row=>[row.id,row])).values()].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)||a.id.localeCompare(b.id)).slice(0,100);
}
export function filterActivity(rows, kind, wallets, creators) {
  return rows.filter(row => kind === 'following' ? wallets.has(row.creator) || creators.has(row.creatorId)
    : kind === 'all' || row.kind === kind);
}
export function isActivityHidden(row,storage=globalThis.localStorage){
  if(row.kind!=='statement'||!/^\d{1,24}$/.test(String(row.creatorId)))return false;
  try{return array(JSON.parse(storage.getItem(`funded.hidden-creator-updates.${row.creatorId}.v1`)||'[]')).slice(-100).includes(row.id.replace(/^statement:/,''));}catch{return false;}
}
