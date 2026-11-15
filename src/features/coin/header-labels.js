import { apiRequest } from '../../../client.js';

// Token page header: "Paid listing" and the selected launch promotion beside
// the symbol (after the pair chip), as text-only pills. Listings are read once
// per page session from /api/listings.
let listings = null;
const loadListings = () => listings ||= apiRequest('/api/listings', { signal: AbortSignal.timeout(10000) })
  .then(result => new Map((result.data?.listings || []).filter(row => row?.status === 'listed').map(row => [row.mint, row])))
  .catch(() => { listings = null; return new Map(); });

export function renderCoinHeaderLabels(mint, { promotionLabel = '', getCoinMintAddress, document = globalThis.document } = {}) {
  const draw = listed => {
    if (getCoinMintAddress && getCoinMintAddress() !== mint) return;
    const symbol = document.querySelector('#coin-symbol');
    if (!symbol) return;
    let holder = document.querySelector('#coin-header-labels');
    if (!holder) {
      holder = document.createElement('span');
      holder.id = 'coin-header-labels';
      holder.className = 'coin-header-labels';
      symbol.after(holder);
    }
    holder.replaceChildren();
    const pill = (text, kind) => { const node = document.createElement('span'); node.className = `coin-header-label is-${kind}`; node.textContent = text; holder.append(node); };
    if (promotionLabel) pill(promotionLabel, 'promotion');
    if (listed) pill('Paid listing', 'listed');
    holder.hidden = !holder.childElementCount;
  };
  draw(listings && typeof listings.then !== 'function' ? listings.has(mint) : false);
  void loadListings().then(map => draw(map.has(mint)));
}
