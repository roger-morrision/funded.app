import {escapeHtml as esc} from '../shared/display.js';
import {formatTokenBaseUnits} from '../../../funded-burn.js';
const units=value=>typeof value==='string'&&/^(0|[1-9]\d{0,19})$/.test(value);
const sol=value=>units(value)?formatTokenBaseUnits(value,9,9):'—';
export function buybackProgressTable(data,launches=[]){
  const dashboard=data?.dashboard,threshold=dashboard?.thresholdLamports;
  const rows=new Map(launches.map(row=>[row.mint,{...row,status:'unavailable'}]));
  for(const vault of [...(dashboard?.vaults||[]),...(dashboard?.unindexedVaults||[])]){
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(vault.mint))continue;
    rows.set(vault.mint,{...rows.get(vault.mint),...vault});
  }
  const exact=row=>row.status==='verified'&&!row.discrepancy&&units(row.pendingLamports);
  const sorted=[...rows.values()].sort((a,b)=>Number(exact(b)?b.pendingLamports:-1)-Number(exact(a)?a.pendingLamports:-1));
  const complete=dashboard?.status==='verified'&&units(dashboard.collectedLamports)&&units(threshold)&&BigInt(threshold)>0n;
  const percent=value=>units(threshold)&&BigInt(threshold)>0n?Number(BigInt(value)*10000n/BigInt(threshold))/100:null;
  const total=complete?percent(dashboard.collectedLamports):null;
  return `<h2>$RICH buyback &amp; burn progress</h2><p>${complete?`${sol(dashboard.collectedLamports)} / ${sol(threshold)} SOL · ${total.toFixed(2)}% of the shared funding threshold`:'Current buyback balances are awaiting verification.'}</p><p class="field-help">The funding threshold combines eligible contributions across coins. Agency milestone buybacks above use separate budgets.</p>${!sorted.length?'<p>No registered tokens are available yet.</p>':`<div class="data-table-scroll" role="region" aria-label="Buyback funding by token" tabindex="0"><table class="record-table"><thead><tr><th>Token</th><th>Verified SOL</th><th>Share of funding threshold</th><th>Status</th></tr></thead><tbody>${sorted.map(row=>{const value=exact(row)?percent(row.pendingLamports):null;return `<tr><td><a href="/token/${encodeURIComponent(row.mint)}">${esc(row.symbol?'$'+row.symbol.replace(/^\$/,''):row.name&&row.name!==row.mint?row.name:'Symbol unavailable')}</a></td><td>${exact(row)?sol(row.pendingLamports):'—'}</td><td>${value===null?'—':value.toFixed(2)+'%'}</td><td>${!exact(row)?'Awaiting verification':BigInt(row.pendingLamports)===0n?'No funds accumulated':value>=100?'Funding threshold reached':value>=80?'Near funding threshold':'Accumulating'}</td></tr>`;}).join('')}</tbody></table></div>`}`;
}
