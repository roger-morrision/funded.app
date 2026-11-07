// A compact version of the platform overview, mounted before workspace routing.
export function mountHomeStart(document=globalThis.document) {
  const section=document.querySelector('.home-start');
  if(section) section.innerHTML=`<header><p class="eyebrow">Why funded.vip</p><h2 id="home-start-title">Fees go back to the community.</h2><p class="home-start-note">Collected creator fees follow the allocation saved on Solana at launch.</p></header>
          <div class="home-start-grid">
            <a href="#launch"><span class="home-benefit-value">80%</span><h3>Creator-directed fees</h3><p>Choose your wallet, holders and X split.</p></a>
            <a href="#airdrops"><span class="home-benefit-value">≥3%</span><h3>Token reserve</h3><p>For eligible $FUNDED holders at migration.</p></a>
            <a href="#buybacks"><span class="home-benefit-value">5%</span><h3>$FUNDED buyback &amp; burn</h3><p>Collected fees fund verified buys and burns.</p></a>
            <a href="#bonuses"><span class="home-benefit-value">4%</span><h3>Daily bonuses</h3><p>Top creators, referrers and traders; paid when funded.</p></a>
            <a href="#referrals"><span class="home-benefit-value">1%</span><h3>Referrals</h3><p>Three reward levels from qualifying creator fees.</p></a>
            <a href="#marketing-agency"><span class="home-benefit-value">2%</span><h3>AI agents &amp; buybacks</h3><p>Coin promotion and milestone buys, when funded.</p></a>
          </div>
          <div class="home-receipts"><div><h3>See where the fees go.</h3><p>Review confirmed payments and their Solana receipts.</p></div><a href="#payments/history">All payout history <span aria-hidden="true">→</span></a></div>`;
  // Reuse the original metric nodes and verification logic; no duplicate IDs or counters.
  if(section && !section.querySelector('.home-proof-summary')) {
    const proof=document.createElement('section');proof.className='home-proof-summary';
    proof.setAttribute('aria-labelledby','home-proof-title');
    proof.innerHTML='<header><h2 id="home-proof-title">On-chain activity</h2><a href="#analytics-detail">View activity →</a></header><div class="home-proof-metrics"></div>';
    for(const id of ['home-kpi-launches-card','home-kpi-volume-card','home-kpi-fees-card','home-kpi-holder-paid-card',
      'home-kpi-referrals-card','home-kpi-airdrop-card','home-kpi-burn-card','home-kpi-buyback-card']) {
      const card=document.getElementById(id);if(card)proof.lastElementChild.append(card);
    }
    section.prepend(proof);
  }

}
