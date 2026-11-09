// Shared by the launch preview and the verified-post formatter.
export function launchPromotionCopy(label, tier = 'standard', { followup = false } = {}) {
  const rewards = 'Explore holder SOL rewards and token airdrops. Eligibility and funding apply.';
  if (followup) return `Back in the spotlight: “${label}”.\n${rewards}`;
  const promotion = tier === 'premier' ? 'a new Premier launch' : tier === 'pro' ? 'a new Pro launch' : 'new';
  return `Meet “${label}” — ${promotion} on richpad.fun!\n${rewards}`;
}
