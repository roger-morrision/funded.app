import {escapeHtml as esc} from '../shared/display.js';
import {formatTokenBaseUnits} from '../../../funded-burn.js';

const amount=value=>/^(0|[1-9]\d{0,19})$/.test(String(value))?formatTokenBaseUnits(value,9,9):'—';
export function agencyTokenTable(data) {
  const rows=Array.isArray(data?.launches)?data.launches.filter(row=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)):[];
  if(!rows.length)return '<p class="reward-empty">No agency token records are available for the current deployment.</p>';
  const names={'x-promotion':'X promotion','buyback-100k':'Buyback 1','buyback-300k':'Buyback 2'};
  return `<p class="reward-source-note">${rows.length} registered tokens · amounts require a fresh verified snapshot. X promotion ${data.publishingPaused?'is paused':'requires verified delivery'}.</p><div class="data-table-scroll" role="region" aria-label="Agency tokens, scroll horizontally for all columns" tabindex="0"><table class="record-table agency-token-table"><caption>Token budgets and execution status</caption><thead><tr>${['Token','Selected agents','Funded (SOL)','Spent (SOL)','Remaining (SOL)','Status','Checked (UTC)'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>{
    const ready=data.status==='deployment-verified'&&row.status==='worker-verified-snapshot';
    const exact=ready&&/^(0|[1-9]\d{0,19})$/.test(row.paidLamports)&&/^(0|[1-9]\d{0,19})$/.test(row.spentLamports)&&BigInt(row.paidLamports)>=BigInt(row.spentLamports);
    const selected=Array.isArray(row.selectedAgents)&&row.selectedAgents.length?row.selectedAgents.map(id=>names[id]||id).join(', '):Number.isInteger(row.selectedMask)?[row.selectedMask&1?'X promotion':'',row.selectedMask&2?'Buyback 1':'',row.selectedMask&4?'Buyback 2':''].filter(Boolean).join(', '):'Not recorded';
    const time=Date.parse(row.checkedAt);
    const status=!ready?'Awaiting fresh snapshot':row.completedMask===row.selectedMask?'Actions completed':exact&&BigInt(row.paidLamports)===0n?'Awaiting funding':'Waiting for execution checks';
    return `<tr><td><a class="text-link" href="/token/${encodeURIComponent(row.mint)}">${esc(row.symbol||row.name||row.mint.slice(0,6)+'…'+row.mint.slice(-4))}</a></td><td>${esc(selected)}</td><td class="numeric">${exact?amount(row.paidLamports):'—'}</td><td class="numeric">${exact?amount(row.spentLamports):'—'}</td><td class="numeric">${exact?amount(String(BigInt(row.paidLamports)-BigInt(row.spentLamports))):'—'}</td><td>${esc(status)}</td><td>${ready&&Number.isFinite(time)?`<time datetime="${new Date(time).toISOString()}">${new Date(time).toISOString().slice(0,16).replace('T',' ')}</time>`:'—'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
