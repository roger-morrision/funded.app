const CHANNELS = new Set(['x', 'telegram', 'whatsapp', 'facebook', 'linkedin', 'reddit']);
let activeShare = null;

export function channelShareUrl(channel, url, text) {
  const link = encodeURIComponent(url);
  const message = encodeURIComponent(text);
  switch (channel) {
    case 'x': return `https://x.com/intent/post?text=${message}&url=${link}`;
    case 'telegram': return `https://t.me/share/url?url=${link}&text=${message}`;
    case 'whatsapp': return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
    case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${link}`;
    case 'linkedin': return `https://www.linkedin.com/sharing/share-offsite/?url=${link}`;
    case 'reddit': return `https://www.reddit.com/submit?url=${link}&title=${message}`;
    default: throw new Error('Unsupported share channel');
  }
}

export function taggedShareUrl(input, channel) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A web link is required');
  if (channel && CHANNELS.has(channel)) url.searchParams.set('src', channel);
  return url.toString();
}

function cleanText(value, max = 280) { return String(value || '').trim().slice(0, max); }
function shareUrl(channel = '') { return taggedShareUrl(activeShare.url, channel); }
function shareText() { return cleanText(document.querySelector('#share-message')?.value, 280); }
function status(message) { const node = document.querySelector('#share-status'); if (node) node.textContent = message; }

async function copyText(value, message) {
  try { await navigator.clipboard.writeText(value); status(message); return true; }
  catch { status(`Copy unavailable. Select the link above: ${value}`); return false; }
}

function roundedRect(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect !== 'function') { ctx.fillRect(x, y, width, height); return; }
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
}

export function drawEarningsCard(canvas, result, { hideAmount = false, hideWallet = true } = {}) {
  if (!result || result.verified !== true || !Number.isFinite(result.amount) || result.amount <= 0 || !result.receipt) throw new Error('A verified paid receipt is required');
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image creation is unavailable');
  const gradient = ctx.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, '#101a34'); gradient.addColorStop(1, '#123c42');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = '#66e4c6'; ctx.font = '700 32px sans-serif'; ctx.fillText('richpad.fun', 72, 82);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 58px sans-serif'; ctx.fillText('Paid referral earnings', 72, 200);
  ctx.font = '700 88px sans-serif'; ctx.fillText(hideAmount ? 'Amount hidden' : `${result.amount.toFixed(4)} ${result.asset || 'SOL'}`, 72, 336);
  ctx.fillStyle = '#bbd3d5'; ctx.font = '30px sans-serif';
  ctx.fillText(`${result.network || 'Solana'} · paid receipt · ${result.period || 'All time'}`, 72, 395);
  if (!hideWallet && result.wallet) ctx.fillText(`Wallet ${result.wallet.slice(0, 6)}…${result.wallet.slice(-6)}`, 72, 447);
  ctx.fillStyle = '#214f56'; roundedRect(ctx, 72, 500, 1056, 74, 14);
  ctx.fillStyle = '#d5f8ee'; ctx.font = '25px sans-serif'; ctx.fillText(`Receipt ${result.receipt.slice(0, 14)}…  ·  Verify in richpad.fun`, 95, 548);
  return canvas;
}

