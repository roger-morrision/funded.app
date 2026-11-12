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
const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt', 'aria-valuetext'];

export function mainnetWording(text) {
  if (!NEEDS.test(text)) return text;
  return RULES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text).replace(/ {2,}/g, ' ');
}

export function installMainnetWording(document = globalThis.document) {
  if (!document?.body || document.documentElement.dataset.mainnetWording) return;
  document.documentElement.dataset.mainnetWording = 'on';
  const fixText = node => { const next = mainnetWording(node.nodeValue || ''); if (next !== node.nodeValue) node.nodeValue = next; };
  const fixElement = element => {
    for (const name of ATTRIBUTES) { const value = element.getAttribute?.(name); if (value && NEEDS.test(value)) element.setAttribute(name, mainnetWording(value)); }
  };
  const sweep = root => {
    if (root.nodeType === 3) return fixText(root);
    if (root.nodeType !== 1 || root.closest?.('script,style,textarea,input,code,pre')) return;
    fixElement(root);
    const walker = document.createTreeWalker(root, 5, { acceptNode: node => node.nodeType === 1
      ? (/^(SCRIPT|STYLE|TEXTAREA|CODE|PRE)$/.test(node.nodeName) ? 2 : 3) : (NEEDS.test(node.nodeValue || '') ? 1 : 3) });
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
