import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAUNCH_DRAFT_KEY, saveLaunchDraft, readLaunchDraft, deleteLaunchDraft } from '../launch-draft.js';
import { journalRecovery, policyMatchesJournal } from '../launch-journal.js';
import { validateImageFile } from '../launch-image.js';

const storage = new Map();
const local = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};
const draft = {
  version: 1, profile: 'community', mode: 'custom', tier: 'boost',
  name: 'QA coin', symbol: 'QA', description: 'Description', tagline: 'Tagline', roadmap: 'Roadmap',
  website: 'https://example.com/', x: '', telegram: '', discord: '',
  communityTokens: 30_000_000, creatorBuySol: 0.01,
  creatorWalletPercent: 50, holderAirdropPercent: 20, solClaimPercent: 10, xRecipient: '@tester',
};
assert.deepEqual(saveLaunchDraft(draft, local), draft);
assert.deepEqual(readLaunchDraft(local), draft);
assert.equal(storage.has(LAUNCH_DRAFT_KEY), true);
assert.throws(() => saveLaunchDraft({ ...draft, creatorWalletPercent: 81 }, local), /invalid allocation/);
assert.throws(() => saveLaunchDraft({ ...draft, website: 'javascript:alert(1)' }, local), /invalid public link/);
assert.throws(() => saveLaunchDraft({ ...draft, mode: 'quick' }, local), /invalid simple fee route/);
storage.set(LAUNCH_DRAFT_KEY, '{invalid');
assert.throws(() => readLaunchDraft(local));
storage.set(LAUNCH_DRAFT_KEY, JSON.stringify({ ...draft, feeConsent: true, walletSecret: 'should be removed' }));
assert.equal('walletSecret' in readLaunchDraft(local), false);
assert.equal('feeConsent' in readLaunchDraft(local), false);
deleteLaunchDraft(local);
assert.equal(readLaunchDraft(local), null);
storage.set('funded.public-launch-draft', JSON.stringify({ 'token-name': 'Legacy QA', 'token-symbol': 'LQA' }));
assert.equal(readLaunchDraft(local).name, 'Legacy QA');
saveLaunchDraft(draft, local);
assert.equal(storage.has('funded.public-launch-draft'), false);
deleteLaunchDraft(local);

assert.doesNotThrow(() => validateImageFile({ type: 'image/png', size: 10 }));
assert.throws(() => validateImageFile({ type: 'image/svg+xml', size: 10 }), /PNG, JPEG or WebP/);
assert.throws(() => validateImageFile({ type: 'image/png', size: 12_000_001 }), /under 12 MB/);

const row = { mint: 'mint', payer: 'payer', signature: 'signature', cluster: 'devnet', state: 'registration-pending', events: [] };
assert.equal(policyMatchesJournal({ mint: 'mint', creatorWallet: 'payer', signature: 'signature', cluster: 'devnet' }, row), true);
assert.equal(policyMatchesJournal({ mint: 'other', creatorWallet: 'payer', signature: 'signature', cluster: 'devnet' }, row), false);
assert.match(journalRecovery(row), /Verify the mint and finish registration/);

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
for (const id of ['save-launch-draft', 'restore-launch-draft', 'delete-launch-draft', 'launch-draft-status']) assert.match(html, new RegExp(`id="${id}"`));
assert.match(app, /restoreLaunchDraftToForm\(draft\)/);
assert.match(app, /document\.querySelector\('#terms-agree'\)\.checked = false/);
assert.match(app, /document\.querySelector\('#fee-route-agree'\)\.checked = false/);
assert.match(app, /launchCostReview = null/);
console.log('Launch draft, image input, and registration recovery checks passed (local-only).');
