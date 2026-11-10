// The top bar shows "<page>" over its sidebar section, like a breadcrumb.
// It no longer repeats a page subtitle that the page hero already says.
const ROUTE_GROUPS = {
  overview:'Workspace', explore:'Workspace', top100:'Workspace', launch:'Workspace', 'my-launches':'Workspace', payments:'Workspace',
  callouts:'Community', creators:'Community', 'creator-settings':'Community', community:'Community',
  referrals:'Reward programs', 'referral-faq':'Reward programs', bonuses:'Reward programs', airdrops:'Reward programs', leaderboard:'Reward programs',
  paid:'Protocol', buybacks:'Protocol', 'capital-flow':'Protocol', 'analytics-detail':'Protocol', list:'Protocol', 'marketing-agency':'Protocol',
  docs:'Help', privacy:'Help', profile:'Account',
  coin:'Explore · Token', wallet:'Explore · Wallet',
};

export function routeGroup(route = '') {
  const key = String(route).replace(/^#/, '').split(/[/?]/)[0];
  return ROUTE_GROUPS[key] || 'Workspace';
}
