import {escapeHtml} from '../shared/display.js';

export function boostHistoryTable(rows,{state,explorer}) {
  if(!rows.length)return `<p class="field-help">${state==='loading'?'Loading payment history…':state==='unavailable'?'Payment history is unavailable. Reopen this window to try again.':'No boost purchases yet.'}</p>`;
  const date=value=>Number.isFinite(Date.parse(value))?escapeHtml(new Date(value).toLocaleString()):'—';
  const amount=value=>Number.isSafeInteger(value)&&value>=0?(value/1e9).toFixed(9):'—';
  return `<div class="records-table-wrap" role="region" aria-label="Boost payment history" tabindex="0"><table class="records-table"><thead><tr><th scope="col">Package</th><th scope="col">Paid SOL</th><th scope="col">Status</th><th scope="col">Expires</th><th scope="col">Receipt</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${escapeHtml(row.packageId)}</strong></td><td class="numeric">${row.pending?'—':amount(row.lamports)}</td><td>${escapeHtml(row.state)}${row.pending?'<small>Check this payment before buying again.</small>':''}</td><td>${date(row.expiresAt)}</td><td><a href="${escapeHtml(explorer(`tx/${encodeURIComponent(row.signature)}`))}" target="_blank" rel="noopener noreferrer">${row.pending?'View transaction':'View receipt'} ↗</a></td></tr>`).join('')}</tbody></table></div>`;
}
