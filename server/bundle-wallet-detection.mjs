import {PublicKey,SystemProgram} from '@solana/web3.js';
import {PUMP_PROGRAM_ID,bondingCurvePda} from '@pump-fun/pump-sdk';
import {TOKEN_2022_PROGRAM_ID,unpackAccount} from '@solana/spl-token';
import bs58 from 'bs58';
import {successfulEventLogs} from './product-trade-index.mjs';
import {decodePumpTrades} from './coin-market.mjs';
import {DEVNET_GENESIS_HASH} from './automatic-reward-chain.mjs';

export const BUNDLE_SCAN_POLICY=Object.freeze({windowSeconds:60,maxReceipts:24,maxWallets:8,fundingReferences:6,
  fundingReceipts:3,minFundingLamports:'10000000',clusterWallets:3,coordinationSeconds:10});
const pub=value=>value?.toBase58?.()||String(value);
function verifiedReceipt(tx,ref){
  if(!tx||tx.meta?.err!==null||ref.confirmationStatus!=='finalized'||tx.slot!==ref.slot
    ||tx.transaction?.signatures?.[0]!==ref.signature||!Number.isSafeInteger(tx.slot)||!Number.isSafeInteger(tx.blockTime)
    ||ref.blockTime!==tx.blockTime)throw Error('Finalized transaction identity is unavailable.');
}
export function receiptBuyers(tx,ref,mint){
  verifiedReceipt(tx,ref);
  return successfulEventLogs(tx.meta.logMessages).filter(row=>row.program===PUMP_PROGRAM_ID.toBase58())
    .flatMap(row=>decodePumpTrades([row.log],new PublicKey(mint)).filter(t=>t.isBuy&&t.tokenAmountRaw>0n)
      .map(t=>({wallet:t.trader,signature:ref.signature,slot:tx.slot,blockTime:tx.blockTime,logIndex:row.index,amount:t.tokenAmountRaw.toString()})));
}
export function receiptFunding(tx,ref,wallet){
  verifiedReceipt(tx,ref);
  const message=tx.transaction.message,keys=[...(message.accountKeys||message.staticAccountKeys||[]),...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])].map(pub);
  const transfers=[];
  for(const ix of message.instructions||message.compiledInstructions||[]){
    const indexes=Array.from(ix.accounts||ix.accountKeyIndexes||[]),data=Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data);
    if(keys[ix.programIdIndex]!==SystemProgram.programId.toBase58()||data.length!==12||data.readUInt32LE(0)!==2
      ||indexes[0]>=message.header.numRequiredSignatures||keys[indexes[1]]!==wallet)continue;
    const amount=data.readBigUInt64LE(4);
    if(amount<BigInt(BUNDLE_SCAN_POLICY.minFundingLamports))continue;
    transfers.push({source:keys[indexes[0]],wallet,amount:amount.toString(),signature:ref.signature,slot:tx.slot,blockTime:tx.blockTime});
  }
  return transfers;
}

export function analyzeBundleEvidence({trades,funding,holdings={},supply,creatorWallet,coverage,excludedFunders=[]}){
  const first=new Map();
  for(const t of [...trades].sort((a,b)=>a.slot-b.slot||a.logIndex-b.logIndex))if(!first.has(t.wallet))first.set(t.wallet,t);
  const funders=new Map(),excluded=new Set(excludedFunders);
  for(const transfer of funding){
    if(excluded.has(transfer.source)||transfer.source===transfer.wallet||!first.has(transfer.wallet))continue;
    const rows=funders.get(transfer.source)||new Map();rows.set(transfer.wallet,transfer);funders.set(transfer.source,rows);
  }
  const clusters=[];
  for(const [source,rows] of funders){
    if(rows.size<BUNDLE_SCAN_POLICY.clusterWallets)continue;
    const wallets=[...rows.keys()],buys=wallets.map(w=>first.get(w));
    const coordinated=Math.max(...buys.map(t=>t.blockTime))-Math.min(...buys.map(t=>t.blockTime))<=BUNDLE_SCAN_POLICY.coordinationSeconds;
    const known=wallets.every(w=>/^[0-9]+$/.test(String(holdings[w]))),total=wallets.reduce((n,w)=>n+BigInt(holdings[w]||0),0n);
    clusters.push({source,wallets,status:coordinated?'suspected-coordination':'shared-funder',
      confidence:coordinated?'moderate':'low',creatorLinked:source===creatorWallet||wallets.includes(creatorWallet),
      holdingPercent:known&&BigInt(supply)>0n?Number(total*1_000_000n/BigInt(supply))/10000:null,
      fundingProofs:[...rows.values()],buyProofs:buys,
      caveat:'Shared funding can come from an exchange or service. These receipts do not prove common ownership or a Jito bundle.'});
  }
  const slots=new Map();for(const row of trades){const set=slots.get(row.slot)||new Set();set.add(row.wallet);slots.set(row.slot,set);}
  const bursts=[...slots].filter(([,wallets])=>wallets.size>=3).map(([slot,wallets])=>({slot,wallets:[...wallets],status:'timing-signal-only'}));
  return {status:clusters.some(c=>c.status==='suspected-coordination')?'suspected-coordination':clusters.length||bursts.length?'signals-observed':'no-indicators-in-scanned-data',
    bundleConfirmed:false,clusters,bursts,coverage,policy:BUNDLE_SCAN_POLICY,
    assessedWallets:first.size,explanation:'Observational risk signals only. Timing alone is not bundle evidence; unscanned history and undiscovered wallets remain unknown.'};
}

