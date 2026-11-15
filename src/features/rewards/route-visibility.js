export function automaticRewardsRouteVisible(location) {
  const hash = location.hash.replace(/^#/, '').split('/')[0];
  if (hash) return ['overview','airdrops','payments','rewards','paid'].includes(hash);
  return ['/', '/rich', '/funded', '/airdrops', '/payments', '/rewards'].includes(location.pathname.replace(/\/$/, '') || '/');
}
