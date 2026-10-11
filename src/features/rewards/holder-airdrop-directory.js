import { directoryPage, holderRewardGroups } from './airdrop-discovery-model.js';
import { devnetImageUri } from '../../../devnet-metadata.js';

let latest;
let active = 'upcoming';
let page = 1;
const element = (tag, className, text) => {
  const item = document.createElement(tag);
  item.className = className;
  if (text != null) item.textContent = text;
  return item;
};
const sol = raw => {
  if (!/^\d+$/.test(String(raw))) return 'Unavailable';
  const value = BigInt(raw);
  const fraction = String(value % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
  return `${value / 1_000_000_000n}${fraction ? '.' + fraction : ''} SOL`;
};

export function mountHolderAirdropDirectory(after) {
  if (!after || document.querySelector('#holder-airdrop-programs')) return;
  const section = element('section', 'airdrop-public-programs holder-airdrop-programs');
  section.id = 'holder-airdrop-programs';
  section.innerHTML = `<header class="airdrop-directory-heading"><div><p class="eyebrow">Coin holder rewards</p><h2>Airdrop for launched coin holders</h2><p>SOL from creator fees, delivered automatically to eligible holders.</p></div><span class="airdrop-asset-label">SOL REWARDS</span></header>
    <div class="airdrop-discovery-toolbar"><div class="airdrop-reference-tabs" role="tablist" aria-label="Coin holder reward status">
    <button type="button" id="holder-upcoming-tab" role="tab" aria-selected="true" aria-controls="holder-airdrop-list" data-holder-airdrop-tab="upcoming">Upcoming <span>—</span></button>
    <button type="button" id="holder-distributed-tab" role="tab" aria-selected="false" tabindex="-1" aria-controls="holder-airdrop-list" data-holder-airdrop-tab="distributed">Distributed <span>—</span></button></div>
    <input id="holder-airdrop-search" type="search" aria-label="Search launched coin holder rewards" placeholder="Search name, ticker, or address" /></div>
    <p class="airdrop-stage-help" id="holder-airdrop-note"></p><div id="holder-airdrop-list" role="tabpanel" aria-labelledby="holder-upcoming-tab"></div>
    <nav class="airdrop-directory-pagination" aria-label="Coin holder reward pages"><button type="button" data-holder-page="prev">‹ Prev</button><span role="status" data-holder-range></span><button type="button" data-holder-page="next">Next ›</button></nav>`;
  after.after(section);
  const select = value => { active = value; page = 1; renderHolderAirdropDirectory(latest); };
  section.addEventListener('click', event => {
    const tab = event.target.closest('[data-holder-airdrop-tab]');
    if (tab) select(tab.dataset.holderAirdropTab);
    const pager = event.target.closest('[data-holder-page]');
    if (pager && !pager.disabled) { page += pager.dataset.holderPage === 'next' ? 1 : -1; renderHolderAirdropDirectory(latest); }
  });
  section.addEventListener('keydown', event => {
    if (!event.target.matches('[data-holder-airdrop-tab]') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    select(event.key === 'Home' ? 'upcoming' : event.key === 'End' ? 'distributed' : active === 'upcoming' ? 'distributed' : 'upcoming');
    section.querySelector(`[data-holder-airdrop-tab="${active}"]`).focus();
  });
  section.querySelector('input').addEventListener('input', () => { page = 1; renderHolderAirdropDirectory(latest); });
  renderHolderAirdropDirectory(latest);
}

export function renderHolderAirdropDirectory(data) {
  latest = data;
  const root = document.querySelector('#holder-airdrop-programs');
  if (!root) return;
  const groups = holderRewardGroups(data);
  for (const button of root.querySelectorAll('[data-holder-airdrop-tab]')) {
    const selected = button.dataset.holderAirdropTab === active;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    button.querySelector('span').textContent = groups.available ? `${groups.partial ? '≥' : ''}${groups[button.dataset.holderAirdropTab].length}` : '—';
  }
  root.querySelector('#holder-airdrop-note').textContent = groups.partial
    ? 'Partial receipt coverage. Upcoming means no payment is confirmed in the available records.'
    : active === 'upcoming' ? 'Published fee-sharing policies awaiting their first confirmed holder payout. Timing depends on funding and an eligible snapshot.'
    : 'Projects with confirmed holder payouts. Further distributions may still be upcoming.';
  const result = directoryPage(groups[active], root.querySelector('input').value, page);
  page = result.page;
  const list = root.querySelector('#holder-airdrop-list'); list.replaceChildren();
  list.setAttribute('aria-labelledby', `holder-${active}-tab`);
  for (const row of result.rows) {
    const article = element('article', 'holder-airdrop-row');
    const identity = element('div', 'holder-airdrop-identity');
    const avatar = element('span', 'claim-token-mark', String(row.symbol || '?').slice(0,2));
    avatar.setAttribute('aria-hidden', 'true');
    const image = element('img', ''); image.alt = ''; image.loading = 'lazy';
    image.src = `/devnet-images/${encodeURIComponent(row.mint)}`;
    let fallback = false;
    image.addEventListener('error', () => {
      if (!fallback) { fallback = true; image.src = devnetImageUri(row.mint); }
      else image.remove();
    });
    avatar.append(image);
    const info = element('div', 'holder-airdrop-info');
    const link = element('a', '', `${row.symbol || 'TOKEN'} · ${row.name || 'Unnamed token'}`);
    link.href = `/token/${encodeURIComponent(row.mint)}`;
    info.append(link, element('small', '', `${row.holderSharePercent}% creator fee share · ${String(row.mint).slice(0,4)}…${String(row.mint).slice(-4)}`));
    identity.append(avatar, info);
    const amount = element('div', 'holder-airdrop-amount');
    amount.append(element('small', '', active === 'distributed' ? 'Confirmed paid' : 'Fees allocated'), element('strong', '', `${groups.partial ? '≥' : ''}${sol(active === 'distributed' ? row.holderPaidLamports : row.totals?.holder)}`));
    if (active === 'distributed') amount.append(element('small', '', `${row.holderPaidWallets} paid wallets`));
    const status = element('span', `airdrop-status ${active === 'distributed' ? 'claiming' : 'upcoming'}`, active === 'distributed' ? 'Distributed' : 'Awaiting payout');
    const action = element('a', 'holder-airdrop-link', 'View rewards →'); action.href = link.href;
    article.append(identity, amount, status, action); list.append(article);
  }
  if (!result.rows.length) list.append(element('div', 'empty-state', !groups.available
    ? data === undefined ? 'Checking holder rewards…' : 'Holder rewards are temporarily unavailable.'
    : root.querySelector('input').value ? 'No rewards match your search.' : active === 'distributed' ? 'No confirmed holder payouts yet.' : 'No upcoming holder rewards.'));
  root.querySelector('[data-holder-range]').textContent = `${result.range} · page ${page} / ${result.pages}`;
  root.querySelector('[data-holder-page="prev"]').disabled = page <= 1;
  root.querySelector('[data-holder-page="next"]').disabled = page >= result.pages;
}
