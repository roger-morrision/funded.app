import { activeBoostMultiplier, activeBoostPackages } from './boost-offer.js';

const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function boostPackageBadgesMarkup(boost, now = Date.now()) {
  const multiplier = activeBoostMultiplier(boost, now);
  if (!multiplier) return '';
  const packages = activeBoostPackages(boost, now);
  const nextExpiry = packages.length
    ? Math.min(...packages.map(pack => Date.parse(pack.expiresAt)))
    : Date.parse(boost.nextExpiry || boost.expiresAt);
  const label = `${multiplier}x`;
  const title = `${label} total active boost · next expiry ${new Date(nextExpiry).toLocaleString()}`;
  return `<span class="boost-package-badges" aria-label="Active boost: ${label}"><span class="boost-package-badge" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">⚡${label}</span></span>`;
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
