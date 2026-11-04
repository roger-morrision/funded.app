/// Landing motion and audience tabs. Presentation only: no API, RPC or wallet access.
import { plainWording } from '../experience/technical-notices.js';

// Shared policy copy uses the same display wording as the app (no network names).
const main = document.querySelector('main');
if (main) {
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const plain = plainWording(node.nodeValue);
    if (plain !== node.nodeValue) node.nodeValue = plain;
  }
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function countUp(element) {
  const target = Number(element.dataset.countTo);
  if (!Number.isFinite(target) || reduceMotion) return;
  const prefix = element.dataset.prefix || '', suffix = element.dataset.suffix || '';
  const start = performance.now();
  const step = now => {
    const progress = Math.min(1, (now - start) / 900);
    element.textContent = `${prefix}${Math.round(target * (1 - (1 - progress) ** 3))}${suffix}`;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && !reduceMotion) {
  let reported = false;
  const observer = new IntersectionObserver(entries => {
    reported = true;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      entry.target.querySelectorAll('[data-count-to]').forEach(countUp);
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.15 });
  reveals.forEach(element => observer.observe(element));
  document.documentElement.classList.add('reveal-ready');
  // Never leave content hidden if the observer does not report (background tabs, old engines).
  setTimeout(() => { if (!reported) reveals.forEach(element => element.classList.add('is-visible')); }, 4000);
} else reveals.forEach(element => element.classList.add('is-visible'));

const tabs = [...document.querySelectorAll('.audience-tabs [role="tab"]')];
const select = tab => {
  for (const other of tabs) {
    const selected = other === tab;
    other.setAttribute('aria-selected', String(selected));
    other.tabIndex = selected ? 0 : -1;
    document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
  }
};
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => select(tab));
  tab.addEventListener('keydown', event => {
    const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!offset) return;
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    select(next); next.focus();
  });
});

// The benefit ticker is static copy (the landing page makes no API requests);
// a second copy makes the scroll loop seamless. Screen readers get one copy.
const track = document.querySelector('[data-marquee-track]');
if (track && !reduceMotion) {
  for (const item of [...track.children]) {
    const copy = item.cloneNode(true); copy.setAttribute('aria-hidden', 'true'); track.append(copy);
  }
}
