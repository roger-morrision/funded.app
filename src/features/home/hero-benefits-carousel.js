// Phone layout shows 3 of the hero benefit cards at a time; this advances one
// page automatically and pauses while the person is swiping or scrolling it.
export function initializeHeroBenefitsCarousel() {
  const list = document.querySelector('.hero-benefit-tags');
  if (!list) return;
  const narrow = matchMedia('(max-width: 560px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false, holdUntil = 0;
  const hold = () => { holdUntil = performance.now() + 6000; };
  for (const event of ['pointerdown', 'touchstart', 'wheel']) list.addEventListener(event, hold, {passive: true});
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }).observe(list);
  setInterval(() => {
    if (!narrow.matches || reduced.matches || !visible || document.hidden || performance.now() < holdUntil) return;
    const max = list.scrollWidth - list.clientWidth;
    if (max <= 4) return;
    const next = list.scrollLeft + list.clientWidth;
    list.scrollTo({left: next >= max - 4 ? 0 : next, behavior: 'smooth'});
  }, 4000);
}
