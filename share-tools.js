const CHANNELS = new Set(['x', 'telegram', 'whatsapp', 'facebook', 'linkedin', 'reddit']);
const METRIC_KEY = 'funded.vip.share-actions.v1';
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

function recordAction(kind, channel) {
  try {
    const current = JSON.parse(localStorage.getItem(METRIC_KEY) || '{}');
    const key = `${kind}:${channel}`;
    current[key] = Math.min(1000000, Math.max(0, Number(current[key]) || 0) + 1);
    localStorage.setItem(METRIC_KEY, JSON.stringify(current));
    document.dispatchEvent(new Event('funded:share-action'));
  } catch {}
}

export function localShareActions() {
  try {
    const current = JSON.parse(localStorage.getItem(METRIC_KEY) || '{}');
    return Object.values(current).reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0), 0);
  } catch { return 0; }
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
  ctx.fillStyle = '#66e4c6'; ctx.font = '700 32px sans-serif'; ctx.fillText('funded.vip', 72, 82);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 58px sans-serif'; ctx.fillText('Paid referral earnings', 72, 200);
  ctx.font = '700 88px sans-serif'; ctx.fillText(hideAmount ? 'Amount hidden' : `${result.amount.toFixed(4)} ${result.asset || 'SOL'}`, 72, 336);
  ctx.fillStyle = '#bbd3d5'; ctx.font = '30px sans-serif';
  ctx.fillText(`${result.network || 'Devnet'} · paid receipt · ${result.period || 'All time'}`, 72, 395);
  if (!hideWallet && result.wallet) ctx.fillText(`Wallet ${result.wallet.slice(0, 6)}…${result.wallet.slice(-6)}`, 72, 447);
  ctx.fillStyle = '#214f56'; roundedRect(ctx, 72, 500, 1056, 74, 14);
  ctx.fillStyle = '#d5f8ee'; ctx.font = '25px sans-serif'; ctx.fillText(`Receipt ${result.receipt.slice(0, 14)}…  ·  Verify in funded.vip`, 95, 548);
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
  ctx.fillStyle = '#66e4c6'; ctx.font = '700 32px sans-serif'; ctx.fillText('funded.vip', 72, 82);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 58px sans-serif'; ctx.fillText('Verified Devnet trade', 72, 200);
  ctx.font = '700 82px sans-serif'; ctx.fillText(`${result.side === 'buy' ? 'Bought' : 'Sold'} ${String(result.tokenSymbol || 'token').slice(0, 16)}`, 72, 325);
  ctx.fillStyle = '#bbd3d5'; ctx.font = '27px sans-serif';
  ctx.fillText(`Mint ${result.mint.slice(0, 10)}…${result.mint.slice(-8)}`, 72, 392);
  if (!hideWallet && result.wallet) ctx.fillText(`Wallet ${result.wallet.slice(0, 6)}…${result.wallet.slice(-6)}`, 72, 440);
  ctx.fillStyle = '#214f56'; roundedRect(ctx, 72, 500, 1056, 74, 14);
  ctx.fillStyle = '#d5f8ee'; ctx.font = '25px sans-serif'; ctx.fillText(`Receipt ${result.receipt.slice(0, 14)}…  ·  No profit claim`, 95, 548);
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
  ctx.fillStyle = '#66e4c6'; ctx.font = '700 32px sans-serif'; ctx.fillText('funded.vip', 72, 82);
  ctx.fillStyle = '#ffffff'; ctx.font = '700 55px sans-serif'; ctx.fillText('Closed trade · Devnet', 72, 190);
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
    if (result.kind === 'trade') drawTradeCard(canvas, result, { hideWallet:Boolean(document.querySelector('#share-hide-wallet')?.checked) });
    else if (result.kind === 'roundtrip') drawRoundTripCard(canvas, result, { hideAmount:Boolean(document.querySelector('#share-hide-amount')?.checked), hideWallet:Boolean(document.querySelector('#share-hide-wallet')?.checked) });
    else drawEarningsCard(canvas, result, { hideAmount:Boolean(document.querySelector('#share-hide-amount')?.checked), hideWallet:Boolean(document.querySelector('#share-hide-wallet')?.checked) });
    status(result.kind === 'trade' ? 'Finalized trade receipt verified. Profit is not calculated.' : result.kind === 'roundtrip' ? 'Closed position and both receipts verified. This is the wallet SOL change in those transactions.' : 'Paid amount and receipt verified. Sharing is optional.');
    return true;
  } catch (error) { status(error.message); return false; }
}

