// Mount before workspace routing so Home has one stable getting-started section.
export function mountHomeStart(document=globalThis.document) {
  const section=document.querySelector('.home-start');
  if(section) section.innerHTML=`<header><p class="eyebrow">Make it yours</p><h2 id="home-start-title">A clear next step.</h2></header>
          <div class="home-start-grid">
            <a href="#explore"><span class="home-step-number">01</span><h3>Find your community</h3><p>Explore coins and save favorites to revisit. Follow wallets and creators for their activity.</p><strong>Explore coins →</strong></a>
            <a href="#launch"><span class="home-step-number">02</span><h3>Bring your idea to life</h3><p>Add coin details, choose how fees are shared, and review the full cost before signing.</p><strong>Create a coin →</strong></a>
            <a href="#payments"><span class="home-step-number">03</span><h3>Understand your rewards</h3><p>See which rewards arrive automatically and which require a claim. Eligibility and funding apply.</p><strong>Check rewards →</strong></a>
          </div>
          <p class="home-start-note">Every coin has its own saved fee policy. An allocation is not a payment. <a href="#docs">How it works →</a></p>`;
}
