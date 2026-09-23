// Presentation-only copy cleanup. Network verification remains enabled in the
// data layer; this removes implementation-oriented confirmation labels from UI copy.
const replacements = [
  [/Only confirmed Solana RPC data is shown\. No estimates, simulated activity, or unverified launches\./gi, 'Live network data is shown here.'],
  [/Confirmed Solana RPC/gi, 'Network'],
  [/confirmed Solana RPC/gi, 'network'],
  [/Solana RPC/gi, 'network data'],
  [/RPC verified/gi, 'Live data'],
  [/RPC confirmed/gi, 'Data available'],
  [/confirmed RPC/gi, 'network'],
  [/confirmed Devnet/gi, 'Devnet'],
  [/confirmed Pump/gi, 'Pump'],
  [/confirmed mints?/gi, 'mints'],
  [/confirmed launches?/gi, 'launches'],
  [/confirmed creator records/gi, 'creator records'],
  [/confirmed fee claims?/gi, 'fee claims'],
  [/confirmed payout receipts?/gi, 'payout receipts'],
  [/confirmed payouts?/gi, 'payouts'],
  [/confirmed transaction/gi, 'transaction'],
  [/verified Solana launches?/gi, 'Solana launches'],
  [/verified launches?/gi, 'launches'],
  [/verified creator activity/gi, 'creator activity'],
  [/verified creator records/gi, 'creator records'],
  [/verified payout receipts?/gi, 'payout receipts'],
  [/verified payouts?/gi, 'payouts'],
  [/verified activity/gi, 'activity'],
  [/unverified launches?/gi, 'launches'],
  [/on-chain only/gi, 'network data'],
  [/on-chain activity/gi, 'network activity'],
  [/on-chain data/gi, 'network data'],
  [/on-chain explorer/gi, 'network explorer'],
  [/Waiting for RPC/gi, 'Waiting for network data'],
  [/awaiting verification/gi, 'awaiting data'],
  [/Awaiting RPC/gi, 'Awaiting data'],
];

const implementationLabelPattern = /\b(?:RPC|Devnet|Solana|confirmed|verified|verification|indexer|indexed|network data|live data|on-chain|preview|not live)\b/i;
const implementationLabelSelector = [
  '.data-badge',
  '.panel-count',
  '.section-state',
  '.route-guide-state',
  '#route-guide-description',
  '.topbar-context small',
  '.eyebrow',
  '.panel-explainer',
  '.source-note',
  '.panel-footnote',
  '.unavailable-note',
  '.referral-kpi-grid small',
  '.analytics-kpis small',
  '.chart-labels',
  '.split-detail',
  '.creator-launch-source',
  '.network-lock',
  '#claim-wallet-state',
  '.airdrop-kpis small',
  '.airdrop-trust',
  '.buyback-kpis small',
  '.buyback-preview-status',
  '.home-live-footnote',
  '.leaderboard-disclaimer',
  '.leaderboard-availability',
  '.explore-lede',
  '.explore-compare-note',
  '.scanner-note',
  '.coin-description',
  '.wallet-detail-intro',
  '.coin-pulse-note',
  '.chart-footer',
  '.ticker-note',
  '.coin-trade-toolbar > span',
  '.coin-hero-stat small',
  '.coin-summary-strip small',
  '.policy-route small',
  '.home-live-metrics small',
  '.asset-status-badge',
  '.asset-risk > span',
  '.empty-state',
  '.preview-status-drawer',
  '.home-signal-stat small',
  '.timeline-row small',
  '.route-timeline li:last-child small',
  '.explore-hero-stat > span',
  '.explore-hero-stat small',
  '.live-label',
  '.trend',
  '.preview-chip',
  '.wallet-detail-facts > div',
  '.onchain-snapshot > div',
].join(',');

function clean(value) {
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function hideImplementationLabels(root) {
  if (!root) return;
  const labels = [];
  if (root.matches?.(implementationLabelSelector)) labels.push(root);
  root.querySelectorAll?.(implementationLabelSelector).forEach(element => labels.push(element));
  labels.forEach(element => {
    // Empty states carry the explanation for missing data. Keep them visible even
    // when their truthful copy mentions verification, indexing, or the network.
    if (element.matches('.empty-state')) return;
    if (!implementationLabelPattern.test(element.textContent || '')) return;
    element.hidden = true;
    element.style.setProperty('display', 'none', 'important');
    element.setAttribute('aria-hidden', 'true');
  });
}

function sanitize(root) {
  if (!root) return;
  hideImplementationLabels(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);
  textNodes.forEach(textNode => {
    const next = clean(textNode.nodeValue || '');
    if (next !== textNode.nodeValue) textNode.nodeValue = next;
  });
  root.querySelectorAll?.('[aria-label], [title], [placeholder]').forEach(element => {
    for (const attribute of ['aria-label', 'title', 'placeholder']) {
      if (element.hasAttribute(attribute)) {
        const next = clean(element.getAttribute(attribute));
        if (next !== element.getAttribute(attribute)) element.setAttribute(attribute, next);
      }
    }
  });
  hideImplementationLabels(root);
}

sanitize(document.body);
const observer = new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) sanitize(node);
      else if (node.nodeType === Node.TEXT_NODE) node.nodeValue = clean(node.nodeValue || '');
    });
    if (mutation.type === 'characterData' && mutation.target.nodeValue) {
      const next = clean(mutation.target.nodeValue);
      if (next !== mutation.target.nodeValue) mutation.target.nodeValue = next;
      hideImplementationLabels(mutation.target.parentElement);
    }
  });
});
observer.observe(document.body, { childList: true, characterData: true, subtree: true });
