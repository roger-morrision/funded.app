export const burnDashboardMarkup=`<section class="coin-burn-dashboard" id="coin-burn-dashboard" aria-labelledby="coin-burn-title" aria-busy="true">
  <header><h2 id="coin-burn-title">Token burns</h2><span>On-chain supply</span></header>
  <div class="coin-burn-metrics">
    <article><span>Total tokens burned</span><strong data-burn-tokens>—</strong><small>This token</small></article>
    <article><span>Total supply burned</span><strong data-burn-percent>—</strong><small>Of original supply</small></article>
  </div>
  <p data-burn-status role="status" aria-live="polite">Checking token burn totals…</p>
  <details hidden><summary>Supply details</summary><dl><div><dt>Original supply</dt><dd data-burn-initial>Unavailable</dd></div><div><dt>Current supply</dt><dd data-burn-current>Unavailable</dd></div><div><dt>Last checked</dt><dd data-burn-checked>Unavailable</dd></div></dl>
    <p>Burned tokens = original Pump supply minus current mint supply, with minting permanently disabled. Burned percentage = burned tokens ÷ original supply × 100.</p>
    <p>Only reductions of this token’s supply count. Transfers to burn addresses, liquidity-token burns and $FUNDED promotion burns are excluded.</p>
    <a data-burn-explorer target="_blank" rel="noopener noreferrer" hidden>View mint on Explorer ↗</a>
  </details>
</section>`;
