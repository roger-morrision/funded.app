import { isDevnetImageUri, isDevnetBannerUri } from '../../../devnet-metadata.js';

// Signed uploads are already stored by the app. Their public IPFS publication
// remains unchanged; rendering need not wait for a third-party gateway.
export function tokenArtworkUrl(mint, uri, kind = 'image', cluster = import.meta.env?.VITE_SOLANA_CLUSTER || 'devnet') {
  if (cluster !== 'devnet' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '')) return uri || '';
  const trusted = kind === 'banner' ? isDevnetBannerUri(uri, mint) : isDevnetImageUri(uri, mint);
  return trusted ? `/devnet-${kind === 'banner' ? 'banners' : 'images'}/${encodeURIComponent(mint)}` : uri || '';
}

const requests = new WeakMap();
const waiting = new Set();
let observer;
let cleanupObserver;
function start(avatar) {
  const task = requests.get(avatar);
  if (!task || task.started || !avatar.isConnected) return;
  task.started = true;
  const image = new Image();
  image.alt = ''; image.decoding = 'async';
  let timer;
  const finish = () => { clearTimeout(timer); image.onload = null; image.onerror = null; };
  image.onload = () => {
    finish();
    if (requests.get(avatar) === task && avatar.isConnected) avatar.replaceChildren(image);
  };
  image.onerror = () => { finish(); if (requests.get(avatar) === task) requests.delete(avatar); };
  timer = setTimeout(() => { finish(); image.removeAttribute('src'); if(requests.get(avatar) === task) requests.delete(avatar); }, 4000);
  image.src = task.url;
}

export function loadTokenArtwork(avatar, mint, uri) {
  if (!avatar || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '')) return;
  const url = tokenArtworkUrl(mint, uri) || `/devnet-images/${encodeURIComponent(mint)}`;
  if (requests.get(avatar)?.url === url) return;
  requests.set(avatar, {url, started:false});
  if (!globalThis.IntersectionObserver) { start(avatar); return; }
  if (!cleanupObserver && document.body) {
    cleanupObserver = new MutationObserver(records => {
      for (const record of records) for (const removed of record.removedNodes) {
        if (removed.nodeType !== 1) continue;
        for (const node of waiting) if (!node.isConnected && removed.contains(node)) { observer?.unobserve(node); waiting.delete(node); }
      }
    });
    cleanupObserver.observe(document.body, {subtree:true, childList:true});
  }
  observer ||= new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); waiting.delete(entry.target); start(entry.target); }
  }, {rootMargin:'200px'});
  waiting.add(avatar); observer.observe(avatar);
}
