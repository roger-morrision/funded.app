// Token pages for tokens launched outside Richpad (other launchpads, DEX pools).
// The page is built around Richpad's Pump curve; when a token has no Richpad
// launch, no curve and no PumpSwap pool, hide curve-only facts and show DEX
// market data plus links to trade it where it actually trades.
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isExternalToken({ launch, market, mint, richMint }) {
  if (!MINT.test(String(mint || '')) || mint === richMint || launch) return false;
  return market?.complete == null && !market?.migrated;
}

export function formatUsd(value) {
  const n = value == null || value === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) return '$—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toPrecision(3)}`;
  return '$0';
}

export function tradeLinks(mint) {
  const id = encodeURIComponent(mint);
  return [
    ['Jupiter', `https://jup.ag/swap/SOL-${id}`],
    ['Raydium', `https://raydium.io/swap/?inputMint=sol&outputMint=${id}`],
  ];
}

export function explainStatus(data) {
  if (data?.status === 'unsupported-cluster') return 'DEX prices are only available on Mainnet. This Devnet token shows on-chain facts only.';
  if (data?.status === 'no-pools') return 'No DEX pool found for this token yet.';
  if (data?.status === 'available') return null;
  return 'DEX market data is unavailable right now. Use Refresh to retry.';
}

function link(document, label, href, className = 'secondary-button') {
  const a = document.createElement('a');
  a.className = className; a.textContent = label; a.href = href;
  a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

function fact(document, label, value) {
  const item = document.createElement('div');
  const term = document.createElement('span'); term.textContent = label;
  const strong = document.createElement('strong'); strong.textContent = value;
  item.append(term, strong);
  return item;
}

export function mountExternalTokenMode(app, document = globalThis.document) {
  const page = document.getElementById('coin-page');
  if (!page || document.getElementById('coin-external-panel')) return Boolean(page);
  const panel = document.createElement('section');
  panel.id = 'coin-external-panel'; panel.className = 'coin-external-panel panel'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'coin-external-title');
  const summary = document.getElementById('coin-summary-dashboard');
  if (summary) summary.after(panel); else page.prepend(panel);
  const tradeNote = document.createElement('div');
  tradeNote.id = 'coin-external-trade'; tradeNote.className = 'coin-external-trade'; tradeNote.hidden = true;
  document.getElementById('trade-panel')?.prepend(tradeNote);

  let facts = null, active = null, load = 0, applied = null;
  const richMint = () => app.PROTOCOL_FUNDED_MINT || app.fundedMint || app.richMint || '';
  const reset = () => {
    active = null; applied = null; load++;
    document.body.classList.remove('coin-external');
    panel.hidden = true; panel.replaceChildren(); tradeNote.hidden = true; tradeNote.replaceChildren();
  };
  const setText = (selector, value) => { const node = document.querySelector(selector); if (node && value != null) node.textContent = value; };
  const applyHeader = () => {
    const m = applied?.market; if (!m) return;
    setText('#coin-price', formatUsd(m.priceUsd));
    setText('#coin-market-cap', formatUsd(m.marketCapUsd));
    setText('#coin-strip-market-cap', formatUsd(m.marketCapUsd));
    setText('#coin-strip-volume', formatUsd(m.volume24hUsd));
    setText('#coin-strip-trades', String(m.trades24h ?? '—'));
    setText('#coin-change', m.priceChange24h == null ? '24h —' : `24h ${m.priceChange24h > 0 ? '+' : ''}${m.priceChange24h.toFixed(2)}%`);
    if (m.name && /Unnamed on-chain token/.test(document.getElementById('coin-page-title')?.textContent || '')) {
      setText('#coin-page-title', m.name); setText('#coin-symbol', m.symbol); setText('#coin-artwork-symbol', m.symbol);
      document.title = `${m.name} · richpad.fun`;
    }
    const avatar = document.getElementById('coin-avatar');
    if (avatar && m.imageUrl && !avatar.style.backgroundImage) {
      avatar.textContent = '';
      avatar.style.backgroundImage = `url("${m.imageUrl.replace(/"/g, '%22')}")`;
      avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center';
    }
  };
  const render = (mint, data) => {
    const message = explainStatus(data), m = data?.market;
    const head = document.createElement('header');
    head.innerHTML = '<div><p class="eyebrow">External token</p><h2 id="coin-external-title">Launched outside Richpad</h2></div>';
    const body = document.createElement('div'); body.className = 'coin-external-body';
    if (m) {
      const grid = document.createElement('div'); grid.className = 'coin-external-facts';
      grid.append(
        fact(document, 'Price', formatUsd(m.priceUsd)),
        fact(document, 'Market cap', formatUsd(m.marketCapUsd)),
        fact(document, 'Liquidity', formatUsd(m.liquidityUsd)),
        fact(document, '24h volume', formatUsd(m.volume24hUsd)),
        fact(document, 'Main pool', `${m.dex || 'DEX'}${m.quoteSymbol ? ` · ${m.quoteSymbol}` : ''}${m.poolCount > 1 ? ` · ${m.poolCount} pools` : ''}`),
      );
      body.append(grid);
    }
    const note = document.createElement('p'); note.className = 'field-help';
    note.textContent = message || `Market data from ${data.source}, refreshed every minute. Richpad holder payouts, curve and boosts apply only to Richpad launches.`;
    body.append(note);
    const actions = document.createElement('nav'); actions.className = 'coin-external-actions'; actions.setAttribute('aria-label', 'Trade this token elsewhere');
    for (const [label, href] of tradeLinks(mint)) actions.append(link(document, `Trade on ${label}`, href));
    if (m?.pairUrl) actions.append(link(document, 'Chart on DexScreener', m.pairUrl));
    const list = document.createElement('a'); list.className = 'text-button'; list.textContent = 'List this token on Richpad →'; list.href = '#list';
    list.addEventListener('click', () => { try { sessionStorage.setItem('richpad.list.mint', mint); } catch { /* optional */ } });
    actions.append(list);
    body.append(actions);
    panel.replaceChildren(head, body); panel.hidden = false;

    const tradeHead = document.createElement('p');
    tradeHead.textContent = 'This token trades outside Richpad. Use one of these swaps:';
    const tradeActions = document.createElement('div'); tradeActions.className = 'coin-external-actions';
    for (const [label, href] of tradeLinks(mint)) tradeActions.append(link(document, label, href, 'primary-button'));
    tradeNote.replaceChildren(tradeHead, tradeActions); tradeNote.hidden = false;
    applyHeader();
  };
  const activate = async mint => {
    if (active === mint) return;
    active = mint; const id = ++load;
    document.body.classList.add('coin-external');
    let data;
    try { data = (await app.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/external-market`, { signal: AbortSignal.timeout(12000) })).data; }
    catch { data = { status: 'error' }; }
    if (id !== load || active !== mint) return;
    applied = data; render(mint, data);
  };

  globalThis.addEventListener?.('funded:coin-facts-loading', reset);
  globalThis.addEventListener?.('funded:coin-facts', event => { facts = event.detail || null; });
  globalThis.addEventListener?.('funded:coin-market-facts', event => {
    const detail = event.detail || {};
    const mint = detail.mint || facts?.mint;
    if (!facts || facts.mint !== mint) return;
    if (isExternalToken({ launch: facts.launch, market: detail.market, mint, richMint: richMint() })) void activate(mint);
    else if (active) reset();
  });
  globalThis.addEventListener?.('funded:route-change', () => { if (!location.pathname.startsWith('/token/')) reset(); });
  // Later refreshes rewrite header numbers from the Pump curve snapshot ($—); restore DEX values.
  for (const id of ['coin-price', 'coin-market-cap', 'coin-strip-volume']) {
    const node = document.getElementById(id);
    if (node) new MutationObserver(() => { if (applied?.market && /\$—|—/.test(node.textContent)) applyHeader(); }).observe(node, { childList: true, characterData: true, subtree: true });
  }
  return true;
}
