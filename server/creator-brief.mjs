export function saveCreatorBrief(profile, input, now = new Date().toISOString()) {
  if (!profile?.identityVerified || !profile.listed || profile.optedOut) throw new Error('Opt in to your verified creator page before publishing a brief.');
  const fields = ['purpose','rewards','delivered','nextMilestone'];
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !fields.includes(key))
    || fields.some(key => typeof input[key] !== 'string' || input[key].trim().length > 280)) throw new Error('Complete the four brief fields using at most 280 characters each.');
  if (input.purpose.trim().length < 10) throw new Error('Explain the project in at least 10 characters.');
  const prior = profile.brief;
  const next = {...Object.fromEntries(fields.map(key=>[key,input[key].trim()])),version:(prior?.version || 0)+1,publishedAt:now,
    evidence:'creator-statement-not-onchain-proof'};
  if (prior) profile.briefHistory = [...(profile.briefHistory || []),prior].slice(-10);
  profile.brief = next; return next;
}
