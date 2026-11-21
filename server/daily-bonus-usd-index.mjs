import { PublicKey } from '@solana/web3.js';
import { bondingCurvePda } from '@pump-fun/pump-sdk';
import { canonicalPumpPoolPda, getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { createDailyBonusEvidenceIndex } from './daily-bonus-index.mjs';
import { resolveUsdBonusLaunchQuotes } from './daily-bonus-quote-gate.mjs';
import { readDailyBonusTradeRows } from './daily-bonus-evidence.mjs';
import { scoreBonusQuoteUsd } from './daily-bonus-usd-score.mjs';
import { scanPairedBonusSettlements } from './daily-bonus-paired-scan.mjs';
import { verifyStoredPairedBonusConversion } from './daily-bonus-paired-conversion.mjs';
import { verifyStoredPairedBonusSettlement } from './daily-bonus-paired-settlement.mjs';
import { deriveAgencyPolicyV3 } from '../mint-router-v3-token.js';
import { deriveMintAutomationV3, verifyMintAutomationV3 } from '../mint-automation-v3.js';

const compare=(a,b)=>a===b?0:a<b?-1:1;

async function pairedReferrer({connection,programId,launch}) {
  const address=deriveMintAutomationV3(programId,launch.mint);
  const info=await connection.getAccountInfo(address,'finalized');
  if (!info) throw new Error('Paired Daily bonus needs a frozen on-chain referral upline.');
  const data=Buffer.from(info.data);
  if (data.length!==233) throw new Error('Paired Daily bonus automation record is invalid.');
  const recipients=Array.from({length:4},(_,index)=>new PublicKey(data.subarray(104+index*32,136+index*32)));
  if (!verifyMintAutomationV3(info,{programId,mint:launch.mint,creator:launch.creatorWallet,
    policy:deriveAgencyPolicyV3(programId,launch.mint),recipients}))
    throw new Error('Paired Daily bonus frozen recipient record differs from the mint policy.');
  return recipients[1].equals(PublicKey.default)?null:recipients[1].toBase58();
}

async function pairedTrades({connection,launch,quoteMint,window,cluster,score,limitPages=20}) {
  const mint=new PublicKey(launch.mint),pool=canonicalPumpPoolPda(mint,quoteMint);
  const coder=getPumpAmmProgram(connection).coder.events;
  const rows=[];
  for (const address of [bondingCurvePda(mint),pool]) {
    let before,complete=false,previousSlot=Number.MAX_SAFE_INTEGER;
    const seen=new Set();
    for (let page=0;page<limitPages;page++) {
      const refs=await connection.getSignaturesForAddress(address,{limit:100,...(before?{before}:{})},'finalized');
      if (!Array.isArray(refs)||refs.length>100)throw new Error('Paired bonus trade history page is invalid.');
      for (const ref of refs) {
        if (seen.has(ref.signature)||ref.confirmationStatus!=='finalized'
          ||!Number.isSafeInteger(ref.slot)||ref.slot>previousSlot||!Number.isSafeInteger(ref.blockTime))
          throw new Error('Paired bonus trade history has an ordering or finality gap.');
        seen.add(ref.signature);previousSlot=ref.slot;
        if(ref.err||ref.blockTime<window.start||ref.blockTime>=window.end)continue;
        const transaction=await connection.getTransaction(ref.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
        const decoded=await readDailyBonusTradeRows({connection,transaction,reference:ref,mint,pool,
          cluster,quoteMint,decodePoolEvent:coder.decode.bind(coder)});
        for(const row of decoded)rows.push({...row,...await score({quoteMint,
          amountRaw:row.amountRaw,at:row.blockTime})});
      }
      if(refs.length<100||refs.some(ref=>ref.blockTime<window.start)){complete=true;break;}
      before=refs.at(-1).signature;
    }
    if(!complete)throw new Error('Paired bonus trade coverage exceeds the page limit.');
  }
  return rows;
}

// Preserve the reviewed SOL index and its old snapshots. Add paired claims and
// trades only after complete token-ledger backfill, exact conversion attribution
// and historical USD price evidence for every finalized score.
export function createDailyBonusUsdEvidenceIndex({rewardStore,store,readPrice}) {
  const readSol=createDailyBonusEvidenceIndex({rewardStore});
  const priceCache=new Map();
  const score=async ({quoteMint,cluster,amountRaw,at})=>{
    const key=`${cluster}:${quoteMint}:${at}`;
    let evidence=priceCache.get(key);
    if(!evidence){
      evidence=await scoreBonusQuoteUsd({quoteMint,cluster,amountRaw,at,readPrice});
      if(priceCache.size>=5000)priceCache.delete(priceCache.keys().next().value);
      priceCache.set(key,evidence.priceEvidence);
      return evidence;
    }
    return scoreBonusQuoteUsd({quoteMint,cluster,amountRaw,at,
      readPrice:async()=>evidence});
  };
  return async function read({connection,state,programId,cluster='devnet',day,now,qaMints,eligibilityBasis}) {
    if(eligibilityBasis!=='settlement-time-v1')throw new Error('Common USD bonus ranking requires finalized settlement-time evidence.');
    const {dailyBonusWindow}=await import('./daily-bonus.mjs');
    const window=dailyBonusWindow(day,now);
    const launches=Object.values(state.launches||{}).filter(row=>row.onchainVerified===true
      &&row.cluster===cluster&&row.pumpFeeRoute?.scope==='per-mint-v3'
      &&row.pumpFeeRoute.programId===programId&&row.pumpFeeRoute.verified===true
      &&(!window.qa||qaMints==='*'||qaMints?.includes(row.mint))
      &&Number.isSafeInteger(row.createdTimestamp)&&row.createdTimestamp<window.end);
    const quotes=await resolveUsdBonusLaunchQuotes({connection,launches,cluster});
    const solLaunches=launches.filter(row=>quotes.get(row.mint)?.equals(NATIVE_MINT));
    const pairedLaunches=launches.filter(row=>quotes.get(row.mint)&&!quotes.get(row.mint).equals(NATIVE_MINT));
    const ineligibleLaunches=launches.filter(row=>quotes.get(row.mint)===null);
    // A single unsupported quote can change all three common-USD rankings.
    // Do not finalize a partial snapshot or pay the supported launches while
    // that launch's trades and settlement fees are absent from the evidence.
    if(ineligibleLaunches.length)throw new Error(`Daily bonus common USD ranking is blocked: ${ineligibleLaunches.length} launch(es) lack reviewed historical USD price evidence (${ineligibleLaunches.map(row=>row.mint).sort().join(', ')}).`);
    const solState={...state,launches:Object.fromEntries(solLaunches.map(row=>[row.mint,row]))};
    const sol=await readSol({connection,state:solState,programId,cluster,day,now,qaMints,eligibilityBasis});
    if(sol.complete===false)return sol;
    const collections=[];
    for(const row of sol.collections)collections.push({...row,...await score({quoteMint:NATIVE_MINT,cluster,
      amountRaw:row.amountLamports,at:row.settlementBlockTime})});
    const trades=[];
    for(const row of sol.trades)trades.push({...row,...await score({quoteMint:NATIVE_MINT,cluster,
      amountRaw:row.amountLamports,at:row.blockTime})});
    const coverage=[...sol.coverage];
    for(const launch of pairedLaunches.sort((a,b)=>compare(a.mint,b.mint))) {
      const quoteMint=quotes.get(launch.mint);
      const scanned=await scanPairedBonusSettlements({connection,store,cluster,programId,
        mint:launch.mint,quoteMint:quoteMint.toBase58(),createdTimestamp:launch.createdTimestamp});
      if(!scanned.complete)return {complete:false,day,reason:'Backfilling paired-token bonus settlements.'};
      const fresh=await store.read();
      const conversions=Object.values(fresh.v3TokenBonusConversions||{}).filter(row=>row.cluster===cluster
        &&row.programId===programId&&row.mint===launch.mint&&row.quoteMint===quoteMint.toBase58()
        &&row.status==='finalized');
      const sourceMap=new Map(Object.values(fresh.v3TokenBonusSources||{}).filter(row=>row.cluster===cluster
        &&row.programId===programId&&row.mint===launch.mint&&row.quoteMint===quoteMint.toBase58())
        .map(row=>[row.signature,row]));
      for(const source of sourceMap.values())
        await verifyStoredPairedBonusSettlement({connection,source,programId,cluster});
      for(const conversion of conversions)
        await verifyStoredPairedBonusConversion({connection,programId,cluster,conversion,sources:sourceMap});
      const referrer=await pairedReferrer({connection,programId,launch});
      for(const source of Object.values(fresh.v3TokenBonusSources||{}).filter(row=>row.cluster===cluster
        &&row.programId===programId&&row.mint===launch.mint&&row.quoteMint===quoteMint.toBase58()
        &&row.blockTime>=window.start&&row.blockTime<window.end)){
        const portions=conversions.flatMap(row=>(row.allocations||[]).filter(item=>item.settlementSignature===source.signature));
        const spent=portions.reduce((sum,row)=>sum+BigInt(row.spentQuoteRaw),0n);
        if(spent!==BigInt(source.bonusQuoteRaw))return {complete:false,day,
          reason:'Waiting for exact paired-token Daily bonus conversion into SOL.'};
        const communityLamports=portions.reduce((sum,row)=>sum+BigInt(row.receivedLamports),0n);
        collections.push({signature:source.signature,settlementSignature:source.signature,
          mint:launch.mint,creator:launch.creatorWallet,referrer,blockTime:source.blockTime,
          settlementBlockTime:source.blockTime,finalized:true,amountRaw:source.grossQuoteRaw,
          communityLamports:String(communityLamports),
          dailyBonusVersion:launch.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version||null,
          ...await score({quoteMint,cluster,amountRaw:source.grossQuoteRaw,at:source.blockTime})});
      }
      trades.push(...await pairedTrades({connection,launch,quoteMint,window,cluster,
        score:input=>score({...input,cluster})}));
      coverage.push({mint:launch.mint,complete:true,routes:2,paired:true,settlementHistoryComplete:true});
    }
    return {complete:true,eligibilityBasis,scoringBasis:'common-usd-v2',collections,trades,coverage};
  };
}
