import { el, link, button, address, utc, reportContextLink } from './view-utils.js';
import { rememberMarketFacts } from '../explore/market-facts.js';
import { recordFlowTiming } from './flow-timing.js';
import { currentCoinJourney } from './coin-journey-state.js';

export function mountCoinJourney(app) {
  const coin = document.querySelector('#coin-page'); if (!coin) return;
  const panel = el('section', null, 'coin-readiness'); panel.dataset.inlineStatus = '';
  panel.setAttribute('aria-label', 'Coin readiness');
  const state = el('p', 'Checking market stage…'), age = el('small'), nav = el('nav');
  const claims = link('Check airdrop eligibility', '#airdrops');
  const report = reportContextLink('Report this step');
  const retry = button('Retry market check', () => document.querySelector('#coin-refresh')?.click());
  nav.append(claims, report, retry); panel.append(state, age, nav);
  // Hidden by request: the stage line duplicated the coin header. The panel stays
  // in the DOM so flow timing and report context keep working.
  panel.hidden = true;
  coin.querySelector('.coin-hero-card')?.after(panel);
  const checklist = el('details', null, 'flow-panel launch-checklist');
  checklist.append(el('summary', 'After launch · receipts and next steps'));
  // Not shown on the coin page (removed by request); steps are still built for reuse.
  const steps = el('ol'); checklist.append(steps);
  let start = performance.now(), seen = false;
  const reset = () => { start = performance.now(); state.textContent = 'Checking market stage…'; age.textContent = 'A fresh quote is required before signing.'; steps.replaceChildren(); };
  window.addEventListener('funded:coin-facts-loading', reset);
  const verified = detail => {
    const {mint, stage, checkedAt, market} = detail;
    if (mint !== app.getCoinMintAddress()) return;
    state.textContent = `${stage} · review a fresh quote to check trade availability`;
    age.textContent = `Confirmed Solana snapshot · ${utc(checkedAt)}`;
    rememberMarketFacts([market], app.EXPLORE_CLUSTER);
    document.dispatchEvent(new Event('funded:verified-search-index'));
    claims.href = `/?airdropMint=${mint}#airdrops`;
    report.dataset.reportContext = `/token/${mint}?operation=token-detail&stage=verified`;
    recordFlowTiming('token-detail', detail.elapsedMs ?? performance.now() - start, 'verified', seen ? 'warm' : 'cold'); seen = true;
    steps.replaceChildren();
    for (const [text, href] of [
      ['Confirm the mint and saved fee policy', `/token/${mint}`],
      ['View automatic airdrop delivery', `/?airdropMint=${mint}#airdrops`],
      ['Review delivered promotion and recurring agent receipts', '#marketing-agency'],
      ['Review finalized payments', '#payments/history'],
    ]) { const li = el('li'); li.append(link(text, href)); steps.append(li); }
    const facts = coin.querySelector('.launch-facts');
    steps.children[2]?.append(button('Open this coin’s agent facts', () => { if (!facts) return; facts.open = true; facts.scrollIntoView({block:'start'}); }));
  };
  const unavailable = detail => {
    if (!detail.error || detail.mint !== app.getCoinMintAddress()) return;
    state.textContent = 'Market verification unavailable'; age.textContent = 'Refresh token data to retry. Existing transaction receipts remain available.';
    report.dataset.reportContext = `/token/${detail.mint}?operation=token-detail&stage=verification-unavailable`;
    recordFlowTiming('token-detail', currentCoinJourney(detail.mint)?.elapsedMs ?? performance.now() - start, 'unavailable', seen ? 'warm' : 'cold'); seen = true;
  };
  window.addEventListener('funded:coin-market-facts', event => verified(event.detail));
  window.addEventListener('funded:coin-facts', event => unavailable(event.detail));
  if (address(app.getCoinMintAddress())) claims.href = `/?airdropMint=${app.getCoinMintAddress()}#airdrops`;
  const initial=currentCoinJourney(app.getCoinMintAddress());
  if(initial?.status==='verified')verified(initial);
  else if(initial?.status==='unavailable')unavailable(initial);
  else reset();
}
