// Ctrl K: besides coins, match pages and actions ("claim", "invite", "create").
export const ACTIONS = [
  ['Create a coin', '#launch', 'launch new token create'],
  ['Claim creator fees', '#payments/creator', 'claim creator rewards fees'],
  ['Claim X account rewards', '#payments/x', 'claim x twitter account'],
  ['Get my invite link', '#referrals', 'invite referral link share earn'],
  ['My earnings', '#payments', 'earnings rewards received payouts claim'],
  ['Daily bonus standings', '#bonuses', 'daily bonus rank winners podium'],
  ['Leaderboard', '#leaderboard', 'leaderboard top traders burners creators'],
  ['Top 100 tokens', '#top100', 'top 100 rankings'],
  ['Portfolio', '#my-launches', 'portfolio holdings projects locked'],
  ['Airdrops', '#airdrops', 'airdrops allocations rich holders'],
  ['Burn $RICH', '#buybacks', 'burn rich buyback'],
  ['Fee distribution', '#capital-flow', 'fee distribution split policy'],
  ['Get listed', '#list', 'list listing external token'],
  ['Wallet & preferences', '#profile', 'profile wallet settings notifications alerts'],
  ['Docs & help', '#docs', 'docs help guide faq'],
];

export function matchActions(query, limit = 5) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ACTIONS.filter(([title, , keywords]) => words.every(word => `${title} ${keywords}`.toLowerCase().includes(word))).slice(0, limit);
}

export function commandSearchCandidates(query) {
  return matchActions(query).map(([name, href]) => ({
    mint: `action:${href}`, type: 'action', name, href, symbol: 'PAGE',
    subtitle: 'Page or action', marketCap: 'Open page', stage: '',
  }));
}

// Only locally defined commands may become fragment destinations.
export const commandHref = row => row?.type === 'action'
  && ACTIONS.some(([name, href]) => name === row.name && href === row.href)
  ? row.href : null;
