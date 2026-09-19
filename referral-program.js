export const REFERRAL_CODE_PATTERN = /^FND-[A-Z0-9]{8,16}$/;

export function normalizeReferralCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : '';
}

export function createReferralCode(randomBytes = crypto.getRandomValues(new Uint8Array(6))) {
  const bytes = Uint8Array.from(randomBytes);
  if (bytes.length < 4) throw new Error('Referral code entropy is too short.');
  const code = `FND-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12).toUpperCase()}`;
  return normalizeReferralCode(code);
}

export function captureFirstTouch(existing, candidate, { now = new Date().toISOString(), ownCode = '' } = {}) {
  const current = existing?.code ? { ...existing, code: normalizeReferralCode(existing.code) } : null;
  if (current?.code) return current;
  const code = normalizeReferralCode(candidate);
  if (!code || code === normalizeReferralCode(ownCode)) return null;
  return {
    code,
    directInviterCode: code,
    scope: 'app-account',
    capturedAt: now,
    lock: 'first-touch',
    status: 'pending-first-qualified-event',
    maxRewardDepth: 3,
    uplineResolution: 'server-referral-graph-at-first-qualified-event',
  };
}

export function bindReferralAttribution(attribution, walletAddress, ownCode = '') {
  if (!attribution?.code || !walletAddress) return attribution || null;
  if (normalizeReferralCode(attribution.code) === normalizeReferralCode(ownCode)) return null;
  if (attribution.wallet && attribution.wallet !== walletAddress) return null;
  return { ...attribution, wallet: walletAddress };
}

export function resolveReferralUpline(directInviter, graph = {}, maxDepth = 3) {
  const result = [];
  const visited = new Set();
  let current = directInviter || null;
  while (current && result.length < maxDepth) {
    if (visited.has(current)) throw new Error('Referral graph contains a cycle.');
    visited.add(current);
    result.push(current);
    current = graph[current] || null;
  }
  return result;
}

export function calculateReferralRewards(grossCreatorFees, {
  fundedPercent = 20,
  levels = [],
  upline = [],
} = {}) {
  const gross = Math.max(0, Number(grossCreatorFees) || 0);
  const fundedRevenue = gross * fundedPercent / 100;
  const referralPool = fundedRevenue * levels.reduce((sum, level) => sum + Number(level.percentOfFundedRevenue || 0), 0) / 100;
  const allocations = levels.slice(0, upline.length).map((level, index) => ({
    level: level.level,
    recipient: upline[index],
    amount: fundedRevenue * Number(level.percentOfFundedRevenue || 0) / 100,
    percentOfGrossCreatorFees: Number(level.effectivePercentOfCreatorFees || 0),
  }));
  const allocated = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  return {
    grossCreatorFees: gross,
    fundedRevenue,
    allocations,
    totalReferralReward: allocated,
    unallocatedReferralRevenue: Math.max(0, referralPool - allocated),
    remainingFundedRevenue: fundedRevenue - allocated,
  };
}

export function settleReferralRevenue(event, options = {}, settledEvents = new Map()) {
  if (!event?.id) throw new Error('A revenue event id is required.');
  if (settledEvents.has(event.id)) return settledEvents.get(event.id);
  const settlement = { eventId: event.id, ...calculateReferralRewards(event.grossCreatorFees, options), status: 'pending-settlement' };
  settledEvents.set(event.id, settlement);
  return settlement;
}
