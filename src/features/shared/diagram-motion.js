const initialized = new WeakSet();

export function initializeFlowDiagrams(document = globalThis.document) {
 const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
 for (const figure of document.querySelectorAll('[data-flow-diagram]')) {
  if (initialized.has(figure)) continue;
  const image = figure.querySelector('img[data-diagram-static]');
  const button = figure.querySelector('[data-diagram-motion]');
  const fullView = figure.querySelector('[data-diagram-full]');
  if (!image || !button) continue;
  initialized.add(figure);
  let playing = false;
  const render = () => {
    const source = playing ? image.dataset.diagramAnimated : image.dataset.diagramStatic;
    if (image.getAttribute('src') !== source) image.src = source;
    button.textContent = playing ? 'Pause animation' : 'Play animation';
    button.hidden = reducedMotion.matches;
    figure.dataset.diagramState = playing ? 'playing' : 'paused';
  };
  const pause = () => { playing = false; render(); };
  button.addEventListener('click', () => {
    if (reducedMotion.matches) return;
    playing = !playing;
    render();
  });
  reducedMotion.addEventListener('change', () => {
    const restoreFocus = reducedMotion.matches && document.activeElement === button;
    pause();
    if (restoreFocus) fullView?.focus({ preventScroll: true });
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  if ('IntersectionObserver' in globalThis) {
    new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting && playing) pause();
    }).observe(figure);
  }
  render();
 }
}
