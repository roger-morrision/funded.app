import {Connection,PublicKey} from '@solana/web3.js';
import {readWalletTradeHistory} from './wallet-trades.mjs';

export function communityTradeMetrics({history,mint,heldRaw,priceSol,priceAt,now=Date.now()}) {
  const result={purchasedSol:null,pnlSol:null,windowHours:24,coverage:history?.coverage||'unavailable',
    reason:'Verified wallet history is unavailable.',observedAt:history?.observedAt||null};
  if (!history || history.cluster!=='devnet' || history.source!=='finalized-wallet-pump-trades') return result;
  const rows=history.trades.filter(row=>row.mint===mint).sort((a,b)=>a.slot-b.slot||a.logIndex-b.logIndex);
  let buys=0n,sells=0n,held=0n,oversold=false,decimals=null;
  const seen=new Set();
  for (const row of rows) {
    const id=`${row.signature}:${row.logIndex}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (row.finalized!==true || row.trader!==history.wallet || !['buy','sell'].includes(row.side)
      || !Number.isInteger(row.decimals) || row.decimals<0 || row.decimals>18
      || (decimals!==null&&decimals!==row.decimals) || !/^\d+$/.test(row.solLamports) || !/^\d+$/.test(row.tokenAmountRaw)) return result;
    decimals=row.decimals;
    const quantity=BigInt(row.tokenAmountRaw),sol=BigInt(row.solLamports);
    if (row.side==='buy') {buys+=sol;held+=quantity;} else {sells+=sol;held-=quantity;}
    if (held<0n) oversold=true;
  }
  result.purchasedSol=rows.length || history.coverage==='complete' ? Number(buys)/1e9 : null;
  if (history.coverage!=='complete') return {...result,reason:'Partial 24h history. Purchased includes verified buys found; P&L needs complete cost basis.'};
  if (!rows.length) return {...result,reason:'No verified buys in the last 24 hours.'};
  if (oversold || history.adjustedMints?.includes(mint) || !/^\d+$/.test(String(heldRaw)) || held!==BigInt(heldRaw))
    return {...result,reason:'Older holdings or token transfers prevent a reliable cost basis for these trades.'};
  if (held>0n && (!Number.isFinite(priceSol)||priceSol<=0||!Number.isFinite(Date.parse(priceAt))||now-Date.parse(priceAt)>60_000))
    return {...result,reason:'A fresh token price is unavailable.'};
  result.pnlSol=Number(sells-buys)/1e9+(held>0n?Number(held)/10**decimals*priceSol:0);
  return {...result,reason:'Estimated P&L for the last 24h of verified trades: sales plus remaining tokens at spot price, minus purchases. Additional app/network fees and exit slippage are excluded.'};
}

// Public feed reads never launch an unbounded wallet scan. Refresh two wallets at
// a time, coalesce duplicate authors and let the next feed poll pick up results.
export function createCommunityTradeReader({rpcUrl,cluster,readMarketCaps,readHistory=readWalletTradeHistory,
  makeConnection=signal=>new Connection(rpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal})}),now=Date.now}) {
  const cache=new Map(),pending=new Map();
  return async rows=>{
    if (cluster!=='devnet') return {};
    const wallets=new Map();
    for (const row of rows.filter(row=>row.callout)) {
      if (!wallets.has(row.author)) wallets.set(row.author,new Set());
      wallets.get(row.author).add(row.mint);
    }
    for (const [wallet,mints] of wallets) {
      const cached=cache.get(wallet);
      if (pending.has(wallet)||pending.size>=2||cached&&now()-cached.at<60_000) continue;
      const task=(async()=>{
        const connection=makeConnection(AbortSignal.timeout(20_000));
        const history=await readHistory({connection,wallet});
        const markets=await readMarketCaps([...mints],{maxAgeMs:15_000,waitMs:1200});
        const values={};
        for (const mint of [...mints].slice(0,10)) {
          let heldRaw=null;
          try {
            const accounts=await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet),{mint:new PublicKey(mint)},'finalized');
            heldRaw=accounts.value.reduce((sum,row)=>sum+BigInt(row.account.data.parsed.info.tokenAmount.amount),0n).toString();
          } catch { /* Keep purchases, but do not invent holdings or P&L. */ }
          values[mint]=communityTradeMetrics({history,mint,heldRaw,priceSol:markets[mint]?.priceSol,priceAt:markets[mint]?.observedAt,now:now()});
        }
        return values;
      })().catch(()=>({})).then(values=>{
        if(cache.size>=250)cache.delete(cache.keys().next().value);
        cache.set(wallet,{at:now(),values});
      }).finally(()=>pending.delete(wallet));
      pending.set(wallet,task);
    }
    let timer;
    try {await Promise.race([Promise.all([...pending.values()]),new Promise(resolve=>{timer=setTimeout(resolve,1200);})]);}
    finally {clearTimeout(timer);}
    return Object.fromEntries(rows.map(row=>{
      const cached=cache.get(row.author);
      return [row.id,cached&&now()-cached.at<120_000?cached.values[row.mint]||null:null];
    }));
  };
}
