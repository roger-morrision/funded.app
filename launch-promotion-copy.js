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

// One draft per event. Facts take priority over optional description text.
export function launchPromotionPreview(label, {
  symbol = '', description = '', holderPercent, xPercent = 0, creatorPercent,
  airdropPercent, developerBuy = null, lockHours, tier = 'standard', burnTokens,
  event = 'launch', followup = false, cluster = '',
  link = 'https://richpad.fun/token/your-token',
} = {}) {
  const ticker = cleanText(symbol).replace(/[^A-Za-z0-9_]/g, '').slice(0, 10).toUpperCase() || 'SYMBOL';
  const migrated = event === 'migration' || followup;
  const holder = percent(holderPercent), x = percent(xPercent), creator = percent(creatorPercent);
  const airdrop = percent(airdropPercent, 50);
  const promotion = ['boost', 'pro', 'premier'].includes(tier) ? tier[0].toUpperCase() + tier.slice(1) : 'Standard';
  const burn = typeof burnTokens === 'number' && Number.isSafeInteger(burnTokens) && burnTokens >= 0
    ? burnTokens.toLocaleString('en-US') : tier === 'standard' ? '0' : 'quote pending';
  const hours = [6,12,24,48].includes(lockHours) ? lockHours : null;
  const lock = developerBuy === false ? 'Dev buy: none.' : developerBuy === true && hours
    ? `Dev lock: ${hours}h from launch; auto-transfer.` : 'Dev lock: check token page.';
  const fees = holder === null || x === null ? 'SOL fees: check allocation.'
    : `SOL fees: ${creator === null ? '' : `${creator}% creator / `}${holder}% holders / ${x}% X.`;
  const reserve = airdrop !== null && airdrop >= 3
    ? `Airdrop: ${airdrop}% supply to eligible $RICH holders at migration.` : 'Airdrop: check allocation.';
  const header = migrated ? `$${ticker} is migrated` : `New launch: $${ticker}`;
  const network = cluster === 'devnet' ? '[Devnet test]' : cluster === 'mainnet-beta' ? '[Mainnet]' : '';
  const facts = [header, lock, fees, reserve, `${promotion} | $RICH burn: ${burn}`, network, link].filter(Boolean);
  // Never silently remove allocation/lock facts to squeeze in promotional prose.
  const summary = [...cleanText(description || label)];
  const compose = text => [facts[0], text, ...facts.slice(1)].filter(Boolean).join('\n');
  while (summary.length && postWeight(compose(summary.join(''))) > 280) summary.pop();
  return compose(summary.join('').trim());
}
