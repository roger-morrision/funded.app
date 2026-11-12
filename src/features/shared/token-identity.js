// Token symbol and logo for any mint, batched through the cached market route,
// plus a page-wide pass that turns shortened mint links into logo + $SYMBOL.
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const identities = new Map(), tried = new Map(), queue = new Set();
let flushTimer = null, solUsd = { value: null, at: 0, loading: null };
const request = (path, timeoutMs) => fetch(path, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
  .then(response => response.ok ? response.json() : null).catch(() => null);

export function tokenIdentity(mint) { return identities.get(mint) || null; }
export function rememberTokenIdentity(mint, row) {
  if (!MINT.test(mint || '') || !row?.symbol) return;
  identities.set(mint, { symbol: String(row.symbol).slice(0, 20), name: row.name || null, logoUri: /^https:\/\//.test(row.logoUri || row.imageUri || '') ? (row.logoUri || row.imageUri) : null });
}
export function requestTokenIdentities(mints) {
  for (const mint of mints || []) if (MINT.test(mint || '') && !identities.has(mint) && !(Date.now() - (tried.get(mint) || 0) < 120_000)) queue.add(mint);
  if (!queue.size || flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    const batch = [...queue].slice(0, 50); batch.forEach(mint => { queue.delete(mint); tried.set(mint, Date.now()); });
    const data = await request(`/api/tokens/market?mints=${batch.join(',')}`, 10_000);
    for (const row of data?.items || []) rememberTokenIdentity(row.mint, row);
    globalThis.dispatchEvent?.(new CustomEvent('funded:token-identities', { detail: { mints: batch } }));
    if (queue.size) requestTokenIdentities([]);
  }, 60);
}
// Current SOL/USD for display, refreshed at most once a minute.
export function solUsdPrice() {
  if (Date.now() - solUsd.at > 60_000 && !solUsd.loading) solUsd.loading = request('/api/market/sol-usd', 6_000).then(data => {
    const price = Number(data?.priceUsd ?? data?.data?.priceUsd); if (price > 0) solUsd.value = price; solUsd.at = Date.now();
    globalThis.dispatchEvent?.(new CustomEvent('funded:token-identities', { detail: { mints: [] } }));
  }).finally(() => { solUsd.loading = null; });
  return solUsd.value;
}

export function tokenIdentityMarkup(mint, escapeHtml, fallback) {
  const identity = tokenIdentity(mint);
  if (!identity) { requestTokenIdentities([mint]); return escapeHtml(fallback); }
  const logo = identity.logoUri ? `<img class="token-identity-logo" src="${escapeHtml(identity.logoUri)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<span class="token-identity">${logo}<span>$${escapeHtml(identity.symbol)}</span></span>`;
}

// Links to /token/<mint> whose text is the mint (full or shortened) show the token instead.
const looksLikeMint = (text, mint) => { const value = text.trim(); return value === mint || (value.length <= 24 && /…|\.\.\./.test(value)
  && mint.startsWith(value.split(/…|\.\.\./)[0]) && mint.endsWith(value.split(/…|\.\.\./).pop())); };
export function installTokenIdentityLinks(document = globalThis.document) {
  if (!document?.body || document.documentElement.dataset.tokenIdentityLinks) return;
  document.documentElement.dataset.tokenIdentityLinks = 'on';
  const upgrade = root => {
    const links = root.matches?.('a[href*="/token/"]') ? [root] : [...(root.querySelectorAll?.('a[href*="/token/"]') || [])];
    const pending = [];
    for (const link of links) {
      if (link.dataset.tokenIdentity === 'done' || link.children.length) continue;
      const mint = (link.getAttribute('href') || '').match(/\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1];
      if (!mint || !looksLikeMint(link.textContent || '', mint)) continue;
      const identity = tokenIdentity(mint);
      if (!identity) { pending.push(mint); continue; }
      link.dataset.tokenIdentity = 'done'; link.title ||= mint;
      link.textContent = '';
      if (identity.logoUri) { const image = document.createElement('img'); image.className = 'token-identity-logo'; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.src = identity.logoUri; image.addEventListener('error', () => image.remove(), { once: true }); link.append(image); }
      link.append(`$${identity.symbol}`); link.classList.add('token-identity');
    }
    if (pending.length) requestTokenIdentities(pending);
  };
  upgrade(document.body);
  globalThis.addEventListener?.('funded:token-identities', () => upgrade(document.body));
  new MutationObserver(records => { for (const record of records) record.addedNodes.forEach(node => { if (node.nodeType === 1) upgrade(node); }); })
    .observe(document.body, { subtree: true, childList: true });
}
