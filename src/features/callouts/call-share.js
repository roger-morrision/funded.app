import { apiRequest } from '../../../client.js';

// Figures for a call card or share banner, from the call's recorded market cap
// (SOL), the current market cap and the caller's held share of supply.
export function callFigures({ calledCapSol, currentCapSol, holdingPercent, solUsd }) {
  const usd = Number(solUsd) > 0 ? Number(solUsd) : null;
  const called = Number(calledCapSol) > 0 ? Number(calledCapSol) : null, current = Number(currentCapSol) > 0 ? Number(currentCapSol) : null;
  const share = Number(holdingPercent) > 0 ? Number(holdingPercent) / 100 : null;
  const multiple = called && current ? current / called : null;
  return {
    multiple, changePercent: multiple ? (multiple - 1) * 100 : null,
    calledCapUsd: called && usd ? called * usd : null, currentCapUsd: current && usd ? current * usd : null,
    holdUsd: share && current && usd ? share * current * usd : null,
    holdChangeUsd: share && current && called && usd ? share * (current - called) * usd : null,
  };
}
export const usdShort = value => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value), sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs >= 1 ? abs.toFixed(2) : abs.toPrecision(2)}`;
};
export const signedUsd = value => Number.isFinite(value) ? `${value >= 0 ? '+' : '-'}${usdShort(Math.abs(value))}` : '—';
export const multipleBadge = multiple => Number.isFinite(multiple) && multiple > 0 ? `${multiple >= 10 ? multiple.toFixed(0) : multiple.toFixed(1)}x` : '';

const loadImage = src => new Promise(resolve => {
  const image = new Image(); image.crossOrigin = 'anonymous';
  const timer = setTimeout(() => resolve(null), 5000);
  image.onload = () => { clearTimeout(timer); resolve(image); };
  image.onerror = () => { clearTimeout(timer); resolve(null); };
  image.src = src;
});

export function callShareText({ symbol, text, figures, own }) {
  const ticker = symbol ? `$${String(symbol).replace(/^\$/, '')}` : 'this coin';
  const quote = String(text || '').trim().slice(0, 110);
  const move = Number.isFinite(figures.changePercent) ? ` → now ${usdShort(figures.currentCapUsd)} (${figures.changePercent >= 0 ? '+' : ''}${figures.changePercent.toFixed(1)}%)` : '';
  return `📣 ${own ? 'My call' : 'Call'} on ${ticker}${quote ? `: "${quote}"` : ''}\nCalled at ${usdShort(figures.calledCapUsd)} MC${move}\nTrack it on richpad.fun 👇`;
}

// Open the share dialog for a call: banner, prefilled post and every channel.
export async function openCallShare({ call, solUsd, wallet, referralCode = '', callerLabel = '' }) {
  const mint = call?.mint;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '')) return;
  let symbol = call.token?.symbol || call.symbol || '';
  if (!symbol) symbol = (await apiRequest(`/api/tokens/market?mints=${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(6000) }).catch(() => null))?.data?.items?.[0]?.symbol || '';
  const figures = callFigures({ calledCapSol: call.calledMarketCapSol, currentCapSol: call.currentMarketCapSol, holdingPercent: call.holdingPercent, solUsd });
  const logoImage = await loadImage(`${location.origin}/api/tokens/${encodeURIComponent(mint)}/logo`);
  const own = Boolean(wallet && call.author === wallet);
  const url = new URL(`/token/${encodeURIComponent(mint)}`, location.origin);
  if (referralCode) url.searchParams.set('ref', referralCode);
  const { initShareComposer, openShareComposer } = await import('../../../share-tools.js');
  initShareComposer();
  openShareComposer({ kind: 'callout', title: own ? 'Share your call' : 'Share this call', network: 'Solana', url: url.toString(),
    text: callShareText({ symbol, text: call.text, figures, own }),
    result: { kind: 'callout', verified: true, mint, symbol, text: call.text, logoImage, figures, referralCode,
      caller: callerLabel || `${String(call.author).slice(0, 4)}…${String(call.author).slice(-4)}`, createdAt: call.createdAt } });
}
