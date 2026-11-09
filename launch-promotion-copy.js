// Shared by the launch preview and the verified-post formatter.
export function launchPromotionCopy(label, tier = 'standard', { followup = false } = {}) {
  if (followup) return `Back in the spotlight: “${label}”.\nExplore this Premier token's latest activity and join the conversation on richpad.fun.`;
  const promotion = tier === 'premier' ? 'a new Premier launch' : tier === 'pro' ? 'a new Pro launch' : 'new';
  return `Meet “${label}” — ${promotion} on richpad.fun!\nExplore the token, check its activity and join the conversation.`;
}
