// A compact version of the platform overview, mounted before workspace routing.
export function mountHomeStart(document=globalThis.document) {
  const section=document.querySelector('.home-start');
  if(section) section.innerHTML=`<header><p class="eyebrow">Why funded.vip</p><h2 id="home-start-title">Fees go back to the community.</h2><p class="home-start-note">Collected creator fees follow the allocation saved on Solana at launch. Payments and burns require funding and verified receipts.</p></header>
          <div class="home-start-grid">
            <a href="#launch"><span class="home-benefit-value">80%</span><h3>Of creator fees go where the creator decides</h3><p>Keep them, or share them with your holders and an X partner.</p></a>
            <a href="#airdrops"><span class="home-benefit-value">≥3%</span><h3>Of each launch reserved for eligible $FUNDED holders</h3><p>Launched coin tokens. Eligibility uses a verified snapshot; claim during the published window.</p></a>
            <a href="#buybacks"><span class="home-benefit-value">5%</span><h3>Allocated to $FUNDED buyback & burn</h3><p>Of collected creator fees. A funded purchase and confirmed burn are required.</p></a>
            <a href="#bonuses"><span class="home-benefit-value">4%</span><h3>Daily bonus pool</h3><p>Eligible top creators, referrers and traders receive SOL after the daily cutoff and verified funding.</p></a>
            <a href="#referrals"><span class="home-benefit-value">1%</span><h3>Referral rewards</h3><p>Of collected creator fees funds the three-level referral network. Receive SOL from qualifying invited launches after settlement and funding.</p></a>
            <a href="#marketing-agency"><span class="home-benefit-value">2%</span><h3>AI agents &amp; coin buybacks</h3><p>Funds AI marketing and milestone-based buybacks and burns of the launched coin, after verified funding and readiness checks.</p></a>
          </div>
          <div class="home-receipts"><div><h3>See where the fees go.</h3><p>Review confirmed payments and their Solana receipts.</p></div><a href="#community-pilot">Plan a community pilot →</a><a href="#payments/history">All payout history <span aria-hidden="true">→</span></a></div>`;
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
