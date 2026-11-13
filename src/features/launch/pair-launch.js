import { escapeHtml } from '../shared/display.js';
import { loadPairQuotes, PAIR_CATEGORIES, WSOL_MINT } from '../shared/pair-label.js';

// "Create a coin paired with anything": a pump.fun coin whose bonding curve is
// quoted in a token Pump accepts (SOL, USDC, xStocks, stocks, crypto). The
// creator's wallet signs and is Pump's creator; nothing is sent before review.
const NAME_MAX = 32, SYMBOL_MAX = 10, IMAGE_MAX = 600_000;
let status = null, dialog = null;

async function launchStatus(app) {
  status ||= app.apiRequest('/api/pair-launch/status').then(result => result?.available ? result.data : { enabled: false }).catch(() => ({ enabled: false }));
  return status;
}

function markup() {
  const chips = PAIR_CATEGORIES.filter(([key]) => key !== 'custom').map(([key, label]) => `<button type="button" data-pair-category="${key}" aria-pressed="${key === 'all'}">${escapeHtml(label)}</button>`).join('');
  return `<form method="dialog" class="pair-launch" novalidate>
    <header class="pair-launch-head"><div><p class="eyebrow">Create a coin</p><h2 id="pair-launch-title">Launch a coin paired with anything</h2>
      <p>Your coin trades on pump.fun against the token you pick: SOL, USDC, xStocks, stocks or crypto.</p></div>
      <button type="button" class="icon-button" data-pair-close aria-label="Close">✕</button></header>
    <fieldset class="pair-launch-quote"><legend>Paired with</legend>
      <div class="pair-launch-chips" role="group" aria-label="Pair categories">${chips}</div>
      <input type="search" data-pair-search placeholder="Search SOL, USDC, NVDAx, SpaceX…" aria-label="Search paired tokens" />
      <div class="pair-launch-list" role="listbox" aria-label="Paired token" data-pair-list><p class="empty-state">Loading tokens…</p></div>
      <p class="pair-launch-picked" data-pair-picked>Paired with <b>SOL</b></p></fieldset>
    <div class="pair-launch-fields">
      <label>Name<input name="name" maxlength="${NAME_MAX}" required autocomplete="off" /></label>
      <label>Ticker<input name="symbol" maxlength="${SYMBOL_MAX}" required autocomplete="off" /></label>
      <label class="wide">Description <small>optional</small><textarea name="description" maxlength="280" rows="2"></textarea></label>
      <label class="wide">Image <small>PNG, JPG or WEBP, under 600 KB</small><input name="image" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
      <label>Website <small>optional</small><input name="website" type="url" placeholder="https://" /></label>
      <label>X <small>optional</small><input name="x" type="url" placeholder="https://x.com/…" /></label>
      <label>Telegram <small>optional</small><input name="telegram" type="url" placeholder="https://t.me/…" /></label>
      <label data-pair-buy>First buy <small>SOL, optional</small><input name="firstBuy" type="number" min="0" step="0.01" placeholder="0" /></label>
    </div>
    <p class="pair-launch-note" data-pair-note>Your wallet is the coin's creator and receives Pump's creator fees. Trades placed on richpad.fun include its 1% app fee. A coin can lose all its value.</p>
    <p class="pair-launch-status" role="status" data-pair-status></p>
    <div class="pair-launch-actions"><button type="submit" class="primary-button" data-pair-submit>Review and create</button></div>
  </form>`;
}

