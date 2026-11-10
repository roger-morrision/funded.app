// Create a coin: fee split presets, an auto-saved draft, and a launch kit after success.
import { el, safeStorage } from './format.js';
import { shareKit } from './share-kit.js';

const DRAFT_KEY = 'richpad.launch.draft';
const DRAFT_FIELDS = ['tokenName', 'tokenSymbol', 'tokenTagline', 'tokenDescription', 'tokenWebsite', 'tokenX', 'tokenTelegram', 'tokenDiscord', 'tokenRoadmap', 'xRecipient', 'creatorWalletShare', 'holderAirdropShare', 'solClaimShare'];
// Shares of the fixed 80% creator-directed allocation: [creator wallet, holders, X account].
export const PRESETS = [
  ['Creator-first', 'You keep the full 80%.', [80, 0, 0]],
  ['Balanced', 'Split with holders.', [50, 30, 0]],
  ['Community-first', 'Holders get the most.', [30, 50, 0]],
  ['With X partner', 'Share with an X account.', [50, 20, 10]],
];

function setValue(input, value) {
  if (!input) return;
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function mountLaunchAssist(document = globalThis.document) {
  const form = document.getElementById('launch-form');
  const creator = document.getElementById('creator-wallet-share');
  if (!form || !creator || document.getElementById('launch-presets')) return Boolean(form && creator);

  // Presets above the fee split inputs.
  const presets = el(document, 'div', 'launch-presets'); presets.id = 'launch-presets';
  presets.setAttribute('role', 'group'); presets.setAttribute('aria-label', 'Fee split presets');
  presets.append(el(document, 'span', 'launch-presets-label', 'Quick presets'));
  for (const [title, note, [creatorShare, holders, x]] of PRESETS) {
    const button = el(document, 'button'); button.type = 'button';
    button.append(el(document, 'strong', null, title), el(document, 'small', null, note));
    button.addEventListener('click', () => {
      setValue(document.getElementById('x-share'), x);
      setValue(document.getElementById('holder-airdrop-share'), holders);
      setValue(creator, creatorShare);
      presets.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    });
    presets.append(button);
  }
  (creator.closest('fieldset, .fee-share-grid, .launch-fee-shares, label')?.parentElement || creator.parentElement).before(presets);

  // Draft: restore on load, save as the creator types. Images are not saved.
  let saved = null; try { saved = JSON.parse(safeStorage.get(DRAFT_KEY) || 'null'); } catch { saved = null; }
  if (saved && Object.values(saved.values || {}).some(Boolean)) {
    const banner = el(document, 'div', 'launch-draft-banner');
    banner.append(el(document, 'span', null, `Draft saved ${new Date(saved.at).toLocaleString()}.`));
    const restore = el(document, 'button', 'secondary-button', 'Restore draft'); restore.type = 'button';
    const discard = el(document, 'button', 'text-button', 'Discard'); discard.type = 'button';
    restore.addEventListener('click', () => {
      for (const [name, value] of Object.entries(saved.values)) setValue(form.elements.namedItem(name), value);
      banner.remove();
    });
    discard.addEventListener('click', () => { safeStorage.remove(DRAFT_KEY); banner.remove(); });
    banner.append(restore, discard);
    form.prepend(banner);
  }
  let timer = 0;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const values = Object.fromEntries(DRAFT_FIELDS.map(name => [name, form.elements.namedItem(name)?.value ?? '']));
      safeStorage.set(DRAFT_KEY, JSON.stringify({ at: Date.now(), values }));
    }, 600);
  });
  return true;
}

// Called from the launch success dialog.
export function appendLaunchKit(dialog, { mint, name, symbol }, document = globalThis.document) {
  safeStorage.remove(DRAFT_KEY);
  const url = `${location.origin}/token/${encodeURIComponent(mint)}`;
  const kit = el(document, 'section', 'launch-kit');
  kit.append(el(document, 'h3', null, 'Launch kit'), el(document, 'p', 'field-help', 'Share your coin and bring its first holders.'));
  kit.append(shareKit(document, { url, title: `${name} (${symbol})`, text: `${name} ($${symbol}) is live on Solana Devnet on richpad.fun. Test funds have no monetary value.` }));
  const invite = el(document, 'a', 'text-button', 'Get your invite link → earn from creators you refer'); invite.href = '#referrals';
  invite.addEventListener('click', () => dialog.close?.());
  kit.append(invite);
  const actions = dialog.querySelector('.launch-success-actions');
  if (actions) actions.before(kit); else dialog.append(kit);
}
