import { filterAndSortRecentTrades } from '../../../coin-detail-model.js';
import { formatTradeAmountInput } from '../../../trade-amount-input.js';
import { formatTokenBaseAmount } from '../../../trade-panel-balance.js';
import { escapeHtml, shortAddress, formatOnChainNumber, formatUsd } from '../shared/display.js';

// Presentation only: callers own state, requests, and transaction lifecycles.
export function renderCoinActivityTab({ coinMarketActivity, coinActivity, COIN_TRADE_COLUMNS, coinTradeSort, coinTradeFilter, coinTradeOpenFilter, coinSolUsdValues, coinSolUsdPrice }, { updateCoinTradeFilterPanel, renderCoinChat, coinTradeFilterValues, getCoinMintAddress, formatCoinSnapshotUsd, formatOnchainAge, formatCoinUsd, exploreExplorer, loadVerifiedTokenLogos, document = globalThis.document } = {}){
  const activity = document.querySelector('#coin-activity-list');
  if (!activity) return;
  const tab = document.querySelector('[data-coin-tab].active')?.dataset.coinTab || 'trades';
  const tradeToolbar = document.querySelector('#coin-trade-toolbar');
  if (tradeToolbar) tradeToolbar.hidden = tab !== 'trades';
  if (tab === 'trades') updateCoinTradeFilterPanel();
  else { const tradeRefine = document.querySelector('#coin-trade-refine'); if (tradeRefine) tradeRefine.hidden = true; }
  if (tab === 'chat') { renderCoinChat(activity); return; }
  if (tab === 'trades' && coinMarketActivity.status === 'loading') {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Reading confirmed Pump trades…</strong><small>The 24-hour activity feed is loading from Solana RPC.</small></div>';
    return;
  }
  if (tab === 'trades' && coinMarketActivity.status === 'unavailable') {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Recent trades unavailable</strong><small>We could not load confirmed trades for this token. You can still check fees, rewards, and holders in the other tabs.</small></div>';
    return;
  }
  if (tab === 'trades' && coinMarketActivity.status === 'summary-only') {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Trade rows not indexed</strong><small>The 24-hour summary is available, but this cached response has no individual trade records. Refresh after the cache expires.</small></div>';
    return;
  }
  if (tab === 'trades') {
    const filters = coinTradeFilterValues();
    const trades = filterAndSortRecentTrades(coinMarketActivity.trades, filters);
    const mint = getCoinMintAddress();
    const symbol = coinActivity.symbol || 'TOKEN';
    const explorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h14l-3 3H3z" fill="#78e7b4"/><path d="M4 10h14l3 3H7z" fill="#ab91ff"/><path d="M6 16h14l-3 3H3z" fill="#78e7b4"/></svg>';
    const rows = trades.map(item => {
      const timestamp = Number(item.blockTime) * 1000;
      const validTime = Number.isFinite(timestamp) && timestamp > 0 && timestamp < 8.64e15;
      const time = validTime ? new Date(timestamp).toLocaleString() : 'Time unavailable';
      const sol = Number(item.solLamports) / 1_000_000_000;
      const tokens = Number(item.tokenAmountRaw) / (10 ** coinMarketActivity.decimals);
      const side = item.side === 'buy' ? 'Buy' : 'Sell';
      const tokenQuantity = Number.isFinite(tokens) ? formatOnChainNumber(tokens, tokens >= 1 ? 2 : 6) : '—';
      const price = Number.isFinite(sol) && Number.isFinite(tokens) && tokens > 0 ? formatCoinSnapshotUsd(sol / tokens) : '$—';
      return `<tr class="coin-transaction-row ${item.side === 'buy' ? 'is-buy' : 'is-sell'}" data-logo-mint="${escapeHtml(mint)}"><td><time datetime="${validTime ? new Date(timestamp).toISOString() : ''}" title="${escapeHtml(time)}">${validTime ? escapeHtml(formatOnchainAge(timestamp)) : '—'}</time></td><td><span class="coin-transaction-side"><i aria-hidden="true">${item.side === 'buy' ? '↑' : '↓'}</i>${side}</span></td><td class="coin-transaction-number">${Number.isFinite(sol) ? escapeHtml(formatCoinUsd(sol)) : '$—'}</td><td><span class="coin-transaction-token"><span class="coin-trade-token-avatar" aria-hidden="true">${escapeHtml(symbol.slice(0, 1).toUpperCase())}</span><span>${escapeHtml(tokenQuantity)} <small>${escapeHtml(symbol)}</small></span></span></td><td class="coin-transaction-number">${Number.isFinite(sol) ? escapeHtml(formatOnChainNumber(sol, 6)) : '—'}</td><td class="coin-transaction-number">${escapeHtml(price)}</td><td><a class="coin-transaction-trader" href="/wallet/${encodeURIComponent(item.trader)}" aria-label="View wallet profile for ${escapeHtml(item.trader)}">${escapeHtml(shortAddress(item.trader))}</a></td><td><a class="coin-trade-explorer" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(item.signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="View ${side} ${escapeHtml(symbol)} transaction on Solana Explorer" title="View transaction on Solana Explorer">${explorerIcon}</a></td></tr>`;
    }).join('');
    const headers = COIN_TRADE_COLUMNS.map(([key, label]) => {
      const active = coinTradeSort.key === key;
      const direction = active ? coinTradeSort.direction : 'none';
      const fieldNames = { date: ['dateFrom', 'dateTo'], type: ['side'], usd: ['minUsd', 'maxUsd'], token: ['minToken', 'maxToken'], sol: ['minSol', 'maxSol'], price: ['minPrice', 'maxPrice'], trader: ['wallet'], txn: ['signature'] };
      const filtered = key === 'type' ? coinTradeFilter !== 'all' : fieldNames[key].some(name => filters[name] !== '' && filters[name] != null);
      const filterTarget = key === 'trader' ? 'coin-trade-wallet' : 'coin-trade-refine';
      const expanded = key === 'trader' ? '' : ` aria-expanded="${coinTradeOpenFilter === key}"`;
      return `<th scope="col" aria-sort="${direction === 'none' ? 'none' : direction === 'asc' ? 'ascending' : 'descending'}"><div class="coin-trade-column-head"><button type="button" class="coin-trade-sort" data-coin-trade-sort="${key}" aria-label="Sort ${label} ${active && direction === 'asc' ? 'descending' : 'ascending'}">${label}<span aria-hidden="true">${active ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button><button type="button" class="coin-trade-column-filter${filtered ? ' is-active' : ''}" data-coin-column-filter="${key}" aria-label="Filter ${label}"${expanded} aria-controls="${filterTarget}" title="Filter ${label}">⌕</button></div></th>`;
    }).join('');
    const empty = !trades.length ? `<tr><td colspan="8" class="coin-trade-no-results">${coinMarketActivity.trades.length ? 'No trades match these filters.' : 'No confirmed trades in the last 24 hours.'}${coinMarketActivity.coverage === 'partial' ? ' Some trade history is missing.' : ''}</td></tr>` : '';
    activity.innerHTML = `<div class="coin-transactions-scroll" role="region" aria-label="${escapeHtml(symbol)} transactions" tabindex="0"><table class="coin-transactions-table coin-trades-table"><thead><tr>${headers}</tr></thead><tbody>${rows || empty}</tbody></table></div>`;
    if (trades.length) loadVerifiedTokenLogos(activity);
    return;
  }
  if (coinActivity.status === 'loading') {
    activity.innerHTML = '<div class="coin-activity-row"><span class="activity-icon">◎</span><span><strong>Reading token records</strong><small>Confirmed Solana RPC request in progress</small></span><b class="activity-amount">—</b><span class="activity-time">RPC</span></div>';
    return;
  }
  if (coinActivity.status === 'unavailable') {
    activity.innerHTML = `<div class="coin-activity-row"><span class="activity-icon">!</span><span><strong>Token data unavailable</strong><small>${escapeHtml(coinActivity.message || 'Solana RPC could not load this mint.')}</small></span><b class="activity-amount">—</b><span class="activity-time">RPC</span></div>`;
    return;
  }
  if (tab === 'holders') {
    if (!coinActivity.holderDistribution) { activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Full holder list unavailable</strong><small>Verified wallet owners and token-account balances must reconcile to the minted supply before holders are shown.</small></div>'; return; }
    const holderAccounts = coinActivity.holderDistribution.holders;
    const explorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h14l-3 3H3z" fill="#78e7b4"/><path d="M4 10h14l3 3H7z" fill="#ab91ff"/><path d="M6 16h14l-3 3H3z" fill="#78e7b4"/></svg>';
    const rows = holderAccounts.map((item, index) => {
      const share = Number.isFinite(item.share) ? Math.max(0, Math.min(100, item.share)) : null;
      const wallet = item.wallet;
      const balance = Number(item.amountRaw) / (10 ** coinActivity.tokenDecimals);
      const value = Number.isFinite(balance) && Number.isFinite(coinSolUsdValues.spot) && coinSolUsdValues.spot > 0 && Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0 ? formatUsd(balance * coinSolUsdValues.spot * coinSolUsdPrice) : '$—';
      const profile = `/wallet/${encodeURIComponent(wallet)}`;
      const tradeAction = `<button type="button" class="coin-holder-trades" data-coin-holder-trades="${escapeHtml(wallet)}" aria-label="Show recent trades by ${escapeHtml(wallet)}" title="Filter recent trades by this wallet">⌕</button>`;
      const amount = formatTradeAmountInput(formatTokenBaseAmount(item.amountRaw, coinActivity.tokenDecimals, Math.min(coinActivity.tokenDecimals, 6)));
      return `<tr><td class="coin-holder-rank">#${index + 1}</td><td><a class="coin-holder-address" href="${escapeHtml(profile)}" title="${escapeHtml(wallet)}">${escapeHtml(shortAddress(wallet))}</a></td><td class="coin-holder-percent">${escapeHtml(formatOnChainNumber(share, 2))}%</td><td><div class="coin-holder-amount"><strong>${escapeHtml(amount)} <small>${escapeHtml(coinActivity.symbol)}</small></strong><span class="coin-holder-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, share))}%"></i></span></div></td><td class="coin-holder-value">${escapeHtml(value)}</td><td class="coin-holder-action">${tradeAction}</td><td class="coin-holder-action"><a class="coin-trade-explorer" href="${escapeHtml(exploreExplorer(`address/${encodeURIComponent(wallet)}`))}" target="_blank" rel="noopener noreferrer" aria-label="View wallet ${escapeHtml(wallet)} on Solana Explorer" title="View wallet on Solana Explorer">${explorerIcon}</a></td></tr>`;
    }).join('');
    activity.innerHTML = rows ? `<div class="coin-transactions-scroll coin-holders-scroll" role="region" aria-label="${escapeHtml(coinActivity.symbol)} complete holder wallets" tabindex="0"><table class="coin-transactions-table coin-holders-table"><thead><tr><th scope="col">Rank</th><th scope="col">Wallet</th><th scope="col">% supply</th><th scope="col">Amount</th><th scope="col" title="Spot token price at the current SOL/USD quote">Value est.</th><th scope="col">Txns</th><th scope="col">Explore</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state coin-activity-empty"><strong>No holder wallets</strong><small>The reconciled token supply is entirely in the protocol vault.</small></div>';
    return;
  }
  if (!coinActivity.ledgerAvailable) {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Fee activity unavailable</strong><small>We could not confirm fee collections or reward shares for this token.</small></div>';
    return;
  }
  const feeExplorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h14l-3 3H3z" fill="#78e7b4"/><path d="M4 10h14l3 3H7z" fill="#ab91ff"/><path d="M6 16h14l-3 3H3z" fill="#78e7b4"/></svg>';
  const feeDate = value => {
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? `<time datetime="${new Date(timestamp).toISOString()}" title="${escapeHtml(new Date(timestamp).toLocaleString())}">${escapeHtml(formatOnchainAge(timestamp))}</time>` : '—';
  };
  const feeExplorer = (signature, label = 'View collection transaction on Solana Explorer') => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature || '')
    ? `<a class="coin-trade-explorer" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${feeExplorerIcon}</a>` : '—';
  if (tab === 'claims') {
    const rows = coinActivity.claims.map(item => {
      const gross = item.grossCreatorFees == null ? NaN : Number(item.grossCreatorFees);
      const status = String(item.status || 'recorded').replace(/[-_]/g, ' ');
      const statusLabel = status === 'obligations created' ? 'Shares recorded' : status.charAt(0).toUpperCase() + status.slice(1);
      return `<tr><td>${feeDate(item.claimedAt)}</td><td><strong class="coin-fee-event">Fee split recorded</strong><small class="coin-fee-detail">Linked to collection ${escapeHtml(shortAddress(item.claimSignature || ''))}</small></td><td class="coin-fee-amount">${Number.isFinite(gross) ? `${escapeHtml(formatOnChainNumber(gross, 9))} ${escapeHtml(item.asset || 'SOL')}` : '—'}</td><td><span class="coin-fee-status">${escapeHtml(statusLabel)}</span></td><td class="coin-fee-action">${feeExplorer(item.claimSignature, 'View related fee collection on Solana Explorer')}</td></tr>`;
    }).join('');
    activity.innerHTML = rows ? `<p class="coin-activity-scope">Fee shares set aside from this token. These amounts may not have been paid yet.</p><div class="coin-transactions-scroll" role="region" aria-label="${escapeHtml(coinActivity.symbol)} fee allocations" tabindex="0"><table class="coin-transactions-table coin-fee-table coin-fee-allocations-table"><thead><tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Gross fees</th><th scope="col">Status</th><th scope="col">Txn</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state coin-activity-empty"><strong>No reward shares recorded for this token</strong><small>Fees that cannot be linked to this token are excluded.</small></div>';
    return;
  }
  const mintRows = coinActivity.collections.map(item => {
    const sol = item.collectedLamports == null ? NaN : Number(item.collectedLamports) / 1_000_000_000;
    return `<tr><td>${feeDate(item.recordedAt)}</td><td><strong class="coin-fee-event">Creator fees collected</strong><small class="coin-fee-detail">Collected for this token</small></td><td class="coin-fee-amount">${Number.isFinite(sol) ? `${escapeHtml(formatOnChainNumber(sol, 9))} SOL` : '—'}</td><td class="coin-fee-amount">${Number.isFinite(sol) ? escapeHtml(formatCoinUsd(sol)) : '$—'}</td><td class="coin-fee-action">${feeExplorer(item.signature)}</td></tr>`;
  }).join('');
  const routerRows = (coinActivity.sharedRouterCollections || []).map(item => {
    const sol = Number(item.collectedLamports) / 1_000_000_000;
    return `<tr><td>${feeDate(item.recordedAt)}</td><td><strong class="coin-fee-event">Combined fee collection</strong><small class="coin-fee-detail">Not linked to this token</small></td><td class="coin-fee-amount">${Number.isFinite(sol) ? `${escapeHtml(formatOnChainNumber(sol, 9))} SOL` : '—'}</td><td class="coin-fee-amount">${Number.isFinite(sol) ? escapeHtml(formatCoinUsd(sol)) : '$—'}</td><td class="coin-fee-action">${feeExplorer(item.signature)}</td></tr>`;
  }).join('');
  const table = (rows, label) => `<div class="coin-transactions-scroll" role="region" aria-label="${escapeHtml(label)}" tabindex="0"><table class="coin-transactions-table coin-fee-table coin-fee-collections-table"><thead><tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Amount</th><th scope="col" title="At the current SOL/USD quote">USD est.</th><th scope="col">Txn</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  activity.innerHTML = (mintRows ? `<p class="coin-activity-scope">Fees collected for this token. Check Rewards for confirmed payments to recipients.</p>${table(mintRows, `${coinActivity.symbol} fee collections`)}` : '<div class="empty-state coin-activity-empty"><strong>No fee collections recorded for this token</strong><small>Only fees confirmed for this token appear here.</small></div>') + (routerRows ? `<div class="coin-activity-context"><strong>Combined fee collections</strong><span>These may include other tokens and are excluded from this token’s totals.</span></div>${table(routerRows, 'Combined fee collections')}` : '');
}
