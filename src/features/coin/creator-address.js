import { coinMintFromLocation } from './header-hold.js';

// Token header: "Creator <short wallet> ⧉" next to the token address, from the
// creator recorded on the coin's Pump curve. Hidden when no creator is known.
const short = address => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function mountCreatorAddress(app, document = globalThis.document) {
  const tokenLine = document.querySelector('#coin-page .coin-address');
  if (!tokenLine || document.getElementById('coin-creator-address')) return Boolean(tokenLine);
  const box = document.createElement('span');
  box.id = 'coin-creator-address'; box.className = 'coin-creator-address'; box.hidden = true;
  box.innerHTML = '<small>Creator</small><a class="wallet-address-link" data-creator-link></a><button type="button" class="copy-inline" data-creator-copy aria-label="Copy creator wallet address">⧉</button>';
  tokenLine.append(box);
  const link = box.querySelector('[data-creator-link]'), copy = box.querySelector('[data-creator-copy]');
  let serial = 0, creator = '';
  copy.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    try { await navigator.clipboard.writeText(creator); app.showToast?.('Creator wallet copied'); } catch { app.showToast?.('Copy is unavailable in this browser.'); }
  });
  const load = async () => {
    const id = ++serial, mint = coinMintFromLocation();
    box.hidden = true; creator = '';
    if (!mint) return;
    const result = await app.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/creator`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
    const address = result?.available && result.data?.mint === mint ? String(result.data.creator || '') : '';
    if (id !== serial || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return;
    creator = address;
    link.textContent = short(address); link.title = `Creator wallet ${address}`; link.href = `/wallet/${encodeURIComponent(address)}`;
    box.hidden = false;
  };
  globalThis.addEventListener?.('funded:coin-facts-loading', load);
  if (coinMintFromLocation()) void load();
  return true;
}
