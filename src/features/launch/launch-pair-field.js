import { escapeHtml } from '../shared/display.js';
import { loadPairQuotes, PAIR_CATEGORIES, WSOL_MINT } from '../shared/pair-label.js';
// Step 1 of the launch form: an optional "Paired with" dropdown, grouped by
// category. Leaving it on SOL keeps the standard richpad.fun launch. A paired
// coin uses the same two-step launch, V3 fee router and creator-fee split; the
// launch stays blocked until the router supports fees paid in the paired token.
export async function mountLaunchPairField(app) {
  const step = document.querySelector('#launch-form [data-launch-step="1"]');
  const anchor = step?.querySelector('.coin-fields');
  if (!step || !anchor || step.querySelector('#launch-pair-select')) return;
  const { pairLaunchStatus } = await import('./pair-launch.js');
  if (!(await pairLaunchStatus(app)).enabled) return;
  const quotes = (await loadPairQuotes(path => app.apiRequest(path).then(result => result?.data || result))).filter(row => row.mint !== WSOL_MINT);
  if (!quotes.length) return;
  const groups = PAIR_CATEGORIES.filter(([key]) => !['all', 'sol'].includes(key))
    .map(([key, label]) => [label, quotes.filter(row => (row.category || 'custom') === key)]).filter(([, rows]) => rows.length);
  const field = document.createElement('div');
  field.className = 'launch-pair-field full-label';
  field.innerHTML = `<label for="launch-pair-select">Paired with <span class="optional">optional</span></label>
    <select id="launch-pair-select" aria-describedby="launch-pair-help">
      <option value="">SOL · no pair (standard richpad.fun launch)</option>
      ${groups.map(([label, rows]) => `<optgroup label="${escapeHtml(`${label} (${rows.length})`)}">${rows.map(row => `<option value="${escapeHtml(row.mint)}">${escapeHtml(row.symbol)}${row.name ? ` · ${escapeHtml(row.name)}` : ''}</option>`).join('')}</optgroup>`).join('')}
    </select>
    <small class="field-help" id="launch-pair-help">Skip this to launch with SOL. Pick a token for your coin to trade against it on pump.fun. Fees and the creator-fee split are the same as a SOL launch.</small>
    <p class="launch-pair-status" role="status" data-pair-status></p>`;
  anchor.after(field);
  const select = field.querySelector('select'), status = field.querySelector('[data-pair-status]');
  // The pair is read at launch; Continue keeps its normal two-step flow.
  select.addEventListener('change', () => { status.textContent = ''; });
  // Review: the community reserve of a paired coin is bought with the paired
  // token, so show that cost and the wallet's balance beside the SOL estimate.
  const review = document.querySelector('#launch-review-dialog');
  if (!review) return;
  const describe = async () => {
    review.querySelector('[data-pair-review]')?.remove();
    const picked = quotes.find(row => row.mint === select.value);
    if (!picked || !review.open) return;
    const line = document.createElement('p');
    line.dataset.pairReview = '';
    line.className = 'launch-pair-review';
    line.textContent = `Paired with ${picked.symbol}: checking the community reserve cost…`;
    review.querySelector('h2, [id*="title"]')?.after(line) ?? review.prepend(line);
    try {
      const { PublicKey } = await import('@solana/web3.js');
      const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
      const connection = app.connection || (await app.getSolana(), app.connection);
      const decimals = Number.isInteger(picked.decimals) ? picked.decimals : 6;
      const quote = await app.quoteAtomicReserveBuy({ connection, supply: app.LAUNCH_TOKEN_SUPPLY, decimals: 6,
        reserveTokens: app.getCommunityAirdropTokens(), developerBaseUnits: 0n, quoteMint: picked.mint });
      const quoteInfo = await connection.getAccountInfo(new PublicKey(picked.mint));
      const owner = app.captureWalletSession?.()?.provider?.publicKey;
      const held = owner && quoteInfo ? await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(picked.mint), owner, false, quoteInfo.owner))
        .then(row => BigInt(row.value.amount)).catch(() => 0n) : null;
      const units = value => (Number(value) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: Math.min(decimals, 6) });
      line.textContent = `Paired with ${picked.symbol}: the community reserve costs up to ${units(quote.maxSolAmountLamports)} ${picked.symbol}, paid from your wallet`
        + `${held == null ? '' : ` (you hold ${units(held)} ${picked.symbol})`}. The SOL estimate below still includes a SOL-priced reserve; your actual SOL cost is lower.`;
      if (held != null && held < quote.maxSolAmountLamports) line.textContent += ` Add ${picked.symbol} before launching.`;
    } catch { line.textContent = `Paired with ${picked.symbol}: the community reserve is paid in ${picked.symbol} from your wallet.`; }
  };
  new MutationObserver(() => { void describe(); }).observe(review, { attributes: true, attributeFilter: ['open'] });
}