export function drawTradeCard(canvas, result, { hideWallet = true } = {}) {
  if (!result || result.verified !== true || !['buy', 'sell'].includes(result.side) || !result.receipt || !result.mint) throw new Error('A verified trade receipt is required');
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image creation is unavailable');
  const gradient = ctx.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, '#101a34'); gradient.addColorStop(1, '#123c42');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = '#66e4c6'; ctx.font = '700 32px sans-serif'; ctx.fillText('richpad.fun', 72, 82);
  // Token identity: logo (when it loaded with CORS) or a letter mark, then the action and symbol.
  const symbol = String(result.tokenSymbol || 'TOKEN').replace(/^\$/, '').slice(0, 14);
  if (result.logoImage) { ctx.save(); roundedRect(ctx, 72, 128, 136, 136, 24); ctx.clip(); ctx.drawImage(result.logoImage, 72, 128, 136, 136); ctx.restore(); }
  else { ctx.fillStyle = '#25485a'; roundedRect(ctx, 72, 128, 136, 136, 24); ctx.fillStyle = '#ffffff'; ctx.font = '700 64px sans-serif'; ctx.fillText(symbol.slice(0, 1).toUpperCase(), 118, 220); }
  ctx.fillStyle = '#ffffff'; ctx.font = '700 76px sans-serif'; ctx.fillText(`${result.side === 'buy' ? 'Bought' : 'Sold'} $${symbol}`, 240, 222);
  const number = (value, digits) => Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
  const stats = [
    ['Quantity', Number.isFinite(result.tokenAmount) ? `${number(result.tokenAmount, result.tokenAmount >= 100 ? 2 : 6)} ${symbol}` : '—', '#ffffff'],
    [result.side === 'buy' ? 'SOL spent' : 'SOL received', Number.isFinite(result.solAmount) ? `${number(result.solAmount, 4)} SOL` : '—', '#ffffff'],
    ['P&L', Number.isFinite(result.pnlSol) ? `${result.pnlSol >= 0 ? '+' : ''}${number(result.pnlSol, 4)} SOL${Number.isFinite(result.pnlPercent) ? ` (${result.pnlPercent >= 0 ? '+' : ''}${result.pnlPercent.toFixed(1)}%)` : ''}` : result.side === 'buy' ? 'Open position' : '—',
      Number.isFinite(result.pnlSol) ? (result.pnlSol >= 0 ? '#5ff0a8' : '#ff8a96') : '#bbd3d5'],
  ];
  stats.forEach(([label, value, color], index) => {
    const x = 72 + index * 360;
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; roundedRect(ctx, x, 304, 336, 150, 18);
    ctx.fillStyle = '#9fc3c7'; ctx.font = '600 24px sans-serif'; ctx.fillText(label, x + 26, 350);
    ctx.fillStyle = color; ctx.font = `700 ${value.length > 16 ? 30 : 38}px sans-serif`; ctx.fillText(value.slice(0, 26), x + 26, 412);
  });
  if (!hideWallet && result.wallet) { ctx.fillStyle = '#bbd3d5'; ctx.font = '24px sans-serif'; ctx.fillText(`Wallet ${result.wallet.slice(0, 6)}…${result.wallet.slice(-6)}`, 72, 488); }
  ctx.fillStyle = '#214f56'; roundedRect(ctx, 72, 510, 1056, 74, 14);
  ctx.fillStyle = '#d5f8ee'; ctx.font = '25px sans-serif'; ctx.fillText(`Receipt ${result.receipt.slice(0, 14)}…  ·  richpad.fun/token/${result.mint.slice(0, 6)}…`, 95, 558);
  return canvas;
}

export function drawRoundTripCard(canvas, result, { hideAmount = false, hideWallet = true } = {}) {
  if (!result || result.verified !== true || result.accountHistoryVerified !== true || !result.buyReceipt || !result.receipt || !result.mint
    || !/^[1-9]\d*$/.test(String(result.netLamports || ''))) throw new Error('A positive closed-position proof is required');
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image creation is unavailable');
  const gradient = ctx.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, '#101a34'); gradient.addColorStop(1, '#123c42');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = '#66e4c6'; ctx.font = '700 32px sans-serif'; ctx.fillText('richpad.fun', 72, 82);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 55px sans-serif'; ctx.fillText('Closed trade · Solana', 72, 190);
  const lamports = BigInt(result.netLamports);
  const fractional = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  const amount = `${lamports / 1_000_000_000n}${fractional ? `.${fractional}` : ''}`;
  ctx.font = '700 80px sans-serif'; ctx.fillText(hideAmount ? 'Amount hidden' : `+${amount} SOL`, 72, 315);
  ctx.fillStyle = '#bbd3d5'; ctx.font = '27px sans-serif';
  ctx.fillText('Wallet SOL change across the buy and sell receipts', 72, 385);
  if (!hideWallet && result.wallet) ctx.fillText(`Wallet ${result.wallet.slice(0, 6)}…${result.wallet.slice(-6)}`, 72, 430);
  ctx.fillStyle = '#214f56'; roundedRect(ctx, 72, 500, 1056, 74, 14);
  ctx.fillStyle = '#d5f8ee'; ctx.font = '23px sans-serif'; ctx.fillText(`Buy ${result.buyReceipt.slice(0, 10)}… · Sell ${result.receipt.slice(0, 10)}… · Includes all SOL movements`, 95, 548);
  return canvas;
}

