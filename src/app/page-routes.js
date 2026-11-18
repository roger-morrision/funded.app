export const PAGE_ROUTE_TARGETS = {
    launch: '#launch-route-shell',
    list: '#list',
    explore: '#explore',
    top100: '#top100',
    callouts: '#callouts',
    payments: '#payments',
    'analytics-detail': '#analytics-detail',
    'my-launches': '#my-launches',
    referrals: '#referral-command-center',
    community: '#community',
    leaderboard: '#leaderboard',
    airdrops: '#airdrops',
    buybacks: '#buybacks',
    'capital-flow': '#capital-flow',
    bonuses: '#bonuses',
    'marketing-agency': '#marketing-agency',
    docs: '#docs',
    profile: '#profile',
    privacy: '#privacy',
    paid: '#paid',
    status: '#status',
  };
export const MERGED_PAGE_ROUTES = {community: 'my-launches', buybacks: 'paid'};
// Address-bar names match the sidebar labels; the internal route keys stay as they are.
export const PUBLIC_ROUTE_NAMES = {payments: 'rewards', 'my-launches': 'portfolio', callouts: 'calls'};
export const PUBLIC_ROUTE_ALIASES = Object.fromEntries(Object.entries(PUBLIC_ROUTE_NAMES).map(([route, name]) => [name, route]));
export const publicRouteHash = route => `#${PUBLIC_ROUTE_NAMES[route] || route}`;
