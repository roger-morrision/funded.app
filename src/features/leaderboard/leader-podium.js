import { escapeHtml } from '../shared/display.js';

// Top 3 of every leaderboard view stand on the shared gold/silver/bronze podium;
// the table below keeps ranks 4+.
const MEDALS = ['Gold', 'Silver', 'Bronze'];
const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>';
const hue = text => [...String(text)].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 360, 7);

function podiumContainer(table) {
  const document = table.ownerDocument;
  let podium = document.getElementById('leaderboard-podium');
  if (!podium) {
    podium = document.createElement('ol');
    podium.id = 'leaderboard-podium';
    podium.className = 'bonus-podium leaderboard-podium';
    podium.setAttribute('aria-label', 'Top 3');
    table.before(podium);
  }
  return podium;
}

export function clearLeaderPodium(table) {
  const podium = table.ownerDocument.getElementById('leaderboard-podium');
  if (podium) { podium.hidden = true; podium.replaceChildren(); delete podium.dataset.signature; }
}

/**
 * @param {Element} table
 * @param {Array<{href:string,initials:string,hueKey?:string,mint?:string,name:string,sub?:string,value:string,valueSub?:string,proofHref?:string,proofLabel?:string,isYou?:boolean}>} entries top entries in rank order
 */
export function renderLeaderPodium(table, entries, { label = 'Top 3' } = {}) {
  const podium = podiumContainer(table);
  podium.setAttribute('aria-label', label);
  podium.hidden = false;
  const html = [0, 1, 2].map(index => {
    const item = entries[index], place = index + 1, medal = MEDALS[index];
    const crown = place === 1 ? `<span class="bonus-podium-crown">${CROWN}</span>` : '';
    const block = `<span class="bonus-podium-block">${medal}</span>`;
    if (!item) {
      return `<li class="bonus-podium-step is-open" data-place="${place}">${crown}<span class="bonus-podium-avatar">?</span><span class="bonus-podium-medal" title="${medal} medal">${place}</span><span class="bonus-podium-wallet">Open spot</span><strong class="bonus-podium-amount">—</strong>${block}</li>`;
    }
    const logo = item.mint ? ` data-logo-mint="${escapeHtml(item.mint)}"` : '';
    const proof = item.proofHref
      ? `<a class="bonus-podium-proof" href="${escapeHtml(item.proofHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.proofLabel || 'Proof ↗')}</a>` : '';
    return `<li class="bonus-podium-step${item.isYou ? ' is-you' : ''}" data-place="${place}"${logo}${item.isYou ? ' aria-current="true"' : ''}>${crown}`
      + `<span class="bonus-podium-avatar${item.mint ? ' leader-token-logo' : ''}" style="--avatar-hue:${hue(item.hueKey || item.name)}" aria-hidden="true">${escapeHtml(item.initials)}</span>`
      + `<span class="bonus-podium-medal" title="${medal} medal">${place}</span>`
      + `<a class="bonus-podium-wallet" href="${escapeHtml(item.href)}" title="${escapeHtml(item.name)}" aria-label="${medal}, rank ${place}: ${escapeHtml(item.name)}">${escapeHtml(item.name)}</a>`
      + (item.sub ? `<small class="bonus-podium-note">${escapeHtml(item.sub)}</small>` : '')
      + `<strong class="bonus-podium-amount">${escapeHtml(item.value)}</strong>`
      + (item.valueSub ? `<small class="bonus-podium-note">${escapeHtml(item.valueSub)}</small>` : '')
      + (item.isYou ? '<small class="bonus-podium-you">You</small>' : '')
      + proof + block + '</li>';
  }).join('');
  // Feed refreshes re-render often; leave an unchanged podium (and its loaded logos) alone.
  if (podium.dataset.signature !== html) { podium.dataset.signature = html; podium.innerHTML = html; }
  // The rise animation plays on the first podium only, not on every tab switch or refresh.
  if (!podium.dataset.podiumSettled) podium.ownerDocument.defaultView?.setTimeout(() => { podium.dataset.podiumSettled = 'true'; }, 1200);
  return podium;
}

// Table body for ranks 4+, or a quiet note when every ranked entry is on the podium.
export function restRowsOrNote(rows, count) {
  return rows || (count ? `<div class="empty-state leaderboard-rest-note" role="row"><div role="cell" aria-colspan="5"><span>All ${count} ranked ${count === 1 ? 'entry is' : 'entries are'} on the podium. Ranks 4+ appear here.</span></div></div>` : '');
}
