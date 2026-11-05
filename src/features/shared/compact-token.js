import { isDevnetImageUri } from '../../../devnet-metadata.js';

export function updateCompactTokenLink(link, { mint, launch = null, showMarketCap = true }, document = globalThis.document) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '')) return;
  const item = document.defaultView?.fundedVerifiedSearchCandidates?.(mint)?.find(row => row.mint === mint && !row.type);
  const symbol = item?.symbol || launch?.symbol || `${mint.slice(0,4)}…${mint.slice(-4)}`;
  const imageUri = item?.imageUri || launch?.imageUri;
  const key = JSON.stringify([mint,symbol,imageUri,showMarketCap]);
  link.classList.add('compact-token-link');link.href = `/token/${encodeURIComponent(mint)}`;
  link.title = `Open ${symbol} · ${mint}`;
  if (link.dataset.tokenKey !== key) {
    link.replaceChildren();link.dataset.tokenKey = key;
    const avatar = document.createElement('span');avatar.className = 'compact-token-logo';avatar.textContent = symbol.slice(0,2);avatar.setAttribute('aria-hidden','true');
    const identity = document.createElement('span');identity.className = 'compact-token-identity';
    const name = document.createElement('strong');name.textContent = symbol;
    const detail = document.createElement('small');detail.textContent = showMarketCap ? 'Current MC · —' : 'Paying coin';
    identity.append(name,detail);link.append(avatar,identity);
    if (isDevnetImageUri(imageUri,mint)) {
      const image = document.createElement('img');image.alt = '';image.loading = 'eager';image.decoding = 'async';
      image.addEventListener('load',()=>{if(link.dataset.tokenKey===key)avatar.replaceChildren(image);});
      image.src = imageUri;
    }
  }
  if(showMarketCap)link.querySelector('small').textContent = `Current MC · ${item?.marketCap || '—'}`;
}