export async function scanBundleWallets({connection,launch,excludedFunders=[]}){
  if(await connection.getGenesisHash()!==DEVNET_GENESIS_HASH)throw Error('Bundle scanning requires Devnet.');
  const mint=new PublicKey(launch.mint),start=Number(launch.createdTimestamp),end=start+BUNDLE_SCAN_POLICY.windowSeconds;
  if(launch.onchainVerified!==true||launch.cluster!=='devnet'||!Number.isSafeInteger(start)||start<=0)throw Error('A verified launch is required.');
  const reasons=new Set(),refs=[],seen=new Set();let before,historyComplete=false;
  for(let page=0;page<2;page++){
    const rows=await connection.getSignaturesForAddress(bondingCurvePda(mint),{limit:100,...(before?{before}:{})},'finalized');
    for(const row of rows){if(!seen.has(row.signature)){seen.add(row.signature);refs.push(row);}}
    if(rows.length<100||rows.some(r=>r.signature===launch.signature||r.blockTime!=null&&r.blockTime<start)){historyComplete=true;break;}
    before=rows.at(-1)?.signature;
  }
  if(!refs.some(r=>r.signature===launch.signature||r.blockTime!=null&&r.blockTime<start))historyComplete=false;
  if(!historyComplete)reasons.add('Launch-window history is incomplete or exceeds the bounded scan.');
  if(refs.some(r=>r.blockTime==null))reasons.add('Some transaction timestamps are unavailable.');
  let selected=refs.filter(r=>!r.err&&r.blockTime>=start&&r.blockTime<=end).sort((a,b)=>a.slot-b.slot);
  if(selected.length>BUNDLE_SCAN_POLICY.maxReceipts)reasons.add('Early transaction scan limit reached.');
  selected=selected.slice(0,BUNDLE_SCAN_POLICY.maxReceipts);
  const trades=[];
  for(const ref of selected){try{trades.push(...receiptBuyers(await connection.getTransaction(ref.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}),ref,launch.mint));}
    catch{reasons.add('One or more early trade receipts could not be verified.');}}
  const first=new Map();for(const row of trades)if(!first.has(row.wallet))first.set(row.wallet,row);
  if(first.size>BUNDLE_SCAN_POLICY.maxWallets)reasons.add('Wallet funding scan limit reached.');
  const funding=[],holdings={},slotSignatures=new Map();
  for(const [wallet,buy] of [...first].slice(0,BUNDLE_SCAN_POLICY.maxWallets)){
    try{
      const refs=await connection.getSignaturesForAddress(new PublicKey(wallet),{before:buy.signature,limit:BUNDLE_SCAN_POLICY.fundingReferences},'finalized');
      if(refs.length>=BUNDLE_SCAN_POLICY.fundingReferences)reasons.add('Funding history is bounded; older sources may exist.');
      const eligible=refs.filter(r=>!r.err&&r.blockTime!=null&&r.blockTime<=buy.blockTime&&r.blockTime>=start-86400);
      if(eligible.length>BUNDLE_SCAN_POLICY.fundingReceipts)reasons.add('Funding receipt scan limit reached.');
      for(const ref of eligible.slice(0,BUNDLE_SCAN_POLICY.fundingReceipts)){
        const transfers=receiptFunding(await connection.getTransaction(ref.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}),ref,wallet);
        if(ref.slot===buy.slot){
          if(!slotSignatures.has(ref.slot))slotSignatures.set(ref.slot,(await connection.getBlock(ref.slot,{commitment:'finalized',transactionDetails:'signatures',rewards:false,maxSupportedTransactionVersion:0}))?.signatures||[]);
          const ordered=slotSignatures.get(ref.slot),fi=ordered.indexOf(ref.signature),bi=ordered.indexOf(buy.signature);
          if(fi<0||bi<0||fi>=bi){reasons.add('Same-slot funding order could not be established.');continue;}
        }else if(ref.slot>buy.slot)continue;
        funding.push(...transfers);
      }
      const accounts=await connection.getTokenAccountsByOwner(new PublicKey(wallet),{mint},'finalized');
      holdings[wallet]=accounts.value.reduce((sum,row)=>{
        const account=unpackAccount(row.pubkey,row.account,TOKEN_2022_PROGRAM_ID);
        if(!account.owner.equals(new PublicKey(wallet))||!account.mint.equals(mint))throw Error('Holding identity differs');
        return sum+account.amount;
      },0n).toString();
    }catch{reasons.add('One or more funding histories or wallet balances are unavailable.');}
  }
  const slot=await connection.getSlot('finalized'),chainTime=await connection.getBlockTime(slot);
  if(chainTime==null||chainTime<end)reasons.add('The finalized 60-second launch window is still open.');
  const supply=await connection.getTokenSupply(mint,'finalized');
  const coverage={status:reasons.size?'partial':'complete-within-policy-limits',reasons:[...reasons],tradeReceipts:selected.length,
    fundingWallets:Object.keys(holdings).length,windowStart:start,windowEnd:end,checkedSlot:slot,checkedAt:new Date().toISOString()};
  return {mint:launch.mint,cluster:'devnet',source:'finalized-solana-receipts',
    ...analyzeBundleEvidence({trades,funding,holdings,supply:supply.value.amount,creatorWallet:launch.creatorWallet,coverage,excludedFunders})};
}
