const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function walletDetailHref(address) {
  return typeof address === 'string' && ADDRESS.test(address) ? `/wallet/${encodeURIComponent(address)}` : null;
}

// Use the renderer's known wallet, never guess from arbitrary page text:
// token mints and transaction signatures have different destinations.
export function linkWalletText(node, address) {
  const href = walletDetailHref(address);
  if (!node || !href) return;
  if (node.tagName === 'A') {
    node.setAttribute('href', href);
    node.removeAttribute('target');
    node.removeAttribute('rel');
    node.title = `View wallet ${address}`;
    return;
  }
  if (node.closest?.('a,button,input,select,textarea') || node.querySelector?.('a')) return;
  const text = node.textContent || '';
  const label = text.includes(address) ? address : [...text.matchAll(/[1-9A-HJ-NP-Za-km-z]{3,12}(?:…|\.{3})[1-9A-HJ-NP-Za-km-z]{3,12}/g)]
    .map(match => match[0]).find(value => {
      const [first, last] = value.split(/…|\.{3}/);
      return address.startsWith(first) && address.endsWith(last);
    });
  if (!label || !node.ownerDocument?.createElement) return;
  const index = text.indexOf(label), link = node.ownerDocument.createElement('a');
  link.className = 'wallet-address-link';
  link.href = href;
  link.title = `View wallet ${address}`;
  link.textContent = label;
  node.replaceChildren(text.slice(0, index), link, text.slice(index + label.length));
}

export function walletAddressMarkup(address, label = address) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const href = walletDetailHref(address);
  return href ? `<a class="wallet-address-link" href="${href}" title="View wallet ${escape(address)}">${escape(label)}</a>` : escape(label);
}
