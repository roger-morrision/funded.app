export function createExploreEmptyAction(document, { hasAssets, exploreTab }) {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'explore-empty-action';
  action.dataset.exploreEmptyAction = hasAssets ? 'clear' : 'retry';
  action.textContent = hasAssets
    ? ['new', 'following', 'favorites'].includes(exploreTab) ? 'View all tokens' : 'Clear filters'
    : 'Try again';
  return action;
}
