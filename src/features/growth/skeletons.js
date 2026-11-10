// Loading placeholders: short value slots that read "Checking…" / "Loading…" render as
// a shimmering bar instead of text. Screen readers still get the original text.
const PLACEHOLDER = /^(checking|loading|reading)\b[^.]{0,30}…$/i;
const VALUE_SLOTS = 'strong, b, dd, td, output, .home-kpi-value, .reward-dashboard-value, [data-bonus-pool], [data-earnings-total]';

export function isPlaceholder(text) { return PLACEHOLDER.test(String(text || '').trim()); }

export function mountSkeletons(document = globalThis.document) {
  const root = document.getElementById('main-content');
  if (!root || root.dataset.skeletons) return Boolean(root);
  root.dataset.skeletons = 'true';
  let frame = 0;
  const scan = () => {
    frame = 0;
    for (const node of root.querySelectorAll(VALUE_SLOTS)) {
      if (node.children.length) continue;
      node.classList.toggle('is-skeleton', isPlaceholder(node.textContent));
    }
  };
  new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); })
    .observe(root, { childList: true, subtree: true, characterData: true });
  scan();
  return true;
}
