// Mount before workspace routing so Home has one stable getting-started section.
export function mountHomeStart(document=globalThis.document) {
  const section=document.querySelector('.home-start');
  if(section) section.innerHTML=`<header><p class="eyebrow">Start here</p><h2 id="home-start-title">What would you like to do?</h2></header>
          <div class="home-start-grid">
            <a href="#explore"><span class="home-step-number">01</span><h3>Find your community</h3><p>Explore coins and save favorites to revisit. Follow wallets and creators for their activity.</p><strong>Explore coins →</strong></a>
            <a href="#launch"><span class="home-step-number">02</span><h3>Bring your idea to life</h3><p>Add coin details, choose how fees are shared, and review the full cost before signing.</p><strong>Create a coin →</strong></a>
            <a href="#payments"><span class="home-step-number">03</span><h3>Understand your rewards</h3><p>See which rewards arrive automatically and which require a claim. Eligibility and funding apply.</p><strong>Check rewards →</strong></a>
          </div>
          <aside class="home-welcome-guide" aria-labelledby="home-welcome-guide-title"><h2 id="home-welcome-guide-title">A few things to know</h2><div class="home-welcome-facts"><article><h3>Browse first</h3><p>You can explore without connecting a wallet. Save coins you want to revisit in Favorites.</p></article><article><h3>You approve every transaction</h3><p>Review the amount, fees, and quote before signing in your wallet. A buy shortcut only selects an amount.</p></article><article><h3>Rewards have conditions</h3><p>Each coin has its own fee policy. Eligibility and available funding determine rewards; an allocation is not a payment.</p></article></div><a href="#docs">Read the getting-started guide →</a></aside>`;
}
