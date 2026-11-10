export function mountCalloutsPage(document = globalThis.document) {
  if (document.getElementById("callouts")) return;
  document.getElementById("leaderboard")?.insertAdjacentHTML("beforebegin", `<div class="callouts-page" id="callouts" role="region" aria-labelledby="callouts-title" data-column="latest">
  <header class="callouts-head"><div><p class="eyebrow">Community calls</p><h1 id="callouts-title">Share discoveries. Build your community.</h1><p>Follow traders, discuss tokens, and make informed decisions together.</p></div><a class="primary-button" href="#explore">Make a call</a></header>
  <div class="callouts-toolbar"><div class="callouts-filters" role="group" aria-label="Filter calls"><button type="button" data-callouts-filter="all" aria-pressed="true">All</button><button type="button" data-callouts-filter="hot" aria-pressed="false">Hot · 2x+</button><button type="button" data-callouts-filter="mine" aria-pressed="false">Mine</button></div><button type="button" class="callouts-author-filter" id="callouts-author-filter" hidden>Wallet <span></span> ✕</button><small id="callouts-status" role="status">Loading calls…</small></div>
  <div class="callouts-leaders" aria-labelledby="callouts-top-title"><p class="callouts-leaders-title" id="callouts-top-title">Top callers · 7 days</p><ol class="callouts-top" id="callouts-top"></ol></div>
  <div class="callouts-tabs" role="group" aria-label="Choose a column"><button type="button" data-callouts-tab="latest" aria-pressed="true">Latest</button><button type="button" data-callouts-tab="top" aria-pressed="false">Top callers</button><button type="button" data-callouts-tab="conviction" aria-pressed="false">Conviction</button></div>
  <div class="callouts-columns">
    <div class="callouts-column" data-callouts-column="latest"><header><h2>Latest <span data-callouts-count="latest">0</span></h2><small>Every call, newest first</small></header><ol class="callouts-list" data-callouts-list="latest"></ol></div>
    <div class="callouts-column" data-callouts-column="top"><header><h2>Top callers <span data-callouts-count="top">0</span></h2><small>Calls from the ranked sample</small></header><ol class="callouts-list" data-callouts-list="top"></ol></div>
    <div class="callouts-column" data-callouts-column="conviction"><header><h2>Conviction <span data-callouts-count="conviction">0</span></h2><small>Callers who held the coin when they called it</small></header><ol class="callouts-list" data-callouts-list="conviction"></ol></div>
  </div>
  <div class="callouts-footnote"><strong>How to make a call</strong><ol><li>Open any coin and write in its Chat tab.</li><li>Post once. Verified token holders automatically make a call; other messages stay in chat.</li><li>Up to 10 calls an hour, one per coin every 30 minutes. Other posts remain chat messages.</li></ol><small>A call is an opinion, not advice.</small></div>
</div>`);
}
