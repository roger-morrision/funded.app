// A compact version of the platform overview, mounted before workspace routing.
export function mountHomeStart(document=globalThis.document) {
  const hero=document.querySelector('.hero-section');
  if(hero && !hero.querySelector('.home-discover')) hero.insertAdjacentHTML('beforeend',`<aside class="home-discover" aria-labelledby="home-discover-title">
            <p class="eyebrow">Find your community</p>
            <h2 id="home-discover-title">Start with a coin.</h2>
            <p>Search a name, symbol, or token address.</p>
            <form class="home-search" role="search" aria-label="Find coins" action="/explore" method="get">
              <input type="hidden" name="filters" value="1" />
              <input type="hidden" name="f.tab" value="trending" />
              <label class="sr-only" for="home-coin-search">Coin name, symbol, or address</label>
              <input id="home-coin-search" name="f.explore-search" type="search" placeholder="Search coins or paste an address" maxlength="199" required />
              <button type="submit" aria-label="Search coins"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg></button>
            </form>
            <nav class="home-discover-links" aria-label="Discover coins">
              <a href="/explore?filters=1&amp;f.tab=trending"><span>Trending</span><span aria-hidden="true">↗</span></a>
              <a href="/explore?filters=1&amp;f.tab=new"><span>New coins</span><span aria-hidden="true">↗</span></a>
              <a href="/explore?filters=1&amp;f.tab=favorites"><span>Favorites</span><span aria-hidden="true">☆</span></a>
            </nav>
            <p class="home-discover-note">Explore first. Your wallet stays in control.</p>
          </aside>`);
  const section=document.querySelector('.home-start');
  if(section) section.innerHTML=`<header><p class="eyebrow">Why funded.vip</p><h2 id="home-start-title">Built to share the rewards.</h2></header>
          <div class="home-start-grid">
            <a href="#launch"><span class="home-benefit-value">80%</span><h3>Share creator fees</h3><p>Split this share of collected creator fees between your wallet, coin holders, and an X partner.</p><strong>Create a coin <span aria-hidden="true">→</span></strong></a>
            <a href="#airdrops"><span class="home-benefit-value">≥3%</span><h3>Airdrops for $FUNDED holders</h3><p>Each launch reserves at least 30M tokens for eligible holders at its verified migration snapshot.</p><strong>Check airdrops <span aria-hidden="true">→</span></strong></a>
            <a href="#bonuses"><span class="home-benefit-value">Top 3</span><h3>Daily SOL bonuses</h3><p>Creators, traders, and referrers can qualify in each category, subject to funding and winner checks.</p><strong>View daily bonuses <span aria-hidden="true">→</span></strong></a>
          </div>
          <div class="home-receipts"><div><h3>See where the fees go.</h3><p>Review confirmed payments and their Solana receipts.</p></div><a href="#payments/history">All payout history <span aria-hidden="true">→</span></a></div>
          <aside class="home-welcome-guide" aria-labelledby="home-welcome-guide-title"><h2 id="home-welcome-guide-title">From first visit to first launch.</h2><div class="home-welcome-facts"><article><span class="home-step-number" aria-hidden="true">01</span><h3>Choose your community</h3><p>Create a coin or explore one. Check its saved fee policy.</p></article><article><span class="home-step-number" aria-hidden="true">02</span><h3>Review in your wallet</h3><p>Check amounts and fees, then approve each transaction.</p></article><article><span class="home-step-number" aria-hidden="true">03</span><h3>Track your rewards</h3><p>Check eligibility and funding, then follow confirmed payouts.</p></article></div><a href="/welcome">See the full platform overview →</a></aside>`;
  // Reuse the original metric nodes and verification logic; no duplicate IDs or counters.
  if(section && !section.querySelector('.home-proof-summary')) {
    const proof=document.createElement('section');proof.className='home-proof-summary';
    proof.setAttribute('aria-labelledby','home-proof-title');
    proof.innerHTML='<header><h2 id="home-proof-title">On-chain activity</h2><a href="#analytics-detail">View activity →</a></header><div class="home-proof-metrics"></div>';
    for(const id of ['home-kpi-launches-card','home-kpi-holder-paid-card','home-kpi-volume-card']) {
      const card=document.getElementById(id);if(card)proof.lastElementChild.append(card);
    }
    section.prepend(proof);
  }

}