export function drawLaunchCard(canvas, result) {
  if(result?.verified!==true || result.kind!=='launch' || !result.mint || !result.receipt) throw new Error('A confirmed launch receipt is required');
  canvas.width=1200;canvas.height=630;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image creation is unavailable');
  ctx.fillStyle='#101426';ctx.fillRect(0,0,1200,630);
  ctx.fillStyle='#ffc46b';ctx.font='700 32px sans-serif';ctx.fillText('richpad.fun · New community',64,80);
  ctx.fillStyle='#fff';ctx.font='700 54px sans-serif';ctx.fillText(String(result.name||'New coin').slice(0,32),64,210,1072);
  ctx.font='700 72px sans-serif';ctx.fillText('$'+String(result.symbol||'TOKEN').slice(0,10),64,315);
  ctx.fillStyle='#c4ccdc';ctx.font='28px sans-serif';ctx.fillText('Explore the coin. Meet its community. Check the receipts.',64,400);
  ctx.fillText(result.network==='devnet'?'SOLANA DEVNET · TEST FUNDS · NO MONETARY VALUE':'SOLANA · Check network and fee policy',64,470);
  ctx.font='23px monospace';ctx.fillText(result.mint,64,545,1072);
  return canvas;
}

// Listing banner: wide (1200x630, X/Facebook/LinkedIn/Telegram previews) or
// square (1080x1080, Instagram/WhatsApp/Telegram posts).
const usdCompact = value => Number.isFinite(value) && value > 0
  ? (value >= 1 ? '$' + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value) : '$' + Number(value.toPrecision(3)).toString()) : '—';
