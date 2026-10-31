import { icon } from '../../../ui-icons.js';

document.querySelectorAll('[data-icon]').forEach(element => {
  element.innerHTML = icon(element.dataset.icon);
});

const menu = document.querySelector('#landing-menu');
const trigger = document.querySelector('#landing-menu-button');
const desktop = matchMedia('(min-width:1000px)');
if (typeof menu.showModal === 'function') trigger.hidden = false;

trigger.addEventListener('click', () => {
  menu.showModal();
  trigger.setAttribute('aria-expanded', 'true');
});
menu.querySelector('[data-close-menu]').addEventListener('click', () => menu.close());
menu.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [...menu.querySelectorAll('a[href],button:not([disabled])')].filter(element => element.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
menu.addEventListener('close', () => {
  trigger.setAttribute('aria-expanded', 'false');
  if (!trigger.getClientRects().length) document.querySelector('.landing-sidebar .brand').focus({ preventScroll: true });
});
menu.addEventListener('click', event => {
  if (event.target !== menu) return;
  const box = menu.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) menu.close();
});
menu.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', () => {
  menu.close();
  requestAnimationFrame(() => document.querySelector(link.hash)?.focus({ preventScroll: true }));
}));
desktop.addEventListener('change', event => { if (event.matches && menu.open) menu.close(); });

// Scroll navigation is presentation only: no RPC reads, wallet access or app bootstrap.
const links = [...document.querySelectorAll('.landing-sidebar nav a')];
const updateSection = () => {
  const current = [...document.querySelectorAll('.section-anchor')].filter(section => section.getBoundingClientRect().top <= 130).at(-1);
  for (const link of links) {
    if (link.hash === `#${current?.id || 'platform'}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
};
let queued = false;
addEventListener('scroll', () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { updateSection(); queued = false; });
}, { passive: true });
addEventListener('hashchange', updateSection);
updateSection();
