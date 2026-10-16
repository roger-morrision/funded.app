import faqArtwork from '../../../home-faq-wolf.webp';
const artwork = { faq: faqArtwork };

export function initializeDeferredArtwork() {
  const images = [...document.querySelectorAll('img[data-deferred-art]')];
  const reveal = image => {
    const source = artwork[image.dataset.deferredArt];
    if (!source) return;
    image.src = source;
    delete image.dataset.deferredArt;
  };
  if (!('IntersectionObserver' in window)) {
    images.forEach(reveal);
    return;
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      reveal(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '240px' });
  images.forEach(image => observer.observe(image));
}
