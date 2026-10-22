import { documentationTopics as topics } from './src/features/help/docs-topics.js';
import { filterDocumentationTopics } from './src/features/help/docs-topic-filter.js';
import './src/features/help/guidance.css';

function initializeRewardActionsScroll(article) {
  const table = article.querySelector('.reward-actions-scroll');
  const help = article.querySelector('#reward-actions-scroll-help');
  if (!table || !help) return () => {};
  const update = () => {
    const overflowing = table.clientWidth > 0 && table.scrollWidth > table.clientWidth + 1;
    help.hidden = !overflowing;
    table.toggleAttribute('data-overflowing', overflowing);
    if (overflowing) {
      table.setAttribute('tabindex', '0');
      table.setAttribute('aria-describedby', help.id);
    } else {
      table.removeAttribute('tabindex');
      table.removeAttribute('aria-describedby');
    }
  };
  if (window.ResizeObserver) {
    let frame;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(table);
    observer.observe(table.querySelector('table'));
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }
  window.addEventListener('resize', update);
  update();
  return () => window.removeEventListener('resize', update);
}

export function mountDocsReference(root) {
  if (!root || root.querySelector('.docs-guide-layout')) return;
  const shell = document.createElement('div');
  shell.className = 'docs-guide-layout';
  const nav = document.createElement('nav');
  nav.className = 'docs-guide-nav';
  nav.setAttribute('aria-label', 'Documentation topics');
  nav.innerHTML = '<a class="docs-back" href="#overview">← Back to home</a>';
  const search = document.createElement('div');
  search.className = 'docs-guide-search';
  search.innerHTML = '<label for="docs-guide-search">Search guides</label><div class="docs-guide-search-controls"><input id="docs-guide-search" type="search" autocomplete="off" aria-controls="docs-guide-topic-results"><button type="button" disabled>Clear search</button></div><p class="docs-guide-count" role="status" aria-live="polite" aria-atomic="true"></p>';
  const input = search.querySelector('input');
  const clear = search.querySelector('button');
  const count = search.querySelector('[role="status"]');
  const results = document.createElement('div');
  results.className = 'docs-guide-topic-results';
  results.id = 'docs-guide-topic-results';
  const empty = document.createElement('p');
  empty.className = 'docs-guide-no-results';
  empty.textContent = 'No guides match your search. Clear search to see all guides.';
  empty.hidden = true;
  nav.append(search, results);
  const article = document.createElement('article');
  article.className = 'docs-guide-article';
  article.id = 'docs-guide-article';
  article.tabIndex = -1;
  const flat = topics.flatMap(group => group.items);
  let selected = 0;
  let releaseScroll = () => {};
  const buttons = new Map();
  const groups = [];
  let composing = false;
  let announcement;
  const filter = () => {
    const matches = new Set(filterDocumentationTopics(topics, input.value).map(topic => topic.id));
    for (const [id, button] of buttons) button.hidden = !matches.has(id);
    for (const group of groups) group.node.hidden = !group.ids.some(id => matches.has(id));
    empty.hidden = matches.size > 0;
    clear.disabled = input.value.length === 0;
    clearTimeout(announcement);
    announcement = setTimeout(() => {
      count.textContent = matches.size === flat.length ? `${flat.length} guides`
        : matches.size === 0 ? 'No guides found' : `${matches.size} of ${flat.length} guides`;
    }, 300);
  };
  const revealTopic = button => {
    if (document.activeElement !== button || !button.isConnected || !button.getClientRects().length) return;
    const style = getComputedStyle(button);
    const extent = (parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0);
    let rect = button.getBoundingClientRect();
    const clip = results.getBoundingClientRect();
    const top = clip.top + results.clientTop, bottom = top + results.clientHeight;
    if (rect.top - extent < top) results.scrollTop -= top - rect.top + extent;
    else if (rect.bottom + extent > bottom) results.scrollTop += rect.bottom + extent - bottom;
    rect = button.getBoundingClientRect();
    const header = document.querySelector('.topbar'), mobile = document.querySelector('.mobile-workspace-nav');
    const viewTop = header?.getClientRects().length ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const viewBottom = mobile?.getClientRects().length ? Math.min(innerHeight, mobile.getBoundingClientRect().top) : innerHeight;
    if (rect.top - extent < viewTop) window.scrollBy({ left: 0, top: Math.floor(rect.top - extent - viewTop), behavior: 'instant' });
    else if (rect.bottom + extent > viewBottom) window.scrollBy({ left: 0, top: Math.ceil(rect.bottom + extent - viewBottom), behavior: 'instant' });
  };
  input.addEventListener('input', event => { if (!composing && !event.isComposing) filter(); });
  input.addEventListener('compositionstart', () => { composing = true; clearTimeout(announcement); });
  input.addEventListener('compositionend', () => { composing = false; filter(); });
  clear.addEventListener('click', () => { composing = false; input.value = ''; filter(); input.focus(); });
  const indexFromHash = () => flat.findIndex(topic => location.hash === `#docs/${topic.id}`);
  const select = (index, focus = false, updateHash = true) => {
    selected = (index + flat.length) % flat.length;
    const topic = flat[selected];
    for (const [id, button] of buttons) {
      const active = id === topic.id;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    const priorFocus = article.contains(document.activeElement) ? document.activeElement : null;
    let interveningFocus = false;
    const trackFocus = event => { if (event.target !== priorFocus) interveningFocus = true; };
    if (priorFocus) document.addEventListener('focusin', trackFocus, true);
    try {
      releaseScroll();
      article.innerHTML = `<p class="eyebrow">${topics.find(group => group.items.includes(topic)).group}</p><h1>${topic.title}</h1><div class="docs-guide-body">${typeof topic.body === 'function' ? topic.body() : topic.body}</div><a class="docs-guide-link" href="${topic.href}">${topic.link} →</a><div class="docs-guide-next"><span>NEXT →</span><button type="button">${flat[(selected + 1) % flat.length].title}</button></div>`;
      releaseScroll = initializeRewardActionsScroll(article);
      article.querySelector('.docs-guide-next button').addEventListener('click', () => select(selected + 1, true));
    } finally {
      if (priorFocus) document.removeEventListener('focusin', trackFocus, true);
    }
    if (focus || priorFocus && !priorFocus.isConnected && !interveningFocus && document.activeElement === document.body) {
      article.focus({ preventScroll: true });
    }
    if (updateHash && location.hash !== `#docs/${topic.id}`) location.hash = `#docs/${topic.id}`;
  };
  for (const group of topics) {
    const groupNode = document.createElement('div');
    groups.push({ node: groupNode, ids: group.items.map(topic => topic.id) });
    const label = document.createElement('p');
    label.className = 'docs-guide-group';
    label.textContent = group.group;
    groupNode.append(label);
    for (const topic of group.items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.docsTopic = topic.id;
      button.textContent = topic.title;
      button.setAttribute('aria-controls', article.id);
      button.addEventListener('click', () => select(flat.indexOf(topic), true));
      buttons.set(topic.id, button);
      groupNode.append(button);
    }
    results.append(groupNode);
  }
  results.append(empty);
  count.textContent = `${flat.length} guides`;
  results.addEventListener('focusin', event => {
    if (event.target.matches('button[data-docs-topic]')) requestAnimationFrame(() => revealTopic(event.target));
  });
  results.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !event.target.matches('button[data-docs-topic]')) return;
    const visible = [...buttons.values()].filter(button => !button.hidden);
    if (!visible.length) return;
    event.preventDefault();
    const next = (visible.indexOf(event.target) + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
    visible[next].focus();
  });
  shell.append(nav, article);
  const oldCards = [...root.querySelectorAll(':scope > .support-card')];
  if (oldCards.length) {
    const more = document.createElement('details');
    more.className = 'docs-more';
    more.innerHTML = '<summary>More guides and service details</summary>';
    const grid = document.createElement('div');
    grid.className = 'docs-more-grid';
    grid.append(...oldCards);
    more.append(grid);
    root.prepend(shell);
    root.append(more);
  } else root.prepend(shell);
  window.addEventListener('hashchange', () => {
    const index = indexFromHash();
    if (index >= 0 && index !== selected) select(index, false, false);
    else if (location.hash === '#docs' && selected !== 0) select(0, false, false);
  });
  select(Math.max(0, indexFromHash()), false, false);
}
