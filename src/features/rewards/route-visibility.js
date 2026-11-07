export function automaticRewardsRouteVisible(location) {
  const hash = location.hash.replace(/^#/, '').split('/')[0];
  if (hash) return ['overview','airdrops','payments','paid'].includes(hash);
  return ['/', '/funded', '/airdrops', '/payments'].includes(location.pathname.replace(/\/$/, '') || '/');
}
