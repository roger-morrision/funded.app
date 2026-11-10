// Referrals: a QR + X share kit once the invite link exists, and a welcome banner
// for visitors who arrive through someone's link (?ref=CODE).
import { el, safeStorage } from './format.js';
import { shareKit } from './share-kit.js';

export function mountReferralKit(document = globalThis.document) {
  const panel = document.querySelector('.referral-share-panel');
  const linkNode = panel?.querySelector('[data-referral-link]');
  if (!panel || !linkNode || document.getElementById('referral-share-kit')) return Boolean(panel);
  const slot = el(document, 'div', 'referral-share-kit'); slot.id = 'referral-share-kit'; slot.hidden = true;
  panel.append(slot);
  let shown = '';
  const sync = () => {
    const url = linkNode.textContent.trim();
    if (!/^https?:\/\//.test(url)) { slot.hidden = true; shown = ''; return; }
    if (url === shown) return;
    shown = url; slot.hidden = false;
    slot.replaceChildren(shareKit(document, { url, title: 'Share your invite', text: 'Launch your coin on richpad.fun — fees are shared with holders and the community.' }));
  };
  new MutationObserver(sync).observe(linkNode, { childList: true, characterData: true, subtree: true });
  sync();
  return true;
}

export function mountInvitedBanner(document = globalThis.document) {
  const code = new URLSearchParams(location.search).get('ref')?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9_-]{3,32}$/.test(code) || safeStorage.get(`richpad.invited.${code}`) === 'dismissed') return;
  const main = document.getElementById('main-content');
  if (!main || document.getElementById('invited-banner')) return;
  const banner = el(document, 'aside', 'invited-banner'); banner.id = 'invited-banner';
  banner.setAttribute('role', 'note');
  const text = el(document, 'p');
  text.append(el(document, 'strong', null, 'You were invited to richpad.fun. '), document.createTextNode(`Invite code ${code}. Connect your wallet and approve the free sign-in message to link to this referrer. No transaction, no funds move.`));
  const close = el(document, 'button', 'text-button', 'Dismiss'); close.type = 'button';
  close.addEventListener('click', () => { safeStorage.set(`richpad.invited.${code}`, 'dismissed'); banner.remove(); });
  banner.append(text, close);
  main.querySelector(':scope > .topbar')?.after(banner);
}
