import {escapeHtml as esc} from '../shared/display.js';

export function agencyTokenLink(row){
  const label=row.symbol?'$'+row.symbol.replace(/^\$/,''):row.name||'Symbol unavailable',mint=String(row.mint||'');
  return `<a class="text-link agency-token-link" data-logo-mint="${esc(mint)}" href="/token/${encodeURIComponent(mint)}"><span class="agency-token-logo" aria-hidden="true">${esc(label.replace(/^\$/,'').slice(0,2).toUpperCase())}</span><span>${esc(label)}</span></a>`;
}
