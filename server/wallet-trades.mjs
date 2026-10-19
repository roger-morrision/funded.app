import { PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM_ID, PUMP_SDK } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda, getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { decodePumpTrades, decodePumpSwapTrades } from './coin-market.mjs';
import { successfulEventLogs } from './product-trade-index.mjs';
import { GENESIS_HASHES } from './service-status.mjs';

const DAY=86_400;
const address=value=>value?.toBase58?.() || value?.pubkey?.toBase58?.() || String(value);

// Decode only successful, finalized receipts belonging to this wallet. The
// wallet's token-balance metadata supplies mint/decimal identities; PumpSwap
// receipts must also identify that mint's canonical SOL pool.
export function walletTradeRows({transaction,reference,wallet,decodePoolEvent}) {
  if (!transaction || transaction.meta?.err!==null || transaction.slot!==reference.slot
    || !Number.isSafeInteger(transaction.slot)||transaction.slot<1||reference.confirmationStatus!=='finalized'
    || transaction.transaction?.signatures?.[0]!==reference.signature
    || !Number.isSafeInteger(transaction.blockTime) || transaction.blockTime<0)
    throw new Error('Finalized wallet transaction is unavailable or mismatched.');
  const message=transaction.transaction.message;
  const keys=[...(message.accountKeys||message.staticAccountKeys||[]),
    ...(transaction.meta.loadedAddresses?.writable||[]),...(transaction.meta.loadedAddresses?.readonly||[])].map(address);
  if (!keys.includes(wallet)) throw new Error('Wallet is absent from its transaction.');
  const mints=new Map();
  for (const balance of [...(transaction.meta.preTokenBalances||[]),...(transaction.meta.postTokenBalances||[])]) {
    if (balance.owner!==wallet) continue;
    const mint=new PublicKey(balance.mint),decimals=balance.uiTokenAmount?.decimals;
    if (!Number.isInteger(decimals)||decimals<0||decimals>18) throw new Error('Token decimals are unavailable.');
    if (mints.has(balance.mint)&&mints.get(balance.mint).decimals!==decimals) throw new Error('Token decimals disagree.');
    mints.set(balance.mint,{mint,decimals});
  }
  const records=[];
  for (const event of successfulEventLogs(transaction.meta.logMessages)) {
    const curve=event.program===PUMP_PROGRAM_ID.toBase58(),pool=event.program===PUMP_AMM_PROGRAM_ID.toBase58();
    if (!curve&&!pool) continue;
    const encoded=event.log.slice('Program data: '.length),bytes=Buffer.from(encoded,'base64');
    let expectedTrader;
    if (curve&&bytes.subarray(0,8).equals(Buffer.from([189,219,127,211,78,230,97,238]))) {
      expectedTrader=PUMP_SDK.decodeTradeEventBc(bytes.subarray(8)).user.toBase58();
    } else if (pool) {
      const decoded=decodePoolEvent(encoded);
      if (['buyEvent','sellEvent'].includes(decoded?.name)) expectedTrader=decoded.data.user.toBase58();
    }
    const before=records.length;
    for (const [mint,{mint:key,decimals}] of mints) {
      const trades=curve?decodePumpTrades([event.log],key):decodePumpSwapTrades([
        `Program ${event.program} invoke [1]`,event.log,`Program ${event.program} success`,
      ],canonicalPumpPoolPda(key,NATIVE_MINT),decodePoolEvent);
      for (const trade of trades) {
        if (trade.trader!==wallet) continue;
        if (trade.solLamports<=0n||trade.tokenAmountRaw<=0n) throw new Error('Invalid wallet trade amounts.');
        records.push({mint,decimals,trader:wallet,signature:reference.signature,slot:transaction.slot,
          blockTime:transaction.blockTime,logIndex:event.index,route:curve?'curve':'pool',
          side:trade.isBuy?'buy':'sell',solLamports:String(trade.solLamports),
          tokenAmountRaw:String(trade.tokenAmountRaw),finalized:true});
      }
    }
    if (expectedTrader===wallet&&records.length===before) throw new Error('Wallet trade mint or quote proof is unavailable.');
  }
  return records;
}

export async function readWalletTradeHistory({connection,wallet,nowSeconds=Math.floor(Date.now()/1000),maxSignatures=50}) {
  const key=new PublicKey(wallet),owner=key.toBase58(),cutoff=nowSeconds-DAY;
  if (!Number.isInteger(maxSignatures)||maxSignatures<1||maxSignatures>50) throw new Error('Invalid wallet scan bound.');
  if (await connection.getGenesisHash()!==GENESIS_HASHES.devnet) throw new Error('Wallet history requires Devnet.');
  const references=await connection.getSignaturesForAddress(key,{limit:maxSignatures},'finalized');
  if (!Array.isArray(references)||references.length>maxSignatures
    || new Set(references.map(row=>row.signature)).size!==references.length
    || references.some(row=>row.confirmationStatus!=='finalized'||!Number.isSafeInteger(row.slot)
      || row.slot<1||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature)))
    throw new Error('Invalid finalized wallet signature history.');
  const selected=references.filter(row=>!row.err&&(row.blockTime==null||row.blockTime>=cutoff));
  const gaps=[],trades=[],coder=getPumpAmmProgram(connection).coder.events;
  for (let offset=0;offset<selected.length;offset+=4) {
    const batch=await Promise.all(selected.slice(offset,offset+4).map(async reference=>{
      try {
        const transaction=await connection.getTransaction(reference.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
        const rows=walletTradeRows({transaction,reference,wallet:owner,decodePoolEvent:coder.decode.bind(coder)});
        if (transaction.blockTime<cutoff) return [];
        return rows;
      } catch {gaps.push(reference.signature);return [];}
    }));
    trades.push(...batch.flat());
  }
  trades.sort((a,b)=>b.blockTime-a.blockTime||b.slot-a.slot||a.logIndex-b.logIndex);
  const windowCovered=references.length<maxSignatures||references.some(row=>row.blockTime!=null&&row.blockTime<cutoff);
  const complete=windowCovered&&!gaps.length&&references.every(row=>Number.isSafeInteger(row.blockTime))&&trades.length<=100;
  return {wallet:owner,cluster:'devnet',source:'finalized-wallet-pump-trades',observedAt:new Date(nowSeconds*1000).toISOString(),
    coverage:complete?'complete':'partial',scannedSignatures:selected.length,fetchedSignatures:references.length,
    signatureLimit:maxSignatures,rowLimit:100,windowHours:24,gaps: [...new Set(gaps)],trades:trades.slice(0,100)};
}
