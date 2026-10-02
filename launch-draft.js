export const LAUNCH_DRAFT_KEY = 'funded.launch.draft.v1';
const LEGACY_DRAFT_KEY = 'funded.public-launch-draft';

const textLimits = {
  name: 32, symbol: 10, description: 280, tagline: 90, roadmap: 420,
  website: 2048, x: 2048, telegram: 2048, discord: 2048, xRecipient: 16,
};
const fields = Object.keys(textLimits);
const numbers = ['communityTokens', 'creatorBuySol', 'creatorWalletPercent', 'holderAirdropPercent', 'solClaimPercent'];

export function validateLaunchDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) throw new Error('Saved launch draft is unreadable. Delete it and save a new draft.');
  const draft = { version: 1 };
  for (const field of fields) {
    if (typeof input[field] !== 'string' || input[field].length > textLimits[field]) throw new Error('Saved launch draft has an invalid field. Delete it and save a new draft.');
    draft[field] = input[field];
  }
  for (const field of numbers) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field])) throw new Error('Saved launch draft has an invalid amount. Delete it and save a new draft.');
    draft[field] = input[field];
  }
  if (!['fast', 'community'].includes(input.profile) || !['quick', 'custom'].includes(input.mode)
    || !['standard', 'boost', 'pro', 'premier'].includes(input.tier)) throw new Error('Saved launch draft has an invalid option. Delete it and save a new draft.');
  draft.profile = input.profile;
  draft.mode = input.mode;
  draft.tier = input.tier;
  if (!Number.isSafeInteger(draft.communityTokens) || draft.communityTokens < 30_000_000 || draft.communityTokens > 500_000_000
    || draft.creatorBuySol < 0 || draft.creatorBuySol > 1_000_000
    || !numbers.slice(2).every(field => draft[field] >= 0 && draft[field] <= 80)
    || Math.abs(draft.creatorWalletPercent + draft.holderAirdropPercent + draft.solClaimPercent - 80) > 0.00001)
    throw new Error('Saved launch draft has an invalid allocation. Delete it and save a new draft.');
  if (!/^[A-Z0-9]{0,10}$/.test(draft.symbol) || (draft.solClaimPercent > 0 && !/^@[A-Za-z0-9_]{1,15}$/.test(draft.xRecipient)))
    throw new Error('Saved launch draft has an invalid ticker or X account. Delete it and save a new draft.');
  if (draft.mode === 'quick' && (draft.creatorWalletPercent !== 80 || draft.holderAirdropPercent !== 0 || draft.solClaimPercent !== 0))
    throw new Error('Saved launch draft has an invalid simple fee route. Delete it and save a new draft.');
  for (const field of ['website', 'x', 'telegram', 'discord']) {
    if (!draft[field]) continue;
    try { if (!['http:', 'https:'].includes(new URL(draft[field]).protocol)) throw new Error(); }
    catch { throw new Error('Saved launch draft has an invalid public link. Delete it and save a new draft.'); }
  }
  return draft;
}

export function saveLaunchDraft(input, storage = globalThis.localStorage) {
  const draft = validateLaunchDraft(input);
  storage.setItem(LAUNCH_DRAFT_KEY, JSON.stringify(draft));
  storage.removeItem(LEGACY_DRAFT_KEY);
  return draft;
}

export function readLaunchDraft(storage = globalThis.localStorage) {
  const raw = storage.getItem(LAUNCH_DRAFT_KEY);
  if (raw != null) return validateLaunchDraft(JSON.parse(raw));
  const legacy = storage.getItem(LEGACY_DRAFT_KEY);
  if (legacy == null) return null;
  const old = JSON.parse(legacy);
  if (!old || typeof old['token-name'] !== 'string' || typeof old['token-symbol'] !== 'string') throw new Error('Saved launch draft is unreadable. Delete it and save a new draft.');
  return validateLaunchDraft({
    version: 1, profile: 'fast', mode: 'quick', tier: 'standard',
    name: old['token-name'], symbol: old['token-symbol'].toUpperCase(),
    description: '', tagline: '', roadmap: '', website: '', x: '', telegram: '', discord: '',
    communityTokens: 30_000_000, creatorBuySol: 0,
    creatorWalletPercent: 80, holderAirdropPercent: 0, solClaimPercent: 0, xRecipient: '',
  });
}

export function deleteLaunchDraft(storage = globalThis.localStorage) {
  storage.removeItem(LAUNCH_DRAFT_KEY);
  storage.removeItem(LEGACY_DRAFT_KEY);
}
