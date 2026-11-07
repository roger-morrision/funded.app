import {escapeHtml as esc} from '../shared/display.js';
import {formatTokenBaseUnits} from '../../../funded-burn.js';

export function burnTimestamp(receipt,launch=null) {
  // Atomic launch burns occurred in the launch transaction. Never substitute
  // verification/indexing time for the actual burn time.
  const seconds=receipt.blockTime ?? (receipt.atomicWithPumpLaunch?launch?.blockTime:null);
  const time=Number.isSafeInteger(seconds)&&seconds>0?seconds*1000:Date.parse(receipt.burnedAt||'');
  return Number.isFinite(time)&&time>0?new Date(time).toISOString():null;
}

export function burnHistoryTable({feeReceipts,launchBurns,standaloneReceipts,exploreExplorer,fundedReceiptProject}) {
  const records=[
    ...feeReceipts.map(receipt=>({receipt,at:burnTimestamp(receipt),type:'Fee buyback',project:'$FUNDED',
      amount:formatTokenBaseUnits(BigInt(receipt.burnedBaseUnits||receipt.boughtAndBurnedBaseUnits||'0'),Number(receipt.tokenDecimals??6),6),
      spent:formatTokenBaseUnits(receipt.spentLamports!=null?BigInt(receipt.spentLamports):BigInt(receipt.settledLamports||'0')-BigInt(receipt.returnedLamports||'0'),9,9),status:'Finalized'})),
    ...launchBurns.map(launch=>({receipt:launch.creatorLaunchBurn.receipt,at:burnTimestamp(launch.creatorLaunchBurn.receipt,launch),
      type:`Launch · ${launch.creatorLaunchBurn.label||launch.creatorLaunchBurn.tier}`,project:launch.symbol||'Token',mint:launch.mint,
      amount:String(launch.creatorLaunchBurn.receipt.amountTokens??launch.creatorLaunchBurn.amountTokens),spent:null,status:'Verified'})),
    ...standaloneReceipts.map(receipt=>({receipt,at:burnTimestamp(receipt),type:'Token burn',project:fundedReceiptProject(receipt),
      amount:String(receipt.amountTokens),spent:null,status:'Verified'})),
  ];
  const seen=new Set();
  const rows=records.filter(row=>{
    const signature=row.receipt.signature;
    if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature||'')||seen.has(signature))return false;
    seen.add(signature);return true;
  }).sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
  if(!rows.length)return '';
  return `<div class="data-table-scroll burn-history-scroll" role="region" aria-label="Burn history table, scroll horizontally for all columns" tabindex="0"><table class="record-table burn-history-table"><caption>Verified burns · newest first · times in UTC</caption><thead><tr>${['Date & time (UTC)','Activity','Project','Burned ($FUNDED)','Spent (SOL)','Status','Transaction'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td>${row.at?`<time datetime="${row.at}">${row.at.slice(0,10)}<small>${row.at.slice(11,19)} UTC</small></time>`:'<span title="Transaction block time was not recorded">Time unavailable</span>'}</td><td>${esc(row.type)}</td><td>${row.mint?`<a class="text-link" href="/token/${encodeURIComponent(row.mint)}">${esc(row.project)}</a>`:esc(row.project)}</td><td class="numeric burn-amount">${esc(Number(row.amount).toLocaleString('en-US',{maximumFractionDigits:6}))}</td><td class="numeric">${row.spent===null?'—':esc(row.spent)}</td><td><span class="record-status">${row.status}</span></td><td><a class="receipt-link" href="${esc(exploreExplorer(`tx/${encodeURIComponent(row.receipt.signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="View ${esc(row.project)} burn transaction ${esc(row.receipt.signature)}">View receipt ↗</a></td></tr>`).join('')}</tbody></table></div>`;
}