export function openShareComposer({ kind = 'coin', title, text, url, result = null, network = '', publicShareApproval = null }) {
  const dialog = document.querySelector('#share-dialog');
  if (!dialog) throw new Error('Share menu is unavailable');
  activeShare = { kind, title: cleanText(title, 100), url: taggedShareUrl(url), result };
  dialog.querySelector('#share-title').textContent = kind === 'referral' ? 'Share your invite' : kind === 'trade' ? 'Share verified trade' : kind === 'roundtrip' ? 'Share closed trade result' : kind === 'result' ? 'Share paid earnings' : 'Share this coin';
  dialog.querySelector('#share-message').value = cleanText(text);
  dialog.querySelector('#share-link').value = activeShare.url;
  dialog.querySelector('#share-network').textContent = result?.network || network || (kind === 'coin' ? 'Check token page for network' : 'Referral link');
  const amountOption = dialog.querySelector('#share-hide-amount')?.closest('label');
  if (amountOption) amountOption.hidden = kind === 'trade';
  const note = dialog.querySelector('#share-result-note');
  if (note) note.textContent = kind === 'trade' ? 'This card confirms one finalized trade. It does not show profit, cost basis, or future returns.' : kind === 'roundtrip' ? 'The amount is the wallet SOL balance change in two finalized transactions, including fees, rent, and any other SOL movements in those receipts. It is not wallet-wide trading profit or a future return.' : 'Paid referral earnings are not trading profit or a prediction of future returns.';
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
    if (await copyText(shareUrl(''), 'Link copied')) recordAction(activeShare.kind, 'copy-link');
  });
  dialog.querySelector('#share-copy-message')?.addEventListener('click', async () => {
    if (!activeShare) return;
    if (await copyText(`${shareText()} ${shareUrl('')}`.trim(), 'Message copied')) recordAction(activeShare.kind, 'copy-message');
  });
  dialog.querySelector('#share-native')?.addEventListener('click', async () => {
    if (!activeShare) return;
    if (!navigator.share) { status('Native sharing is unavailable here. Choose a channel or copy the link.'); return; }
    try { await navigator.share({ title: activeShare.title, text: shareText(), url: shareUrl('') }); recordAction(activeShare.kind, 'native-sheet'); status('Share sheet completed. Posting status is not visible to funded.vip.'); }
    catch (error) { if (error?.name !== 'AbortError') status('Share sheet unavailable. Choose a channel or copy the link.'); }
  });
  dialog.querySelectorAll('[data-share-channel]').forEach(button => button.addEventListener('click', () => {
    if (!activeShare) return;
    const channel = button.dataset.shareChannel;
    const destination = channelShareUrl(channel, shareUrl(channel), shareText());
    window.open(destination, '_blank', 'noopener,noreferrer');
    recordAction(activeShare.kind, channel);
    status(`${button.textContent.trim()} composer requested. If it did not open, copy the message. Posting status is not visible to funded.vip.`);
  }));
  dialog.querySelector('#share-download-card')?.addEventListener('click', () => {
    if (!activeShare?.result) return;
    const canvas = document.querySelector('#share-result-canvas');
    try { if (!updateResultPreview()) return; const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = activeShare.kind === 'trade' ? 'funded-verified-trade.png' : activeShare.kind === 'roundtrip' ? 'funded-closed-trade.png' : 'funded-paid-earnings.png'; link.click(); recordAction(activeShare.kind, 'download-card'); status('Card downloaded. Share it from your preferred app.'); }
    catch (error) { status(error.message || 'Card download unavailable'); }
  });
}
