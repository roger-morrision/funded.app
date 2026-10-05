// Progressive enhancement: illustrate the first read and preserve the exact source note.
const posterDefinitions = [
  {
    selector: '#rewards-overview > .source-note', key: 'rewards', eyebrow: 'Reward states',
    title: 'Follow the receipt', summary: 'Read the full reward status note',
    items: [
      ['01', 'Allocated', 'Policy sets an amount aside.'],
      ['02', 'Claimable', 'Eligibility and funding are verified.'],
      ['03', 'Paid', 'A confirmed transfer has a receipt.'],
    ],
  },
  {
    selector: '#airdrops .airdrop-trust > p', key: 'airdrops', eyebrow: 'Claim verification',
    title: 'Three proofs before a claim', summary: 'Read the full claim safety note',
    items: [
      ['01', 'Snapshot', 'Eligible balances are finalized.'],
      ['02', 'Proof', 'Your allocation is published.'],
      ['03', 'Receipt', 'A claim is shown after confirmation.'],
    ],
    footnote: 'Never enter a seed phrase.',
  },
  {
    selector: '#buybacks .burn-center-hero > p:not(.eyebrow)', key: 'burn', eyebrow: 'Burn path',
    title: 'A burn counts after confirmation', summary: 'Read the full burn explanation',
    items: [
      ['01', 'Choose', 'Set an amount and optional project.'],
      ['02', 'Approve', 'Review the permanent wallet action.'],
      ['03', 'Verify', 'Check the on-chain burn receipt.'],
    ],
  },
  {
    selector: '#paid .paid-reference-hero > div > p:not(.eyebrow)', mountAfter: '#paid .paid-reference-hero',
    key: 'fees', eyebrow: '$FUNDED at a glance',
    title: 'One token, three jobs', summary: 'Read the full $FUNDED explanation',
    items: [
      ['01', 'Launch tiers', 'Teams can burn for promotion.'],
      ['02', 'Community', 'Holder allocations have their own proof.'],
      ['03', 'Burn policy', 'Supply changes need receipts.'],
    ],
  },
  {
    selector: '#docs .docs-guide-body > p:first-of-type', extra: '#docs .docs-guide-body > p:nth-of-type(2)',
    key: 'docs', eyebrow: 'Evidence guide', title: 'Know what each screen proves',
    summary: 'Read the full documentation introduction',
    items: [
      ['01', 'Launch', 'Confirmed mint and owner checks.'],
      ['02', 'Market', 'Observed data may be incomplete.'],
      ['03', 'Payment', 'A payout needs a final receipt.'],
    ],
  },
  {
    selector: '#privacy > p:not(.eyebrow):not(.field-help)', key: 'privacy',
    eyebrow: 'Wallet safety', title: 'Know where signing happens',
    summary: 'Read the full wallet and test network explanation',
    items: [
      ['01', 'Standard wallet', 'Signs in your wallet app.'],
      ['02', 'Dev Mode', 'Uses a disposable local test network wallet.'],
      ['03', 'Verify', 'Check the network and final receipt.'],
    ],
    footnote: 'Never enter a seed phrase here.',
  },
  {
    selector: '#privacy .share-visit-consent + .field-help', key: 'visits',
    eyebrow: 'Optional measurement', title: 'You control share tracking',
    summary: 'Read the full share measurement policy',
    items: [
      ['01', 'Opt in', 'Only if you check the box.'],
      ['30d', 'Limited record', 'One-way ID and visit day.'],
      ['03', 'Opt out', 'Uncheck to stop future measurement.'],
    ],
  },
  {
    selector: '#referral-command-center .panel-explainer', key: 'referrals',
    eyebrow: 'Referral journey', title: 'An invite is only the start',
    summary: 'Read the full referral explanation',
    items: [
      ['01', 'Invite', 'Share a trackable link.'],
      ['02', 'Qualify', 'Creator-fee activity is verified.'],
      ['03', 'Claim', 'Approve an available reward.'],
    ],
  },
];

function addPoster(definition) {
  if (document.querySelector(`[data-infographic-poster="${definition.key}"]`)) return true;
  const original = document.querySelector(definition.selector);
  if (!original || original.dataset.posterDone) return Boolean(original);
  const extra = definition.extra ? document.querySelector(definition.extra) : null;
  const poster = document.createElement('section');
  poster.className = `infographic-poster infographic-poster-${definition.key}`;
  poster.dataset.infographicPoster = definition.key;
  poster.setAttribute('aria-label', definition.title);

  const header = document.createElement('div');
  header.className = 'infographic-poster-header';
  const heading = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'infographic-poster-eyebrow';
  eyebrow.textContent = definition.eyebrow;
  const title = document.createElement('h3');
  title.textContent = definition.title;
  heading.append(eyebrow, title);
  const mark = document.createElement('span');
  mark.className = 'infographic-poster-mark';
  mark.setAttribute('aria-hidden', 'true');
  const wolf = document.createElement('img');
  wolf.src = document.querySelector('.brand .brand-mark img')?.getAttribute('src') || '/wolf-mark.svg';
  wolf.alt = '';
  wolf.width = 28;
  wolf.height = 28;
  mark.append(wolf);
  header.append(heading, mark);
  poster.append(header);

  const body = document.createElement('div');
  body.className = 'infographic-poster-body';
  const art = document.createElement('figure');
  art.className = 'infographic-poster-art';
  const picture = document.createElement('img');
  picture.src = `/posters/${definition.key}-labeled.webp`;
  picture.alt = `Illustrated sequence for ${definition.title}: ${definition.items.map(([, name]) => name).join(', ')}.`;
  picture.loading = 'lazy';
  picture.decoding = 'async';
  art.append(picture);
  body.append(art);
  const rail = document.createElement('div');
  rail.className = 'infographic-poster-rail';
  for (const [number, name, detail] of definition.items) {
    const step = document.createElement('div');
    step.className = 'infographic-poster-step';
    const badge = document.createElement('span');
    badge.className = 'infographic-poster-number';
    badge.textContent = number;
    const copy = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = name;
    const small = document.createElement('small');
    small.textContent = detail;
    copy.append(strong, small);
    step.append(badge, copy);
    rail.append(step);
  }
  body.append(rail);
  poster.append(body);
  if (definition.footnote) {
    const footnote = document.createElement('p');
    footnote.className = 'infographic-poster-footnote';
    footnote.textContent = definition.footnote;
    poster.append(footnote);
  }

  const details = document.createElement('details');
  details.className = 'infographic-poster-details';
  const summary = document.createElement('summary');
  summary.textContent = definition.summary;
  details.append(summary);
  original.replaceWith(poster);
  const mount = definition.mountAfter ? document.querySelector(definition.mountAfter) : null;
  if (mount) mount.insertAdjacentElement('afterend', poster);
  original.dataset.posterDone = 'true';
  details.append(original);
  if (extra) { extra.dataset.posterDone = 'true'; details.append(extra); }
  poster.append(details);
  return true;
}

let observer;
function applyPosters() {
  const complete = posterDefinitions.map(addPoster).every(Boolean);
  if (complete && observer) observer.disconnect();
}
function startPosters() {
  applyPosters();
  if (posterDefinitions.every(definition => document.querySelector(`[data-infographic-poster="${definition.key}"]`))) return;
  observer = new MutationObserver(() => applyPosters());
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer?.disconnect(), 15000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPosters, { once: true });
else startPosters();
