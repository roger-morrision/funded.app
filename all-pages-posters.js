// One concise, image-led guide for each public page that lacks the existing poster.
const pagePosterDefinitions = [
  { key: 'list', anchor: '#list h1', title: 'Get listed with proof', note: 'Submit the project, pass the checks, then appear in the directory.', steps: ['Apply', 'Check', 'Publish'] },
  { key: 'analytics', anchor: '#analytics-detail .purpose-page-nav', title: 'Follow verified data', note: 'Read the activity, its units, and the receipts behind it.', steps: ['Activity', 'Units', 'Receipts'] },
  { key: 'community', anchor: '#community .section-heading', title: 'Save and compare', note: 'Keep a watchlist and compare available market evidence.', steps: ['Explore', 'Watch', 'Compare'] },
  { key: 'capital', anchor: '#capital-flow .section-heading', title: 'See where fees go', note: 'Preview the policy split, then check confirmed destination receipts.', steps: ['Claim', 'Split', 'Receipt'] },
  { key: 'profile', anchor: '#profile .section-heading', title: 'Sign with context', note: 'Connect the wallet, review the action, and confirm the result.', steps: ['Connect', 'Review', 'Verify'] },
  { key: 'holder', anchor: '#rewards-holder', position: 'afterbegin', title: 'Rewards need proof', note: 'A reserve and eligibility check come before a confirmed payment.', steps: ['Reserve', 'Eligible', 'Paid'] },
  { key: 'wallet', anchor: '#wallet-page .wallet-detail-hero', title: 'Wallet activity', note: 'Inspect the address, filter the records, and open verified receipts.', steps: ['Address', 'Filter', 'Receipt'] },
  { key: 'docs-subtopic', anchor: '#docs .docs-guide-body', position: 'afterbegin', image: 'docs', title: 'Know the evidence', note: 'Use confirmed launches, observed market data, and payment receipts.', steps: ['Launch', 'Market', 'Payment'] },
];

function mountPagePoster(definition) {
  if (document.querySelector(`[data-page-infographic="${definition.key}"]`)) return;
  const anchor = document.querySelector(definition.anchor);
  if (!anchor) return;
  const poster = document.createElement('section');
  poster.className = `page-infographic page-infographic-${definition.key}`;
  poster.dataset.pageInfographic = definition.key;
  poster.setAttribute('aria-label', definition.title);

  const figure = document.createElement('figure');
  const picture = document.createElement('img');
  picture.src = `/posters/${definition.image || definition.key}-labeled.webp`;
  picture.alt = `${definition.title}: ${definition.steps.join(', ')}.`;
  picture.loading = 'lazy';
  picture.decoding = 'async';
  figure.append(picture);

  const copy = document.createElement('div');
  copy.className = 'page-infographic-copy';
  const eyebrow = document.createElement('span');
  eyebrow.textContent = 'Visual guide';
  const heading = document.createElement('h3');
  heading.textContent = definition.title;
  const description = document.createElement('p');
  description.textContent = definition.note;
  const mark = document.createElement('img');
  mark.src = document.querySelector('.brand .brand-mark img')?.getAttribute('src') || '/wolf-mark.svg';
  mark.alt = '';
  mark.width = 26;
  mark.height = 26;
  mark.setAttribute('aria-hidden', 'true');
  copy.append(eyebrow, heading, description, mark);
  poster.append(figure, copy);
  anchor.insertAdjacentElement(definition.position || 'afterend', poster);
}

let posterRefreshPending = false;
function refreshPagePosters() {
  if (posterRefreshPending) return;
  posterRefreshPending = true;
  requestAnimationFrame(() => {
    posterRefreshPending = false;
    pagePosterDefinitions.forEach(mountPagePoster);
    const docsSubtopic = location.hash.startsWith('#docs/');
    const introPoster = document.querySelector('[data-infographic-poster="docs"]');
    document.body.classList.toggle('docs-subtopic-without-poster', docsSubtopic && !introPoster?.getClientRects().length);
  });
}

function startPagePosters() {
  refreshPagePosters();
  new MutationObserver(refreshPagePosters).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', refreshPagePosters);
  window.addEventListener('popstate', refreshPagePosters);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPagePosters, { once: true });
else startPagePosters();