// Grouped by category (SOL, Stablecoins, xStocks, Stocks, Crypto), in that order.
function renderList(state) {
  const query = state.query.trim().toLowerCase();
  const rows = state.quotes.filter(row => (state.category === 'all' || row.category === state.category)
    && (!query || `${row.symbol} ${row.name}`.toLowerCase().includes(query)));
  const option = row => `<button type="button" role="option" class="pair-launch-option" data-pair-mint="${escapeHtml(row.mint)}" aria-selected="${row.mint === state.picked.mint}">
      <span class="pair-launch-icon" aria-hidden="true">${row.icon ? `<img src="${escapeHtml(row.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : escapeHtml(row.symbol.slice(0, 2))}</span>
      <span><strong>${escapeHtml(row.symbol)}</strong><small>${escapeHtml(row.name || '')}</small></span></button>`;
  const groups = PAIR_CATEGORIES.filter(([key]) => key !== 'all').map(([key, label]) => [label, rows.filter(row => (row.category || 'custom') === key)]).filter(([, list]) => list.length);
  state.list.innerHTML = groups.length ? groups.map(([label, list]) => `<section class="pair-launch-group" role="group" aria-label="${escapeHtml(label)}">
      <h3>${escapeHtml(label)} <small>${list.length}</small></h3><div class="pair-launch-group-items">${list.map(option).join('')}</div></section>`).join('')
    : '<p class="empty-state">No pair tokens match.</p>';
}

async function submit(app, form, state) {
  const say = text => { form.querySelector('[data-pair-status]').textContent = text; };
  const data = new FormData(form);
  form.querySelector('[data-pair-submit]').disabled = true;
  await launchPairedCoin(app, { name: data.get('name'), symbol: data.get('symbol'), image: data.get('image'), description: data.get('description'),
    website: data.get('website'), x: data.get('x'), telegram: data.get('telegram'), quote: state.picked, firstBuySol: data.get('firstBuy') }, say);
  dialog?.close();
}

// Launch a coin paired with `quote` ({ mint, symbol }); used by this dialog and
// by step 1 of the main launch form. Throws with a readable message.
export async function launchPairedCoin(app, input, say = () => {}) {
  const name = String(input.name || '').trim(), symbol = String(input.symbol || '').trim().replace(/^\$/, '').toUpperCase();
  const image = input.image, quote = input.quote || { mint: WSOL_MINT, symbol: 'SOL' };
  if (!name || name.length > NAME_MAX) throw new Error(`Enter a name up to ${NAME_MAX} characters.`);
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error('Enter a ticker of up to 10 letters or digits.');
  if (!(image instanceof Blob) || !image.size) throw new Error('Choose an image for your coin.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > IMAGE_MAX) throw new Error('Choose a PNG, JPG or WEBP image under 600 KB.');
  const firstBuySol = quote.mint === WSOL_MINT ? Math.max(0, Number(input.firstBuySol || 0)) : 0;
  if (!(await launchStatus(app)).enabled) throw new Error('Paired launches are not open on this network yet.');
  if (!app.wallet) await app.connectWallet();
  const session = app.captureWalletSession?.();
  if (!session?.provider?.signMessage || !app.canSignTransactions?.(session.provider)) throw new Error('Connect a wallet that can sign messages and transactions.');
  const [{ Keypair }, { buildPairLaunchTransaction }] = await Promise.all([import('@solana/web3.js'), import('./pair-launch-tx.js')]);
  const connection = app.connection || (await app.getSolana(), app.connection);
  const mint = Keypair.generate();
  // 1. Public metadata (name, ticker, image, links), signed by the creator's wallet.
  say('Sign the coin details in your wallet…');
  const bytes = new Uint8Array(await image.arrayBuffer());
  const imageSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const link = (value, kind) => { const text = String(value || '').trim(); return text ? app.canonicalLaunchSocialUrl?.(text, kind) || text : ''; };
  const record = { mint: mint.publicKey.toBase58(), creatorWallet: session.address, name, symbol, cluster: app.APP_CLUSTER || 'devnet',
    description: String(input.description || '').trim(), tagline: '', roadmap: '', website: link(input.website, 'website'), x: link(input.x, 'x'),
    telegram: link(input.telegram, 'telegram'), discord: '', imageSha256 };
  const signed = await session.provider.signMessage(new TextEncoder().encode(app.metadataStatement(record)));
  app.assertWalletSessionCurrent?.(session);
  say('Publishing coin details…');
  const published = await app.apiRequest('/api/token-metadata', { method: 'POST', body: { ...record, imageBase64: app.Buffer.from(bytes).toString('base64'), imageType: image.type,
    bannerBase64: '', bannerType: '', signature: app.bs58.encode(signed.signature || signed) } });
  if (!published?.available || !published.data?.uri) throw new Error(published?.data?.error || 'Coin details could not be published. Nothing was sent.');
  // 2. One transaction: create the coin on pump.fun, paired with the chosen token.
  say(`Approve creating $${symbol} paired with ${quote.symbol} in your wallet…`);
  const built = await buildPairLaunchTransaction({ connection, user: session.provider.publicKey, mint: mint.publicKey, name, symbol, uri: published.data.uri,
    quoteMint: quote.mint, firstBuySol });
  built.transaction.partialSign(mint);
  app.assertWalletSessionCurrent?.(session);
  const sent = await session.provider.signAndSendTransaction(built.transaction, { skipPreflight: false, preflightCommitment: 'confirmed' });
  const signature = typeof sent === 'string' ? sent : sent?.signature;
  if (!signature) throw new Error('Your wallet did not return a transaction signature. Check your wallet activity.');
  say('Confirming on Solana…');
  const confirmation = await connection.confirmTransaction({ signature, blockhash: built.transaction.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight }, 'confirmed');
  if (confirmation?.value?.err) throw new Error('The launch transaction failed on Solana. Nothing was created.');
  // 3. List it on richpad.fun after the server checks the coin on-chain.
  say('Listing your coin on richpad.fun…');
  await app.apiRequest('/api/pair-launch/record', { method: 'POST', body: { mint: record.mint, signature, name, symbol } }).catch(() => null);
  say('');
  app.showToast?.(`$${symbol} is live on pump.fun, paired with ${quote.symbol}.`);
  location.assign(`/token/${encodeURIComponent(record.mint)}`);
  return { mint: record.mint, signature };
}


export { launchStatus as pairLaunchStatus };

export function openPairLaunch(app) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'info-dialog pair-launch-dialog';
    dialog.setAttribute('aria-labelledby', 'pair-launch-title');
    dialog.innerHTML = markup();
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    const state = { quotes: [], category: 'all', query: '', picked: { mint: WSOL_MINT, symbol: 'SOL' }, list: dialog.querySelector('[data-pair-list]') };
    const pick = row => {
      state.picked = { mint: row.mint, symbol: row.symbol };
      dialog.querySelector('[data-pair-picked]').innerHTML = `Paired with <b>${escapeHtml(row.symbol)}</b>${row.name ? ` · ${escapeHtml(row.name)}` : ''}`;
      dialog.querySelector('[data-pair-buy]').hidden = row.mint !== WSOL_MINT;
      renderList(state);
    };
    void loadPairQuotes(path => app.apiRequest(path).then(result => result?.data || result)).then(list => { state.quotes = list; renderList(state); });
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-pair-close]')) { dialog.close(); return; }
      const chip = event.target.closest('[data-pair-category]');
      if (chip) { state.category = chip.dataset.pairCategory; dialog.querySelectorAll('[data-pair-category]').forEach(node => node.setAttribute('aria-pressed', String(node === chip))); renderList(state); return; }
      const option = event.target.closest('[data-pair-mint]');
      if (option) pick(state.quotes.find(row => row.mint === option.dataset.pairMint) || state.picked);
    });
    dialog.querySelector('[data-pair-search]').addEventListener('input', event => { state.query = event.target.value; renderList(state); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      void submit(app, form, state).catch(error => {
        const message = String(error?.message || error || 'The coin could not be created.');
        form.querySelector('[data-pair-status]').textContent = /reject|declin|cancel/i.test(message) ? 'Cancelled in your wallet. Nothing was created.' : message;
      }).finally(() => { form.querySelector('[data-pair-submit]').disabled = false; });
    });
  }
  if (!dialog.open) dialog.showModal();
  return dialog;
}

// #pair-launch opens the dialog; on Mainnet, "Create a coin" opens it once paired launches are open.
export function initializePairLaunch(app) {
  const fromHash = () => { if (location.hash === '#pair-launch') openPairLaunch(app); };
  window.addEventListener('hashchange', fromHash);
  fromHash();
  if (app.APP_CLUSTER !== 'mainnet-beta') return;
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href="#launch"], [data-route="launch"], #nav-launch');
    if (!link || event.defaultPrevented) return;
    event.preventDefault();
    void launchStatus(app).then(result => { if (result.enabled) openPairLaunch(app); else location.hash = '#launch'; });
  }, true);
}
