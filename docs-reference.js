import { documentationTopics as topics } from './src/features/help/docs-topics.js';
import './src/features/help/guidance.css';

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
    article.innerHTML = `<p class="eyebrow">${topics.find(group => group.items.includes(topic)).group}</p><h1>${topic.title}</h1><div class="docs-guide-body">${typeof topic.body === 'function' ? topic.body() : topic.body}</div><a class="docs-guide-link" href="${topic.href}">${topic.link} →</a><div class="docs-guide-next"><span>NEXT →</span><button type="button">${flat[(selected + 1) % flat.length].title}</button></div>`;
    article.querySelector('.docs-guide-next button').addEventListener('click', () => select(selected + 1, true));
    if (focus) article.focus({ preventScroll: true });
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
