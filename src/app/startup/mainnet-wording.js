// Mainnet builds share copy with the Devnet app. Rewrite Devnet / test-funds
// wording wherever it reaches the page (static HTML, rendered views, server
// messages, tooltips) so Mainnet visitors only see Mainnet language.
const RULES = [
  [/\s*(?:Test SOL|Test funds|Test tokens|Devnet SOL|It) (?:has|have) no monetary value\.?/gi, ''],
  [/\s*·?\s*Devnet test value,? not real money/gi, ''],
  [/\s*Test SOL is available only on Devnet\.?/gi, ''],
  [/\bSolana Devnet test SOL\b/g, 'SOL'],
  [/\bDevnet test SOL\b/gi, 'SOL'],
  [/\btest SOL\b/gi, 'SOL'],
  [/\bDevnet test (assets|tokens|funds)\b/gi, '$1'],
  [/\btest (?:funds|assets)\b/gi, 'funds'],
  [/\s*·\s*Devnet QA\b/g, ''], [/\bDevnet QA\b/g, ''],
  [/\s*\((?:Solana )?Devnet\)/g, ''],
  [/\s+(?:on|for|in) (?:Solana )?Devnet\b/g, ' on Solana'],
  [/\bSolana Devnet\b/g, 'Solana'],
  [/\s*·\s*Devnet\b/g, ''],
  [/\bDevnet\s+/g, ''],
  [/\bDevnet\b/g, 'Solana'],
];
const NEEDS = /devnet|test sol|test funds|test tokens|test assets|monetary value|test value/i;
// Program-only facts (fee vaults, automatic buybacks, reserve funding, settlement
// receipts) cannot exist without the Richpad programs, so their "unavailable"
// placeholders are hidden on Mainnet instead of shown as failures.
const HIDE = [
  [/Observed trade history or USD quote unavailable/, '.home-kpi-card'],
  [/Confirmed claim totals unavailable/, '.home-kpi-card, #airdrop-summary-kpis > article'],
  [/Funding verification unavailable or incomplete/, '#airdrop-summary-kpis > article'],
  [/Verified buyback receipts unavailable/, 'a.proof-total'],
  [/Current buyback rules are unavailable|Eligible vault or trigger verification|Trigger unavailable/, '#buyback-route-panel'],
  [/automatic execution readiness could not be verified/, 'p'],
  [/Earlier receipt history is unavailable/, 'p, small, div'],
  [/^\s*(?:Supply|Burn history) unavailable\s*$/, 'span'],
];
const HIDE_NEEDS = /unavailable|could not be verified/i;
const hideFor = node => {
  const text = node.nodeValue || '';
  if (!HIDE_NEEDS.test(text)) return;
  for (const [pattern, selector] of HIDE) if (pattern.test(text)) {
    const box = node.parentElement?.closest(selector);
    if (box && !box.matches('main, section[id], body')) { box.hidden = true; box.style.setProperty('display', 'none', 'important'); box.dataset.mainnetHidden = 'program-only'; }
    else if (box?.id === 'buyback-route-panel') box.style.setProperty('display', 'none', 'important');
    return;
  }
};
const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt', 'aria-valuetext'];

export function mainnetWording(text) {
  if (!NEEDS.test(text)) return text;
  return RULES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text).replace(/ {2,}/g, ' ');
}

export function installMainnetWording(document = globalThis.document) {
  if (!document?.body || document.documentElement.dataset.mainnetWording) return;
  document.documentElement.dataset.mainnetWording = 'on';
  const fixText = node => { const next = mainnetWording(node.nodeValue || ''); if (next !== node.nodeValue) node.nodeValue = next; hideFor(node); };
  const fixElement = element => {
    for (const name of ATTRIBUTES) { const value = element.getAttribute?.(name); if (value && NEEDS.test(value)) element.setAttribute(name, mainnetWording(value)); }
  };
  const sweep = root => {
    if (root.nodeType === 3) return fixText(root);
    if (root.nodeType !== 1 || root.closest?.('script,style,textarea,input,code,pre')) return;
    fixElement(root);
    const walker = document.createTreeWalker(root, 5, { acceptNode: node => node.nodeType === 1
      ? (/^(SCRIPT|STYLE|TEXTAREA|CODE|PRE)$/.test(node.nodeName) ? 2 : 3) : (NEEDS.test(node.nodeValue || '') || HIDE_NEEDS.test(node.nodeValue || '') ? 1 : 3) });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeType === 3 ? fixText(node) : fixElement(node);
    root.querySelectorAll?.('[title],[aria-label],[placeholder],[alt]').forEach(fixElement);
  };
  sweep(document.body);
  if (NEEDS.test(document.title)) document.title = mainnetWording(document.title);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') fixText(record.target);
      else if (record.type === 'attributes') fixElement(record.target);
      else record.addedNodes.forEach(sweep);
    }
    if (NEEDS.test(document.title)) document.title = mainnetWording(document.title);
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
}
