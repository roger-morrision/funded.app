import { BOOST_PACKAGES, activeBoostPackages } from './boost-offer.js';

const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function boostPackageBadgesMarkup(boost, now = Date.now()) {
  const groups = new Map();
  for (const pack of activeBoostPackages(boost, now)) {
    const group = groups.get(pack.packageId) || { multiplier: pack.multiplier, count: 0, nextExpiry: pack.expiresAt };
    group.count += 1;
    if (Date.parse(pack.expiresAt) < Date.parse(group.nextExpiry)) group.nextExpiry = pack.expiresAt;
    groups.set(pack.packageId, group);
  }
  // Older preview APIs return only an active aggregate. One payment has an
  // unambiguous pack; stacked payments need receipt details to name each pack.
  if (!Array.isArray(boost?.packages) && boost?.count === 1 && Date.parse(boost.expiresAt) > now) {
    const pack = BOOST_PACKAGES.find(item => item.multiplier === boost.multiplier);
    if (pack) groups.set(pack.id, { multiplier: pack.multiplier, count: 1, nextExpiry: boost.expiresAt });
  }
  if (!groups.size) return '';
  return `<span class="boost-package-badges" aria-label="Active paid boost packages">${[...groups.values()].map(group => {
    const label = `${group.multiplier}x`;
    const title = `${group.count} verified active ${label} boost payment${group.count === 1 ? '' : 's'} · next expiry ${new Date(group.nextExpiry).toLocaleString()}`;
    return `<span class="boost-package-badge" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">⚡${label}${group.count > 1 ? `<small>×${group.count}</small>` : ''}</span>`;
  }).join('')}</span>`;
}

const extraCards = [
  ['.home-reward-token-card[data-reward-mint]', card => card.dataset.rewardMint, card => card.querySelector('.home-reward-token-identity')],
  ['.claim-card[data-logo-mint]', card => card.dataset.logoMint, card => card.querySelector('.claim-token > div')],
  ['.reward-discovery-list article', card => mintFromTokenLink(card), card => card.querySelector('.reward-token-identity')],
  ['.reward-portfolio-list article', card => mintFromTokenLink(card), card => card.querySelector('.reward-row-head')],
  ['.creator-coin-card[data-coin-mint]', card => card.dataset.coinMint, card => card],
];

function mintFromTokenLink(card) {
  const path = card.querySelector('a[href^="/token/"]')?.getAttribute('href') || '';
  try { return decodeURIComponent(path.slice('/token/'.length).split(/[?#]/, 1)[0]); }
  catch { return ''; }
}

let activeByMint = {};
let observer;

function decorateCard(card, mint, target) {
  if (!target || !mintPattern.test(String(mint || ''))) return;
  const badge = boostPackageBadgesMarkup(activeByMint[mint]);
  const existing = card.querySelector(':scope .card-boost-packages');
  if (!badge) { existing?.remove(); return; }
  if (existing?.innerHTML === badge) return;
  const holder = existing || document.createElement('span');
  holder.className = 'card-boost-packages';
  holder.innerHTML = badge;
  if (!existing) target.append(holder);
}

export function decorateSupplementalBoostCards(root = document) {
  for (const [selector, mintOf, targetOf] of extraCards) {
    const cards = root.matches?.(selector) ? [root] : root.querySelectorAll?.(selector) || [];
    for (const card of cards) decorateCard(card, mintOf(card), targetOf(card));
  }
}

export function setCardBoostSnapshot(boosts) {
  activeByMint = boosts && typeof boosts === 'object' ? boosts : {};
  if (typeof document !== 'undefined') decorateSupplementalBoostCards();
}

export function observeSupplementalBoostCards() {
  if (observer || typeof document === 'undefined' || !document.body) return;
  observer = new MutationObserver(mutations => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (node.nodeType === 1) decorateSupplementalBoostCards(node);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  decorateSupplementalBoostCards();
}