export function drawListingCard(canvas, result, { format = 'wide' } = {}) {
  if (result?.verified !== true || result.kind !== 'listing' || !result.mint) throw new Error('A verified listing is required');
  const square = format === 'square', W = square ? 1080 : 1200, H = square ? 1080 : 630;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image creation is unavailable');
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0d1424'); bg.addColorStop(0.6, '#10213a'); bg.addColorStop(1, '#0f3b3a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.15, 10, W * 0.85, H * 0.15, W * 0.55); glow.addColorStop(0, 'rgba(245,185,0,0.28)'); glow.addColorStop(1, 'rgba(245,185,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  const pad = 64, symbol = String(result.symbol || 'TOKEN').replace(/^\$/, '').slice(0, 12), name = String(result.name || symbol).slice(0, 28);
  ctx.fillStyle = '#f5b900'; ctx.font = '800 34px sans-serif'; ctx.fillText('richpad.fun', pad, 86);
  ctx.font = '800 22px sans-serif'; const tag = String(result.tag || 'NEWLY LISTED').toUpperCase().slice(0, 22), tagW = ctx.measureText(tag).width + 40;
  ctx.fillStyle = '#5ff0a8'; roundedRect(ctx, W - pad - tagW, 52, tagW, 46, 23); ctx.fillStyle = '#062b1c'; ctx.fillText(tag, W - pad - tagW + 20, 83);
  const logoSize = square ? 220 : 180, logoX = pad, logoY = square ? 170 : 150;
  ctx.save(); ctx.fillStyle = '#25485a'; roundedRect(ctx, logoX, logoY, logoSize, logoSize, 36); ctx.clip();
  if (result.logoImage) ctx.drawImage(result.logoImage, logoX, logoY, logoSize, logoSize);
  else { ctx.fillStyle = '#ffffff'; ctx.font = `800 ${Math.round(logoSize * 0.5)}px sans-serif`; ctx.fillText(symbol.slice(0, 1).toUpperCase(), logoX + logoSize * 0.3, logoY + logoSize * 0.68); }
  ctx.restore();
  const textX = square ? pad : logoX + logoSize + 40, nameY = square ? logoY + logoSize + 90 : logoY + 70, maxText = W - textX - pad;
  ctx.fillStyle = '#ffffff'; ctx.font = `800 ${square ? 68 : 58}px sans-serif`; ctx.fillText(name, textX, nameY, maxText);
  ctx.fillStyle = '#f5b900'; ctx.font = `800 ${square ? 84 : 72}px sans-serif`; ctx.fillText('$' + symbol, textX, nameY + (square ? 96 : 84), maxText);
  const stats = [['Price', usdCompact(result.priceUsd)], ['Market cap', usdCompact(result.marketCapUsd)], ['24h volume', usdCompact(result.volume24hUsd)]];
  const statY = square ? nameY + 150 : 400, gap = 20, boxW = (W - pad * 2 - gap * 2) / 3, boxH = square ? 150 : 110;
  if (stats.every(([, value]) => value === '—')) {
    ctx.fillStyle = '#c4ccdc'; ctx.font = `600 ${square ? 36 : 32}px sans-serif`;
    const lines = String(result.tagline || 'Fresh on Solana · join the community early').split('\n').slice(0, 2);
    lines.forEach((line, index) => ctx.fillText(line, pad, statY + 48 + index * (square ? 54 : 46), W - pad * 2));
  } else stats.forEach(([label, value], index) => {
    const x = pad + index * (boxW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundedRect(ctx, x, statY, boxW, boxH, 18);
    ctx.fillStyle = '#9fc3c7'; ctx.font = '600 22px sans-serif'; ctx.fillText(label, x + 24, statY + 40);
    ctx.fillStyle = '#ffffff'; ctx.font = `800 ${square ? 44 : 38}px sans-serif`; ctx.fillText(value, x + 24, statY + (square ? 104 : 88), boxW - 48);
  });
  const barY = H - (square ? 150 : 96);
  ctx.fillStyle = '#f5b900'; roundedRect(ctx, pad, barY, W - pad * 2, square ? 96 : 60, 14);
  ctx.fillStyle = '#111111'; ctx.font = `800 ${square ? 32 : 26}px sans-serif`;
  ctx.fillText('Live chart · trades · holders on richpad.fun', pad + 26, barY + (square ? 60 : 40), W - pad * 2 - 52);
  ctx.fillStyle = '#c4ccdc'; ctx.font = '22px monospace'; ctx.fillText(`CA ${result.mint}`, pad, H - (square ? 26 : 16), W - pad * 2);
  return canvas;
}
export function drawReferralCard(canvas, result, { format = 'wide' } = {}) {
  if (result?.kind !== 'referral') throw new Error('A referral invite is required');
  const square = format === 'square', W = square ? 1080 : 1200, H = square ? 1080 : 630, pad = 64;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image creation is unavailable');
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0d1424'); bg.addColorStop(0.55, '#1a1f3d'); bg.addColorStop(1, '#3a2a07');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f5b900'; ctx.font = '800 34px sans-serif'; ctx.fillText('richpad.fun', pad, 86);
  ctx.fillStyle = '#ffffff'; ctx.font = `800 ${square ? 92 : 76}px sans-serif`;
  ctx.fillText('Join me on', pad, square ? 300 : 220); ctx.fillStyle = '#f5b900'; ctx.fillText('richpad.fun', pad, square ? 410 : 310);
  ctx.fillStyle = '#c4ccdc'; ctx.font = `600 ${square ? 34 : 30}px sans-serif`;
  const lines = ['Trade any Solana token, before and after migration', 'Daily bonuses · coin calls · referral rewards'];
  lines.forEach((line, index) => ctx.fillText(line, pad, (square ? 500 : 380) + index * (square ? 52 : 44), W - pad * 2));
  const code = String(result.code || '').slice(0, 24);
  if (code) {
    ctx.font = `800 ${square ? 44 : 36}px monospace`; const label = `Code ${code}`, w = ctx.measureText(label).width + 56, y = square ? 640 : 470;
    ctx.fillStyle = 'rgba(245,185,0,0.16)'; roundedRect(ctx, pad, y, w, square ? 84 : 70, 16);
    ctx.fillStyle = '#f5b900'; ctx.fillText(label, pad + 28, y + (square ? 56 : 47));
  }
  const barY = H - (square ? 150 : 76);
  ctx.fillStyle = '#f5b900'; roundedRect(ctx, pad, barY, W - pad * 2, square ? 96 : 54, 14);
  ctx.fillStyle = '#111111'; ctx.font = `800 ${square ? 32 : 26}px sans-serif`;
  ctx.fillText('Sign up with my link and start trading', pad + 26, barY + (square ? 60 : 36), W - pad * 2 - 52);
  return canvas;
}
// Coin call banner: token, change since the call, the call quote, call and
// current market cap, the caller's holding and its change, invite code.
function wrapLines(ctx, text, width, maxLines) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' '), lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) { line = next; continue; }
    if (line) lines.push(line); line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  return lines;
}
const callUsd = value => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value), sign = value < 0 ? '-' : '';
  return abs >= 1e9 ? `${sign}$${(abs / 1e9).toFixed(2)}B` : abs >= 1e6 ? `${sign}$${(abs / 1e6).toFixed(2)}M` : abs >= 1e3 ? `${sign}$${(abs / 1e3).toFixed(2)}K` : `${sign}$${abs >= 1 ? abs.toFixed(2) : abs.toPrecision(2)}`;
};
export function drawCalloutCard(canvas, result, { format = 'wide' } = {}) {
  if (result?.verified !== true || result.kind !== 'callout' || !result.mint) throw new Error('A recorded call is required');
  const square = format === 'square', W = square ? 1080 : 1200, H = square ? 1080 : 630, pad = 64;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image creation is unavailable');
  const f = result.figures || {}, change = f.changePercent, up = !Number.isFinite(change) || change >= 0;
  const tone = up ? '#5ff0a8' : '#ff6b7d';
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0b1020'); bg.addColorStop(1, up ? '#0c2a22' : '#2a0f17');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.2, H * 0.45, 10, W * 0.2, H * 0.45, W * 0.5); glow.addColorStop(0, up ? 'rgba(95,240,168,0.22)' : 'rgba(255,107,125,0.22)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f5b900'; ctx.font = '800 34px sans-serif'; ctx.fillText('richpad.fun', pad, 80);
  ctx.font = '800 22px sans-serif'; const tag = '📣 COIN CALL', tagW = ctx.measureText(tag).width + 40;
  ctx.fillStyle = 'rgba(245,185,0,0.16)'; roundedRect(ctx, W - pad - tagW, 46, tagW, 46, 23); ctx.fillStyle = '#f5b900'; ctx.fillText(tag, W - pad - tagW + 20, 77);
  // Token
  const symbol = String(result.symbol || 'TOKEN').replace(/^\$/, '').slice(0, 12), logoY = 130, logo = 64;
  ctx.save(); ctx.fillStyle = '#25485a'; roundedRect(ctx, pad, logoY, logo, logo, 16); ctx.clip();
  if (result.logoImage) ctx.drawImage(result.logoImage, pad, logoY, logo, logo);
  ctx.restore();
  ctx.fillStyle = '#ffffff'; ctx.font = '800 44px sans-serif'; ctx.fillText(`$${symbol}`, pad + logo + 20, logoY + 48);
  // Big change since the call
  ctx.fillStyle = tone; ctx.font = `800 ${square ? 150 : 128}px sans-serif`;
  ctx.fillText(Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${Math.abs(change) >= 1000 ? change.toFixed(0) : change.toFixed(1)}%` : 'New call', pad, square ? 380 : 330, square ? W - pad * 2 : 560);
  ctx.fillStyle = '#9fc3c7'; ctx.font = '600 24px sans-serif'; ctx.fillText('market cap since the call', pad, square ? 425 : 372);
  // Quote bubble
  const qx = square ? pad : 660, qy = square ? 470 : 130, qw = square ? W - pad * 2 : W - 660 - pad, qh = square ? 190 : 200;
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundedRect(ctx, qx, qy, qw, qh, 20);
  ctx.fillStyle = '#ffffff'; ctx.font = `700 ${square ? 36 : 30}px sans-serif`;
  wrapLines(ctx, `“${String(result.text || '').trim()}”`, qw - 56, 3).forEach((line, index) => ctx.fillText(line, qx + 28, qy + (square ? 62 : 56) + index * (square ? 50 : 44)));
  // Figures
  const cells = [['Hold P&L', Number.isFinite(f.holdChangeUsd) ? `${f.holdChangeUsd >= 0 ? '+' : '-'}${callUsd(Math.abs(f.holdChangeUsd))}` : '—', Number.isFinite(f.holdChangeUsd) ? (f.holdChangeUsd >= 0 ? '#5ff0a8' : '#ff6b7d') : '#ffffff'],
    ['Call MC', callUsd(f.calledCapUsd), '#ffffff'], ['Hold', callUsd(f.holdUsd), '#ffffff'], ['MC now', callUsd(f.currentCapUsd), tone]];
  const gx = square ? pad : 660, gy = square ? 700 : 360, gw = (square ? W - pad * 2 : W - 660 - pad) / 2;
  cells.forEach(([label, value, color], index) => {
    const x = gx + (index % 2) * gw, y = gy + Math.floor(index / 2) * (square ? 96 : 80);
    ctx.fillStyle = '#9fc3c7'; ctx.font = `600 ${square ? 26 : 22}px sans-serif`; ctx.fillText(label, x, y);
    ctx.fillStyle = color; ctx.font = `800 ${square ? 40 : 34}px sans-serif`; ctx.fillText(value, x, y + (square ? 46 : 40), gw - 16);
  });
  // Caller and invite code
  const footY = H - (square ? 70 : 56);
  ctx.fillStyle = '#c4ccdc'; ctx.font = `600 ${square ? 28 : 24}px sans-serif`; ctx.fillText(`Called by ${String(result.caller || '').slice(0, 24)}`, pad, footY);
  if (result.referralCode) {
    ctx.textAlign = 'right'; ctx.fillStyle = '#9fc3c7'; ctx.font = '600 20px sans-serif'; ctx.fillText('Invite code', W - pad, footY - 34);
    ctx.fillStyle = '#ffffff'; ctx.font = '800 32px monospace'; ctx.fillText(String(result.referralCode).slice(0, 18), W - pad, footY + 4); ctx.textAlign = 'left';
  }
  return canvas;
}
const bannerFormat = () => document.querySelector('#share-banner-format')?.value === 'square' ? 'square' : 'wide';

function updateResultPreview() {
  const result = activeShare?.result;
  const options = document.querySelector('#share-result-options');
  if (options) options.hidden = !result;
  const receipt = document.querySelector('#share-receipt-link');
  if (receipt) { receipt.hidden = !result?.receiptUrl; if (result?.receiptUrl) receipt.href = result.receiptUrl; else receipt.removeAttribute('href'); }
  const buyReceipt = document.querySelector('#share-buy-receipt-link');
  if (buyReceipt) { buyReceipt.hidden = !result?.buyReceiptUrl; if (result?.buyReceiptUrl) buyReceipt.href = result.buyReceiptUrl; else buyReceipt.removeAttribute('href'); }
  const canvas = document.querySelector('#share-result-canvas');
  if (!result || !canvas) return false;
  try {
    const formatPicker = document.querySelector('#share-banner-format')?.closest('label'); if (formatPicker) formatPicker.hidden = !['listing', 'referral', 'callout'].includes(result.kind);
    if (result.kind === 'callout') { drawCalloutCard(canvas, result, { format: bannerFormat() }); status('Edit the message, pick a banner size, then share or download the banner.'); return true; }
    if (result.kind === 'listing') { drawListingCard(canvas, result, { format: bannerFormat() }); status('Edit the message, pick a banner size, then share or download the banner.'); return true; }
    if (result.kind === 'referral') { drawReferralCard(canvas, result, { format: bannerFormat() }); status('Edit the message, pick a banner size, then share or download the banner.'); return true; }
    if (result.kind === 'launch') drawLaunchCard(canvas,result);
    else if (result.kind === 'trade') drawTradeCard(canvas, result, { hideWallet:Boolean(document.querySelector('#share-hide-wallet')?.checked) });
    else if (result.kind === 'roundtrip') drawRoundTripCard(canvas, result, { hideAmount:Boolean(document.querySelector('#share-hide-amount')?.checked), hideWallet:Boolean(document.querySelector('#share-hide-wallet')?.checked) });
    else drawEarningsCard(canvas, result, { hideAmount:Boolean(document.querySelector('#share-hide-amount')?.checked), hideWallet:Boolean(document.querySelector('#share-hide-wallet')?.checked) });
    status(result.kind === 'launch' ? 'Confirmed launch. Edit the message and preview your card before sharing.' : result.kind === 'trade' ? 'Finalized trade receipt verified. Edit the message and preview your card before sharing.' : result.kind === 'roundtrip' ? 'Closed position and both receipts verified. This is the wallet SOL change in those transactions.' : 'Paid amount and receipt verified. Sharing is optional.');
    return true;
  } catch (error) { status(error.message); return false; }
}

export function openShareComposer({ kind = 'coin', title, text, url, result = null, network = '', publicShareApproval = null }) {
  if (['trade','roundtrip'].includes(kind) && result?.verified === true && result.network === 'devnet' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(result.receipt || '')) {
    const exact = new URL('/',location.origin); exact.searchParams.set('receipt',result.receipt);
    if (/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(result.buyReceipt || '')) exact.searchParams.set('buyReceipt',result.buyReceipt);
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result.mint || '')) exact.searchParams.set('mint',result.mint);
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result.wallet || '')) exact.searchParams.set('wallet',result.wallet);
    exact.hash='payments/activity'; url=exact.href;
  }
  const dialog = document.querySelector('#share-dialog');
  if (!dialog) throw new Error('Share menu is unavailable');
  activeShare = { kind, title: cleanText(title, 100), url: taggedShareUrl(url), result };
  if (!dialog.querySelector('#share-banner-format')) {
    const picker = document.createElement('label'); picker.className = 'share-banner-format'; picker.hidden = true;
    picker.innerHTML = 'Banner <select id="share-banner-format"><option value="wide">Wide 1200×630 · X, Facebook, LinkedIn</option><option value="square">Square 1080×1080 · Instagram, WhatsApp, Telegram</option></select>';
    picker.querySelector('select').addEventListener('change', updateResultPreview);
    dialog.querySelector('#share-result-canvas')?.after(picker);
  }
  dialog.querySelector('#share-title').textContent = /^Share (?:your|this) /.test(activeShare.title) ? activeShare.title : kind === 'listing' ? 'Share your listing' : kind === 'launch' ? 'Share your launch' : kind === 'referral' ? 'Share your invite' : kind === 'trade' ? 'Share verified trade' : kind === 'roundtrip' ? 'Share closed trade result' : kind === 'result' ? 'Share paid earnings' : 'Share this coin';
  dialog.querySelector('#share-message').value = cleanText(text);
  dialog.querySelector('#share-link').value = activeShare.url;
  dialog.querySelector('#share-network').textContent = String(result?.network || network || (kind === 'coin' ? 'Check token page for network' : 'Referral link')).replace(/^mainnet-beta$/, 'Solana');
  const amountOption = dialog.querySelector('#share-hide-amount')?.closest('label');
  const bannerOnly = ['listing', 'referral', 'callout'].includes(result?.kind);
  const privacy = dialog.querySelector('.share-privacy'); if (privacy) privacy.hidden = bannerOnly;
  const receiptLink = dialog.querySelector('#share-receipt-link'); if (receiptLink && bannerOnly) receiptLink.hidden = true;
  for(const [id,label] of [['share-hide-amount',' Hide amount on image'],['share-hide-wallet',' Hide wallet on image']]){const wrap=dialog.querySelector(`#${id}`)?.closest('label');if(wrap?.lastChild?.nodeType===3)wrap.lastChild.textContent=label;}
  if (amountOption) amountOption.hidden = ['trade','launch'].includes(kind);
  if (kind === 'launch' && result?.kind === 'listing') { const note0 = dialog.querySelector('#share-result-note'); if (note0) note0.dataset.launchBanner = 'true'; }
  const note = dialog.querySelector('#share-result-note');
  const walletOption=dialog.querySelector('#share-hide-wallet')?.closest('label');if(walletOption)walletOption.hidden=kind==='launch';
  if (note) note.textContent = kind === 'callout' ? 'A call is an opinion, not advice. Figures use the market cap recorded when the call was made and the current indexed market cap.' : kind === 'referral' ? 'Invites earn referral rewards only from eligible fees. Rewards are not guaranteed.' : kind === 'coin' ? 'Sharing a token page is not an endorsement or a safety check. Tokens can lose all value.' : kind === 'listing' ? 'A listing shows the token on richpad.fun. It is not an endorsement or a safety check. Tokens can lose all value.' : kind === 'launch' ? 'This card confirms creation, not liquidity, safety, earnings or future returns. Test funds have no monetary value.' : kind === 'trade' ? 'This card confirms one finalized trade. It does not show profit, cost basis, or future returns.' : kind === 'roundtrip' ? 'The amount is the wallet SOL balance change in two finalized transactions, including fees, rent, and any other SOL movements in those receipts. It is not wallet-wide trading profit or a future return.' : 'Paid referral earnings are not trading profit or a prediction of future returns.';
  if(note&&result)note.textContent+=' Image privacy controls do not hide public receipt links, transaction wallets, amounts, or text you choose to share.';
  status('Choose a channel or copy your link. You review the post before publishing.');
  updateResultPreview();
  dialog.querySelector('#public-trade-share')?.remove();
  if (!dialog.open) dialog.showModal();
  if (publicShareApproval && kind === 'roundtrip') {
    const context = activeShare;
    import('./public-trade-share-ui.js').then(({ mountPublicTradeShare }) => {
      if (activeShare === context && dialog.open) mountPublicTradeShare(dialog, result, publicShareApproval);
    }).catch(() => status('Optional platform sharing is unavailable. Your existing sharing options still work.'));
  }
}

export function initShareComposer() {
  const dialog = document.querySelector('#share-dialog');
  if (!dialog || dialog.dataset.ready) return;
  dialog.dataset.ready = 'true';
  dialog.querySelector('#share-close')?.addEventListener('click', () => dialog.close());
  dialog.querySelectorAll('#share-hide-amount, #share-hide-wallet').forEach(node => node.addEventListener('change', updateResultPreview));
  dialog.querySelector('#share-copy-link')?.addEventListener('click', async () => {
    if (!activeShare || !dialog.open) return;
    await copyText(shareUrl(''), 'Link copied');
  });
  dialog.querySelector('#share-copy-message')?.addEventListener('click', async () => {
    if (!activeShare) return;
    await copyText(`${shareText()} ${shareUrl('')}`.trim(), 'Message copied');
  });
  dialog.querySelector('#share-native')?.addEventListener('click', async () => {
    if (!activeShare) return;
    if (!navigator.share) { status('Native sharing is unavailable here. Choose a channel or copy the link.'); return; }
    // Attach the banner image when the device's share sheet accepts files.
    let files;
    try {
      const canvas = document.querySelector('#share-result-canvas');
      if (activeShare.result && canvas && updateResultPreview()) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const file = blob ? new File([blob], `richpad-${activeShare.kind}.png`, { type: 'image/png' }) : null;
        if (file && navigator.canShare?.({ files: [file] })) files = [file];
      }
    } catch { files = undefined; }
    try { await navigator.share({ title: activeShare.title, text: `${shareText()} ${shareUrl('')}`.trim(), ...(files ? { files } : { url: shareUrl('') }) });  status('Share sheet completed. Posting status is not visible to richpad.fun.'); }
    catch (error) { if (error?.name !== 'AbortError') status('Share sheet unavailable. Choose a channel or copy the link.'); }
  });
  dialog.querySelectorAll('[data-share-channel]').forEach(button => button.addEventListener('click', () => {
    if (!activeShare) return;
    const channel = button.dataset.shareChannel;
    const destination = channelShareUrl(channel, shareUrl(channel), shareText());
    window.open(destination, '_blank', 'noopener,noreferrer');

    status(`${button.textContent.trim()} composer requested. If it did not open, copy the message. Posting status is not visible to richpad.fun.`);
  }));
  dialog.querySelector('#share-download-card')?.addEventListener('click', () => {
    if (!activeShare?.result) return;
    const canvas = document.querySelector('#share-result-canvas');
    try { if (!updateResultPreview()) return; const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = ['listing', 'referral', 'callout'].includes(activeShare.result?.kind) && activeShare.kind !== 'listing' ? `richpad-${activeShare.kind}-${bannerFormat()}.png` : activeShare.kind === 'listing' ? `richpad-${String(activeShare.result.symbol || 'listing').replace(/[^A-Za-z0-9]/g, '')}-${bannerFormat()}.png` : activeShare.kind === 'launch' ? 'funded-launch.png' : activeShare.kind === 'trade' ? 'funded-verified-trade.png' : activeShare.kind === 'roundtrip' ? 'funded-closed-trade.png' : 'funded-paid-earnings.png'; link.click();  status('Card downloaded. Share it from your preferred app.'); }
    catch (error) { status(error.message || 'Card download unavailable'); }
  });
}
