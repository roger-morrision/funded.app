import { tokenIdentityMarkup, requestTokenIdentities } from '../shared/token-identity.js';

// After a verified buy, offer to "call" the coin: a token chat post from a
// holder is recorded as a call at the current market cap (Coin calls board).
// Posting still runs through the normal chat flow and the user's own submit.
const OPT_OUT = 'funded.postBuyCall.off';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const optedOut = () => { try { return globalThis.localStorage?.getItem(OPT_OUT) === '1'; } catch { return false; } };

export function showPostBuyCall({ mint, symbol, app, document = globalThis.document }) {
  if (!document?.body || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '') || optedOut()) return null;
  document.getElementById('post-buy-call')?.remove();
  requestTokenIdentities([mint]);
  const ticker = String(symbol || '').replace(/^\$/, '').slice(0, 20);
  const dialog = document.createElement('dialog');
  dialog.id = 'post-buy-call'; dialog.className = 'post-buy-call';
  dialog.setAttribute('aria-labelledby', 'post-buy-call-title');
  dialog.innerHTML = `<form method="dialog" class="post-buy-call-body">
    <p class="post-buy-call-kicker">Buy verified on Solana</p>
    <h2 id="post-buy-call-title">Call ${ticker ? `$${escapeHtml(ticker)}` : tokenIdentityMarkup(mint, escapeHtml, 'this coin')} now?</h2>
    <p class="post-buy-call-copy">Post why you bought it. As a holder, your post is recorded as a call at today's market cap, and the Coin calls board tracks how it performs.</p>
    <label class="post-buy-call-field"><span>Your call</span>
      <textarea maxlength="280" rows="3" placeholder="What makes this coin worth watching?">${ticker ? `Just bought $${escapeHtml(ticker)}. ` : 'Just bought this coin. '}</textarea></label>
    <label class="post-buy-call-optout"><input type="checkbox"> Don't ask after every buy</label>
    <div class="post-buy-call-actions">
      <button type="button" class="post-buy-call-skip">Not now</button>
      <button type="button" class="post-buy-call-go primary-button">Call now</button>
    </div>
  </form>`;
  document.body.append(dialog);
  const text = dialog.querySelector('textarea'), optOut = dialog.querySelector('.post-buy-call-optout input');
  const close = () => {
    if (optOut.checked) { try { globalThis.localStorage?.setItem(OPT_OUT, '1'); } catch { /* preference only */ } }
    dialog.close(); dialog.remove();
  };
  dialog.querySelector('.post-buy-call-skip').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.querySelector('.post-buy-call-go').addEventListener('click', () => {
    const message = text.value.trim();
    if (!message) { text.focus(); return; }
    close();
    // Away from this coin's page, open it with the call composer.
    if (app?.getCoinMintAddress?.() !== mint) {
      try { globalThis.sessionStorage?.setItem('funded.postBuyCall.text', message); } catch { /* optional */ }
      globalThis.location.assign(`/token/${encodeURIComponent(mint)}?compose=callout`);
      return;
    }
    app?.ensureCoinChatTab?.();
    const tab = document.querySelector('[data-coin-tab="chat"]');
    if (tab && !tab.classList.contains('active')) tab.click();
    const form = document.querySelector('#coin-chat-form');
    const field = form?.querySelector('input:not([type="checkbox"]), textarea');
    if (!form || !field) return;
    field.value = message.slice(0, Number(field.maxLength) > 0 ? Number(field.maxLength) : 280);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    form.scrollIntoView({ block: 'center' });
    form.requestSubmit();
  });
  dialog.showModal();
  text.focus(); text.setSelectionRange(text.value.length, text.value.length);
  return dialog;
}
