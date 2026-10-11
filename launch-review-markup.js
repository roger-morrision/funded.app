// Mount before application bootstrap so dialog event handlers always find it.
export function mountLaunchReviewDialog(document = globalThis.document) {
  if (document.querySelector('#launch-review-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog inert data-bootstrap-inert class="info-dialog launch-review-dialog" id="launch-review-dialog" aria-labelledby="launch-review-title">
      <header class="launch-review-head">
        <button type="button" class="dialog-close" id="launch-review-close" aria-label="Close launch review">×</button>
        <p class="dialog-kicker"><span class="pulse-dot"></span> Solana</p>
        <h2 id="launch-review-title">Review your launch</h2>
        <p>Check the coin, wallet, and SOL budget before your wallet asks you to sign.</p>
      </header>
      <div class="launch-review-scroll">
        <section class="launch-review-project" aria-label="Coin and wallet">
          <div><span class="launch-review-label">Launching</span><strong id="launch-review-token"></strong><small id="launch-review-tier"></small></div>
          <div><span class="launch-review-label">Paying wallet</span><code id="launch-review-wallet"></code></div>
        </section>
        <div class="launch-review-highlights">
          <div><span>Airdrop to $funded holders</span><strong id="launch-review-reserve"></strong></div>
          <div><span>Developer buy</span><strong id="launch-review-buy"></strong></div>
        </div>
        <div id="launch-review-details"></div>
        <details class="launch-review-route advanced-details">
          <summary>Advanced details · fee route</summary><code id="launch-review-route-short"></code>
          <div class="launch-review-route-body">
            <span>Full fee owner</span><code id="launch-review-route-address"></code>
            <span>Fee allocation</span><p id="launch-review-route-split"></p>
          </div>
        </details>
      </div>
      <footer class="launch-review-footer">
        <p>Signing starts real Solana approvals. Verify the finalized mint, fee route, and policy after submission.</p>
        <div class="profile-actions"><button type="button" class="secondary-button" id="launch-review-cancel">Back</button><button type="button" class="primary-button" id="launch-review-confirm">Continue to wallet</button></div>
      </footer>
    </dialog>`);
}
