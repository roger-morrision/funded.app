// Dependencies and mutable application state are read live through appState.
export function createCoinCommunityController(appState) {
  // app-source: 962
  function renderCoinChat(activity){
    const messages = appState.visibleCoinChatMessages();
    const rows = messages.length ? messages.map(appState.tokenChatMessageMarkup).join('') : appState.tokenChatEmptyMarkup();
    activity.innerHTML = `<div class="coin-chat"><div class="coin-chat-intro"><div><strong>${appState.escapeHtml(appState.coinActivity.symbol || 'Token')} chat</strong><small>Wallet-verified community messages</small></div><span>${messages.length} message${messages.length === 1 ? '' : 's'}</span></div><div class="coin-chat-messages">${rows}</div>${appState.tokenChatComposerMarkup('coin-chat')}</div>`;
  }
  // app-source-end

  // app-source: 963
  function visibleCoinChatMessages(){
    const hidden = appState.readHiddenChatAuthors(appState.EXPLORE_CLUSTER);
    return appState.coinChatMessages.filter(message => !hidden.has(message.author));
  }
  // app-source-end

  // app-source: 964
  function tokenChatAuthorLabel(author){ return author ? appState.shortAddress(author) : 'Unknown wallet'; }
  // app-source-end

  // app-source: 965
  function tokenChatEmptyMarkup(){
    if (appState.coinChatState.loading) return '<div class="empty-state coin-activity-empty"><strong>Loading chat…</strong><small>Reading wallet-verified messages.</small></div>';
    if (!appState.coinChatState.enabled) return `<div class="empty-state coin-activity-empty"><strong>Chat unavailable</strong><small>${appState.escapeHtml(appState.coinChatState.reason || 'The chat service could not be reached.')}</small></div>`;
    return '';
  }
  // app-source-end

  // app-source: 966
  function tokenChatMessageMarkup(item){
    const own = Boolean(appState.connectedWalletAddress && item.author === appState.connectedWalletAddress);
    const action = own ? `<footer><button type="button" data-chat-delete="${appState.escapeHtml(item.id)}">Delete</button></footer>` : `<footer><button type="button" data-chat-report="${appState.escapeHtml(item.id)}" title="Report spam or a scam for moderation review">Report spam or scam</button><button type="button" data-chat-hide="${appState.escapeHtml(item.author)}">Hide this wallet</button></footer>`;
    return `<article class="coin-community-message" data-chat-message="${appState.escapeHtml(item.id)}"><div><strong>${appState.escapeHtml(appState.tokenChatAuthorLabel(item.author))}<small class="verified-author">✓ wallet</small></strong><time>${appState.escapeHtml(new Date(item.createdAt).toLocaleString())}</time></div><p>${appState.escapeHtml(item.text)}</p>${action}</article>`;
  }
  // app-source-end

  // app-source: 967
  function tokenChatComposerMarkup(prefix = 'coin-community'){
    if (!appState.coinChatState.enabled) return '';
    const connected = Boolean(appState.connectedWalletAddress);
    const ready = appState.tokenChatSessionReady();
    const buttonLabel = !connected ? 'Connect wallet' : ready ? 'Post' : 'Verify once & post';
    const note = !connected ? 'Connect a Solana wallet to post' : ready ? `Posting as ${appState.escapeHtml(appState.shortAddress(appState.connectedWalletAddress))} · no approval needed for each post` : `Posting as ${appState.escapeHtml(appState.shortAddress(appState.connectedWalletAddress))} · one wallet approval starts a 30-minute chat session`;
    const hidden = appState.readHiddenChatAuthors(appState.EXPLORE_CLUSTER);
    const unhide = hidden.size ? `<button type="button" data-chat-unhide>Show ${hidden.size} hidden wallet${hidden.size === 1 ? '' : 's'}</button>` : '';
    return `<form class="coin-chat-form coin-community-form" id="${prefix}-form"><label><span class="sr-only">Message</span><input id="${prefix}-input" maxlength="${appState.TOKEN_CHAT_MAX_LENGTH}" autocomplete="off" placeholder="Share a useful observation…" required /></label><button class="primary-button" type="submit">${buttonLabel}</button></form><small class="coin-chat-note">${note}. Wallet verification confirms authorship, not trust. ${unhide}</small>`;
  }
  // app-source-end

  // app-source: 968
  function renderCoinCommunityPanel(){
    const feed = document.querySelector('#coin-community-feed');
    if (!feed) return;
    const messages = appState.visibleCoinChatMessages();
    feed.innerHTML = messages.length ? messages.slice(-12).map(appState.tokenChatMessageMarkup).join('') : appState.coinChatMessages.length ? '<p role="status">Messages from hidden wallets are hidden on this device.</p>' : appState.tokenChatEmptyMarkup();
    const panel = feed.closest('.coin-community-panel');
    const badge = panel?.querySelector('.data-badge');
    if (badge) { badge.textContent = appState.coinChatState.loading ? 'LOADING' : appState.coinChatState.enabled ? 'LIVE' : 'OFFLINE'; badge.classList.toggle('is-live', appState.coinChatState.enabled); }
    panel?.querySelector('.coin-community-form')?.remove();
    panel?.querySelector('.coin-chat-note')?.remove();
    panel?.insertAdjacentHTML('beforeend', appState.tokenChatComposerMarkup('coin-community'));
  }
  // app-source-end

  // app-source: 969
  function ensureCoinCommunityPanel(){
    const page = document.querySelector('#coin-page');
    if (!page) return;
    const existing = page.querySelector('.coin-community-panel');
    if (existing) {
      if (existing !== page.lastElementChild) page.append(existing);
      return;
    }
    const panel = document.createElement('aside');
    panel.className = 'panel coin-community-panel';
    panel.innerHTML = '<div class="coin-community-head"><div><p class="eyebrow">Community</p><h2>Chat</h2></div><span class="data-badge">LOADING</span></div><div id="coin-community-feed" class="coin-community-feed"></div>';
    page.append(panel);
    appState.renderCoinCommunityPanel();
  }
  // app-source-end

  // app-source: 970
  async function loadCoinChat(mintAddress, loadId = appState.coinLoadId){
    appState.coinChatMessages = [];
    appState.coinChatState = { loading: true, enabled: false, reason: '' };
    appState.renderCoinCommunityPanel();
    const response = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/chat`, { signal: AbortSignal.timeout(5000) }).catch(() => ({ available: false, data: null }));
    if (loadId !== appState.coinLoadId) return;
    appState.coinChatMessages = response.available && Array.isArray(response.data?.messages) ? response.data.messages : [];
    appState.coinChatState = { loading: false, enabled: response.available && response.data?.enabled === true, reason: response.data?.reason || (response.available ? '' : 'The chat service is unavailable.') };
    appState.renderCoinCommunityPanel();
    if (document.querySelector('[data-coin-tab="chat"].active')) appState.renderCoinActivityTab();
  }
  // app-source-end

  // app-source: 971
  function ensureCoinChatTab(){
    document.querySelector('.coin-tabs [data-coin-tab="chat"]')?.remove();
    const holders = document.querySelector('.coin-tabs [data-coin-tab="holders"]');
    if (holders) holders.textContent = 'Holders —';
  }
  // app-source-end

  // app-source: 972
  function ensureCoinPolicyAccordion(){
    const card = document.querySelector('.coin-policy-card');
    if (!card) return;
    card.classList.add('is-compact');
    card.querySelector('#coin-policy-toggle')?.remove();
    card.querySelector('.coin-panel-head')?.remove();
    card.classList.remove('is-expanded');
  }
  // app-source-end

  // app-source: 974
  function ensureCoinTradeFilterPanel(){
    const panel = document.querySelector('#coin-trade-refine');
    if (!panel || panel.dataset.ready) return panel;
    const range = (label, minKey, maxKey, step = 'any') => `<div class="coin-column-range"><label>Min ${label}<input data-coin-trade-input="${minKey}" type="number" min="0" step="${step}" inputmode="decimal" placeholder="Any" /></label><label>Max ${label}<input data-coin-trade-input="${maxKey}" type="number" min="0" step="${step}" inputmode="decimal" placeholder="Any" /></label></div>`;
    panel.innerHTML = `<div class="coin-column-filter-heading"><strong id="coin-column-filter-title">Filter trades</strong><button type="button" id="coin-trade-clear">Clear all</button></div>
      <div data-coin-filter-panel="date" hidden><div class="coin-column-range"><label>From date<input data-coin-trade-input="dateFrom" type="date" /></label><label>Through date<input data-coin-trade-input="dateTo" type="date" /></label></div></div>
      <div data-coin-filter-panel="type" hidden><label>Trade type<select data-coin-trade-input="side"><option value="all">All trades</option><option value="buy">Buys</option><option value="sell">Sells</option></select></label></div>
      <div data-coin-filter-panel="usd" hidden>${range('USD', 'minUsd', 'maxUsd', '0.01')}</div>
      <div data-coin-filter-panel="token" hidden>${range('tokens', 'minToken', 'maxToken')}</div>
      <div data-coin-filter-panel="sol" hidden>${range('SOL', 'minSol', 'maxSol')}</div>
      <div data-coin-filter-panel="price" hidden>${range('USD per token', 'minPrice', 'maxPrice')}</div>
      <div data-coin-filter-panel="txn" hidden><label>Transaction signature<input data-coin-trade-input="signature" type="search" placeholder="Signature or prefix" autocomplete="off" /></label></div>
      <small>Filters and sorting apply to the latest 20 loaded trades. USD estimates use the current SOL quote.</small>`;
    panel.dataset.ready = 'true';
    return panel;
  }
  // app-source-end

  // app-source: 975
  function coinTradeFilterValues(){
    const values = { side: appState.coinTradeFilter, wallet: document.querySelector('#coin-trade-wallet')?.value || '', decimals: appState.coinMarketActivity.decimals, solUsd: appState.coinSolUsdPrice, sortKey: appState.coinTradeSort.key, sortDirection: appState.coinTradeSort.direction };
    document.querySelectorAll('#coin-trade-refine [data-coin-trade-input]').forEach(input => {
      if (input.dataset.coinTradeInput !== 'side') values[input.dataset.coinTradeInput] = input.value;
    });
    return values;
  }
  // app-source-end

  // app-source: 976
  function updateCoinTradeFilterPanel(){
    const panel = appState.ensureCoinTradeFilterPanel();
    if (!panel) return;
    panel.hidden = !appState.coinTradeOpenFilter;
    panel.querySelectorAll('[data-coin-filter-panel]').forEach(section => { section.hidden = section.dataset.coinFilterPanel !== appState.coinTradeOpenFilter; });
    const title = panel.querySelector('#coin-column-filter-title');
    if (title) title.textContent = `Filter ${appState.COIN_TRADE_COLUMNS.find(([key]) => key === appState.coinTradeOpenFilter)?.[1] || 'trades'}`;
  }
  // app-source-end

  // app-source: 977
  function renderCoinActivityTab(){
    return appState.renderCoinActivityTabView({ coinMarketActivity: appState.coinMarketActivity, coinActivity: appState.coinActivity, COIN_TRADE_COLUMNS: appState.COIN_TRADE_COLUMNS, coinTradeSort: appState.coinTradeSort, coinTradeFilter: appState.coinTradeFilter, coinTradeOpenFilter: appState.coinTradeOpenFilter, coinSolUsdValues: appState.coinSolUsdValues, coinSolUsdPrice: appState.coinSolUsdPrice }, { updateCoinTradeFilterPanel: appState.updateCoinTradeFilterPanel, renderCoinChat: appState.renderCoinChat, coinTradeFilterValues: appState.coinTradeFilterValues, getCoinMintAddress: appState.getCoinMintAddress, formatCoinSnapshotUsd: appState.formatCoinSnapshotUsd, formatOnchainAge: appState.formatOnchainAge, formatCoinUsd: appState.formatCoinUsd, exploreExplorer: appState.exploreExplorer, loadVerifiedTokenLogos: appState.loadVerifiedTokenLogos });
  }
  // app-source-end

  // app-source: 978
  function renderOnChainUnavailable(message){
    const detail = String(message || '');
    const displayMessage = /(?:5\d\d (?:Internal Server Error|Bad Gateway)|returned an invalid response)/i.test(detail)
      ? 'Solana Devnet RPC is unavailable. Retry when network access recovers.'
      : detail;
    appState.coinTradeEstimate = null;
    appState.renderTradeAmountEstimate();
    appState.coinActivity = { status: 'unavailable', message: displayMessage, collections: [], claims: [], accounts: [] };
    appState.coinSummaryLaunch = null;
    appState.coinSummaryLedgerMint = null;
    appState.renderCoinFeeDashboard({ available:false });
    appState.renderCoinAccountDistribution(null);
    appState.coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals: 6 };
    appState.renderCoinPricePath(); appState.renderCoinFlow(NaN, NaN); appState.renderCoinPulse();
    appState.setCoinTabLabels(); appState.renderCoinActivityTab();
    appState.setCoinField('.coin-live-dot', 'Data unavailable');
    appState.setCoinField('#coin-page-title', 'Token data unavailable');
    appState.setCoinField('#coin-avatar', '?'); appState.setCoinField('#coin-symbol', '—'); appState.setCoinField('#coin-description', displayMessage);
    ['#coin-stage','#coin-fee-owner','#coin-metadata-status','#coin-mint-authority','#coin-freeze-authority'].forEach(selector => appState.setCoinFact(selector, 'Unavailable'));
    ['#coin-market-cap','#coin-change','#coin-strip-market-cap','#coin-volume','#coin-liquidity','#coin-holders','#coin-trade-count','#coin-holder-count','#coin-vault-share','#coin-largest-account-share','#coin-top-ten-share','#coin-supply'].forEach(selector => appState.setCoinField(selector, 'Unavailable'));
    appState.setCoinField('#coin-volume-source', 'RPC trade history unavailable'); appState.setCoinField('#coin-trade-breakdown', 'RPC trade history unavailable'); appState.setCoinField('#coin-accounts-source', 'Largest-account sample unavailable'); appState.setCoinCurveProgress(null);
    appState.setCoinField('#coin-chart-heading', 'Chart unavailable');
    appState.setCoinField('#coin-market-cap-label', 'Estimated market cap'); appState.setCoinField('#coin-market-cap-source', 'Confirmed Solana RPC snapshot');
    appState.setCoinField('#coin-liquidity-label', 'Reserve');
    const footer = document.querySelector('.chart-footer'); if (footer) footer.innerHTML = '<span>Price history is unavailable</span>';
    const policyEyebrow = document.querySelector('.coin-policy-card .eyebrow'); if (policyEyebrow) policyEyebrow.textContent = 'On-chain account';
    const policyBadge = document.querySelector('.coin-policy-card .data-badge'); if (policyBadge) policyBadge.textContent = 'RPC only';
    const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = 'Curve unavailable';
    appState.renderCoinCreatorRoute('');
    const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Creator</small></span>';
    const policyBar = document.querySelector('.policy-bar'); if (policyBar) { policyBar.style.display = 'block'; policyBar.innerHTML = '<i style="display:block;height:100%;width:100%;background:#667085"></i>'; }
    const policyLink = document.querySelector('.policy-link'); if (policyLink) policyLink.hidden = true;
  }
  // app-source-end

  return { renderCoinChat, visibleCoinChatMessages, tokenChatAuthorLabel, tokenChatEmptyMarkup, tokenChatMessageMarkup, tokenChatComposerMarkup, renderCoinCommunityPanel, ensureCoinCommunityPanel, loadCoinChat, ensureCoinChatTab, ensureCoinPolicyAccordion, ensureCoinTradeFilterPanel, coinTradeFilterValues, updateCoinTradeFilterPanel, renderCoinActivityTab, renderOnChainUnavailable };
}
