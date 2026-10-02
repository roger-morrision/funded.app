// Advance compact reward cards only when they overflow. Users can always scroll the row.
(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const findTrack = () => document.querySelector('.home-rewards-spotlight .home-rewards-grid');

  function setup(track) {
    if (track.dataset.carouselReady) return;
    track.dataset.carouselReady = '1';
    let pausedUntil = 0;
    const pause = () => { pausedUntil = Date.now() + 10_000; };
    track.addEventListener('pointerdown', pause, { passive: true });
    track.addEventListener('wheel', pause, { passive: true });
    track.addEventListener('focusin', pause);
    track.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') pause(); });

    setInterval(() => {
      if (reducedMotion.matches || document.hidden || Date.now() < pausedUntil
        || track.contains(document.activeElement)) return;
      const cards = [...track.querySelectorAll(':scope > article')];
      const maxScroll = track.scrollWidth - track.clientWidth;
      if (cards.length < 2 || maxScroll <= 2) return;
      if (track.scrollLeft >= maxScroll - 3) {
        track.scrollLeft = 0;
        return;
      }
      const firstLeft = cards[0].offsetLeft;
      const next = cards.find(card => card.offsetLeft - firstLeft > track.scrollLeft + 4);
      track.scrollTo({ left: Math.min(next ? next.offsetLeft - firstLeft : maxScroll, maxScroll), behavior: 'smooth' });
    }, 4500);
  }

  const track = findTrack();
  if (track) setup(track);
  else {
    const observer = new MutationObserver(() => {
      const readyTrack = findTrack();
      if (!readyTrack) return;
      observer.disconnect();
      setup(readyTrack);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
