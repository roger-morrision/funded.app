// A compact version of the platform overview, mounted before workspace routing.
export function mountHomeStart(document=globalThis.document) {
  const section=document.querySelector('.home-start');
  if(section) section.innerHTML=`<header><p class="eyebrow">Why funded.vip</p><h2 id="home-start-title">Built to share the rewards.</h2></header>
          <div class="home-start-grid">
            <a href="#launch"><span class="home-benefit-value">80%</span><h3>Creator-directed fees</h3><p>Choose how this share of collected creator fees is split between you, coin holders, and an X partner.</p><strong>Create a coin →</strong></a>
            <a href="#airdrops"><span class="home-benefit-value">≥3%</span><h3>Airdrops for $FUNDED holders</h3><p>Every launch reserves at least 30M tokens for eligible $FUNDED holders at its verified migration snapshot.</p><strong>Explore airdrops →</strong></a>
            <a href="#bonuses"><span class="home-benefit-value">Top 3</span><h3>Daily SOL bonuses</h3><p>Creators, traders, and referrers can qualify in each category. Payouts follow funded-pool and winner checks.</p><strong>View daily bonuses →</strong></a>
          </div>
          <aside class="home-welcome-guide" aria-labelledby="home-welcome-guide-title"><h2 id="home-welcome-guide-title">How it works</h2><div class="home-welcome-facts"><article><h3>1. Create or discover</h3><p>Launch your own coin or explore a community. Check its saved fee policy before taking part.</p></article><article><h3>2. Review and approve</h3><p>Connect when you’re ready. Check the amounts and fees, then approve each transaction in your wallet.</p></article><article><h3>3. Follow the receipts</h3><p>View eligible rewards and confirmed payouts. Funding and eligibility determine payments.</p></article></div><a href="/welcome">See the full platform overview →</a></aside>`;
}
