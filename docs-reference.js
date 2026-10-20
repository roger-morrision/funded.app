import { documentationTopics as topics } from './src/features/help/docs-topics.js';
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
  const article = document.createElement('article');
  article.className = 'docs-guide-article';
  article.id = 'docs-guide-article';
  article.tabIndex = -1;
  const flat = topics.flatMap(group => group.items);
  let selected = 0;
  let releaseScroll = () => {};
  const buttons = new Map();
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
    const label = document.createElement('p');
    label.className = 'docs-guide-group';
    label.textContent = group.group;
    nav.append(label);
    for (const topic of group.items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = topic.title;
      button.setAttribute('aria-controls', article.id);
      button.addEventListener('click', () => select(flat.indexOf(topic), true));
      buttons.set(topic.id, button);
      nav.append(button);
    }
  }
  nav.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !event.target.matches('button')) return;
    event.preventDefault();
    const current = flat.findIndex(topic => buttons.get(topic.id) === event.target);
    const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
    buttons.get(flat[next].id).focus();
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
