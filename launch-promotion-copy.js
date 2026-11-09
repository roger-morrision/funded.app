// Shared by the launch preview and the verified-post formatter.
export function launchPromotionCopy(label, tier = 'standard', { followup = false } = {}) {
  const rewards = 'Explore holder SOL rewards and token airdrops. Join the community. Discover your rewards.';
  if (followup) return `Back in the spotlight: “${label}”.\n${rewards}`;
  const promotion = tier === 'premier' ? 'a new Premier launch' : tier === 'pro' ? 'a new Pro launch' : 'new';
  return `Meet “${label}” — ${promotion} on richpad.fun!\n${rewards}`;
}

const cleanText = value => String(value ?? '').normalize('NFKC')
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
const percent = (value, max = 80) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
  ? Number(value.toFixed(4)) : null;
const postWeight = text => [...text.replace(/https:\/\/[^\s]+/g, 'x'.repeat(23))]
  .reduce((sum, char) => sum + (char.codePointAt(0) <= 0x7f ? 1 : 2), 0);

// The creation form is a draft: use its current inputs, never imply a payout
// has happened. Preserve the program terms when shortening the description.
export function launchPromotionPreview(label, {
  description = '', holderPercent, xPercent = 0, xHandle = '', airdropPercent,
  followup = false, link = 'https://richpad.fun/token/your-token',
} = {}) {
  const holder = percent(holderPercent), x = percent(xPercent);
  const airdrop = percent(airdropPercent, 50);
  const rewards = [];
  if (holder > 0) rewards.push(`${holder}% to holders`);
  if (x > 0) rewards.push(`${x}% to ${/^@[A-Za-z0-9_]{1,15}$/.test(xHandle) ? xHandle : 'X account'}`);
  const rewardLine = holder === null || x === null ? 'SOL rewards: check fee allocation.'
    : rewards.length ? `SOL rewards: ${rewards.join('; ')}.` : 'Holder SOL rewards: off.';
  const airdropLine = airdrop !== null && airdrop >= 3
    ? `Airdrop: ${airdrop}% of supply to eligible $RICH holders at migration.`
    : 'Token airdrop: check allocation.';
  const name = cleanText(label) || 'Token name';
  const text = cleanText(description);
  const compose = summary => [followup ? `${name} · Follow-up` : name, summary,
    rewardLine, airdropLine, 'Join the community. Discover your rewards.', link].filter(Boolean).join('\n');
  if (postWeight(compose(text)) <= 280) return compose(text);
  const chars = [...text];
  while (chars.length && postWeight(compose(`${chars.join('').trimEnd()}…`)) > 280) chars.pop();
  return compose(chars.length ? `${chars.join('').trimEnd()}…` : '');
}
