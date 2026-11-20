import {assertBonusRpc,assertBonusNetwork} from './daily-bonus-network.mjs';
import {PublicKey} from '@solana/web3.js';
import {readDailyBonusTrades} from './daily-bonus-evidence.mjs';
import {verifySolQuotedBonusLaunch} from './daily-bonus-quote-gate.mjs';

export function rankLiveBonus(entries){
  const totals=new Map();
  for(const [wallet,amount]of entries){
    if(!/^[1-9]\d*$/.test(String(amount)))continue;
    try{if(!PublicKey.isOnCurve(new PublicKey(wallet).toBytes()))continue;}catch{continue;}
    totals.set(wallet,(totals.get(wallet)||0n)+BigInt(amount));
  }
  return [...totals].sort((a,b)=>a[1]===b[1]?a[0].localeCompare(b[0]):a[1]>b[1]?-1:1)
    .slice(0,5).map(([wallet,score],i)=>({rank:i+1,wallet,scoreLamports:String(score),provisionalWinner:i<3}));
}

// Read-only preview. Never stored as a winner snapshot or used by payout code.
// Rotate one mint per refresh, retaining independent finalized trade evidence.
export function createLiveBonusReader({connection,programId,cluster='devnet',readTrades=readDailyBonusTrades,now=()=>Math.floor(Date.now()/1000)}){
  assertBonusNetwork(cluster);
  let startAt,rows=new Map(),checkedQuotes=new Set(),blockedReason=null,cursor=0,job,lastAttempt=0;
  return function read(state,start,end){
    if(startAt!==start){startAt=start;rows=new Map();checkedQuotes=new Set();blockedReason=null;cursor=0;lastAttempt=0;}
    const launches=Object.values(state.launches||{}).filter(row=>row.onchainVerified===true&&row.cluster===cluster
      &&row.pumpFeeRoute?.scope==='per-mint-v3'&&row.pumpFeeRoute.verified===true&&row.pumpFeeRoute.programId===programId
      &&Number.isSafeInteger(row.createdTimestamp)&&row.createdTimestamp<end);
    const allowed=new Set(launches.map(row=>row.mint));for(const key of rows.keys())if(!allowed.has(key))rows.delete(key);
    for(const key of checkedQuotes)if(!allowed.has(key))checkedQuotes.delete(key);
    if(!job&&!blockedReason&&launches.length&&now()-lastAttempt>=15){
      lastAttempt=now();const launch=launches[cursor++%launches.length],capturedStart=start,checkedAt=now();
      job=Promise.resolve().then(async()=>{
        await assertBonusRpc(connection,cluster);
        // Verify the whole cohort before showing a provisional winner. A paired
        // launch discovered later would invalidate an earlier SOL-only ranking.
        for(const candidate of launches){
          if(checkedQuotes.has(candidate.mint))continue;
          await verifySolQuotedBonusLaunch({connection,launch:candidate});
          if(startAt===capturedStart)checkedQuotes.add(candidate.mint);
        }
        if(startAt!==capturedStart)return null;
        return readTrades({connection,launch,cluster,window:{start,end:Math.min(end,checkedAt+1)},maxPages:3});
      }).then(result=>{
        if(startAt===capturedStart&&result?.coverage?.complete===true)rows.set(launch.mint,{rows:result.rows,checkedAt});
      }).catch(error=>{
        if(startAt!==capturedStart)return;
        rows.delete(launch.mint);
        if(error.code==='BONUS_PAIRED_PRICE_UNAVAILABLE')blockedReason=error.message;
      }).finally(()=>{job=null;});
    }
    const seen=new Set(),entries=[];
    for(const value of rows.values())for(const row of value.rows){
      const key=`${row.signature}:${row.logIndex}:${row.mint}`;
      if(seen.has(key)||row.finalized!==true||row.blockTime<start||row.blockTime>=end||row.blockTime>now())continue;
      seen.add(key);entries.push([row.wallet,row.amountLamports]);
    }
    const completeQuotes=checkedQuotes.size===launches.length;
    return {status:blockedReason?'blocked':completeQuotes&&rows.size===launches.length?'observed':'partial',
      ...(blockedReason?{reason:blockedReason}:{}),indexedMints:rows.size,totalMints:launches.length,
      checkedAt:rows.size?new Date(Math.min(...[...rows.values()].map(row=>row.checkedAt))*1000).toISOString():null,
      traders:blockedReason||!completeQuotes?null:rankLiveBonus(entries)};
  };
}
