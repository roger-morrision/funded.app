import { walletBonusCoverage } from './wallet-history-model.js';
import { setCoinField as writeCoinField, shortAddress, escapeHtml, formatDashboardUsd, formatOnChainNumber } from '../shared/display.js';
import { formatTokenBaseUnits } from '../../../funded-burn.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderWalletDetail(
  {
    connectedWalletAddress,
    verifiedLaunchPoliciesStatus,
    exploreScannedCount,
    assets,
    exploreProviderStatus,
    walletBalanceLamports,
    coinSolUsdPrice,
    walletDetailTab,
    walletDetailFilter,
    walletHistory,
    fundedBurnState,
  },
  {
    getWalletDetailAddress,
    walletDetailLaunches,
    walletDetailTrades,
    walletDetailBurned,
    walletLaunchTimestamp,
    validateSolanaMint,
    getFollowedWallets,
    formatSol,
    formatOnchainAge,
    walletDetailEmpty,
    loadWalletRowLogos,
    exploreExplorer,
    document = globalThis.document,
  } = {}
) {
  const setCoinField = (selector, value) => writeCoinField(selector, value, document);
  const page = document.querySelector('#wallet-page');
  if (!page) return;
  const address = getWalletDetailAddress();
  const isSelf = Boolean(address && address === connectedWalletAddress);
  const launches = walletDetailLaunches(address);
  const trades = walletDetailTrades(address);
  const burned = walletDetailBurned(launches);
  const registryReady = verifiedLaunchPoliciesStatus === 'ready';
  const tradeScanReady = exploreScannedCount > 0 && assets.length > 0;
  const tradeScanStale = exploreProviderStatus.includes('stale');
  const scanNote = tradeScanReady ? `Trades shown for ${exploreScannedCount} of ${assets.length} listed coins${tradeScanStale ? ' (last available update)' : ''}` : 'Recent trades are unavailable';
  const launchTimes = launches.map(walletLaunchTimestamp).filter(time => time > 0);
  const tradeTimes = trades.map(item => Number(item.blockTime) * 1000).filter(Number.isFinite);
  const history = isSelf && walletHistory?.wallet === address ? walletHistory : { status:'idle', rows:[], coverage:{} };
  const lastActivity = Math.max(0, ...launchTimes, ...tradeTimes, ...history.rows.map(row => row.time || 0));
  const volume = trades.reduce((sum, trade) => sum + Number(trade.solAmount || 0), 0);
  const title = document.querySelector('#wallet-page-title');
  const addressNode = document.querySelector('#wallet-page-address');
  const selfBadge = document.querySelector('#wallet-self-badge');
  const edit = document.querySelector('#wallet-edit-profile');
  const follow = document.querySelector('#wallet-follow');
  if (title) title.textContent = isSelf ? 'Your wallet' : address ? shortAddress(address) : 'Wallet';
  if (addressNode) addressNode.textContent = address || 'Wallet address unavailable';
  if (selfBadge) selfBadge.hidden = !isSelf;
  if (edit) edit.hidden = !isSelf;
  if (follow) {
    const valid = validateSolanaMint(address).valid;
    const active = valid && getFollowedWallets().some(row => row.address === address);
    follow.hidden = !valid;
    follow.textContent = active ? 'Following ✓' : 'Follow wallet';
    follow.setAttribute('aria-pressed', String(active));
    follow.setAttribute('aria-label', `${active ? 'Unfollow' : 'Follow'} ${escapeHtml(address || 'wallet')} on this device`);
  }
  const statSol = document.querySelector('#wallet-stat-sol');
  const statSolNote = document.querySelector('#wallet-stat-sol-note');
  if (statSol) statSol.textContent = isSelf && walletBalanceLamports != null ? formatSol(walletBalanceLamports) : '—';
  if (statSolNote) statSolNote.textContent = isSelf ? (walletBalanceLamports == null ? 'Balance currently unavailable' : 'Connected wallet balance') : 'Connect this wallet to view balance';
  setCoinField('#wallet-stat-launches', registryReady ? String(launches.length) : '—');
  setCoinField('#wallet-stat-trades', tradeScanReady ? String(trades.length) : '—');
  setCoinField('#wallet-stat-trades-note', scanNote);
  const hasSolUsdQuote = Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0;
  setCoinField('#wallet-stat-volume', !tradeScanReady ? '$—' : !trades.length ? '$0.00' : hasSolUsdQuote ? formatDashboardUsd(volume * coinSolUsdPrice) : '$—');
  setCoinField('#wallet-stat-volume-note', !tradeScanReady ? scanNote : !trades.length ? 'No recent trades found' : hasSolUsdQuote ? 'Estimated USD at the current SOL price' : 'SOL price unavailable');
  setCoinField('#wallet-stat-burned', !registryReady ? '—' : burned > 0 ? formatOnChainNumber(burned, 2) : launches.length ? '0' : '—');
  setCoinField('#wallet-stat-last', lastActivity ? formatOnchainAge(lastActivity) : '—');
  document.querySelectorAll('[data-wallet-tab]').forEach(button => { const active = button.dataset.walletTab === walletDetailTab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  const description = document.querySelector('#wallet-detail-description');
  const content = document.querySelector('#wallet-detail-content');
  const filters = document.querySelector('#wallet-detail-filters');
  const historyFilters = ['claim','reward','airdrop','bonus'];
  const activeFilter = !isSelf && historyFilters.includes(walletDetailFilter) ? 'all' : walletDetailFilter;
  if (filters) {
    filters.hidden = walletDetailTab !== 'activity';
    filters.querySelectorAll('[data-wallet-filter]').forEach(button => {
      button.hidden = !isSelf && historyFilters.includes(button.dataset.walletFilter);
      button.setAttribute('aria-pressed', String(button.dataset.walletFilter === activeFilter));
    });
  }
  if (!content || !description) return;
  if (walletDetailTab === 'balances') {
    description.textContent = 'Balances are shown when current information is available.';
    const fundedBalance = isSelf && fundedBurnState.wallet === address && fundedBurnState.status === 'ready'
      ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6)
      : isSelf && fundedBurnState.wallet === address && fundedBurnState.status === 'loading' ? 'Checking Solana…' : 'Unavailable';
    content.innerHTML = `<div class="wallet-balance-grid"><article><span class="header-solana-mark" aria-hidden="true"></span><div><strong>${escapeHtml(isSelf && walletBalanceLamports != null ? formatSol(walletBalanceLamports) : 'Unavailable')}</strong><small>Native SOL</small></div></article><article><span class="wallet-funded-mark" aria-hidden="true">f</span><div><strong>${escapeHtml(fundedBalance)}</strong><small>$FUNDED token balance${fundedBalance !== 'Unavailable' && fundedBalance !== 'Checking Solana…' ? ' · live' : ''}</small></div></article></div>`;
    return;
  }
  const launchRows = launches.map(launch => ({ type:'launch', time:walletLaunchTimestamp(launch), mint:launch.mint, html:`<a class="wallet-activity-row" data-token-mint="${escapeHtml(launch.mint)}" href="/token/${encodeURIComponent(launch.mint)}"><span class="wallet-activity-icon">✦</span><span><strong>Created ${escapeHtml(launch.name || launch.symbol || 'token')}</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} · ${escapeHtml(shortAddress(launch.mint))}</small></span><b>Verified<small>${walletLaunchTimestamp(launch) ? escapeHtml(formatOnchainAge(walletLaunchTimestamp(launch))) : 'Time unavailable'}</small></b></a>` }));
  if (walletDetailTab === 'created') {
    description.textContent = registryReady ? 'Confirmed coins created by this wallet.' : 'Created coins are unavailable right now.';
    content.innerHTML = launchRows.map(row => row.html).join('') || (registryReady ? walletDetailEmpty('No created coins found', 'No confirmed launch was found for this wallet.') : walletDetailEmpty('Created coins unavailable', 'Please check again later.'));
    loadWalletRowLogos(content, launches);
    return;
  }
  description.textContent = isSelf
    ? `Confirmed wallet payments and airdrop claims, plus launches, burns, and recent trades. ${scanNote}.`
    : `Confirmed launches and burns, plus recent trades from the last 24 hours. ${scanNote}.`;
  const tradeRows = trades.map(trade => ({ type:trade.side, time:Number(trade.blockTime) * 1000 || 0, html:`<a class="wallet-activity-row" data-token-mint="${escapeHtml(trade.mint)}" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(trade.signature)}`))}" target="_blank" rel="noopener noreferrer"><span class="wallet-activity-icon ${trade.side}">${trade.side === 'buy' ? '↗' : '↘'}</span><span><strong>${trade.side === 'buy' ? 'Bought' : 'Sold'} ${escapeHtml(trade.symbol || 'token')}</strong><small>${escapeHtml(shortAddress(trade.mint))}</small></span><b>${escapeHtml(formatOnChainNumber(trade.solAmount, 4))} SOL<small>${escapeHtml(formatOnchainAge(Number(trade.blockTime) * 1000))}</small></b></a>` }));
  const seenBurns = new Set();
  const burnRows = launches.flatMap(launch => {
    const burn = launch.creatorLaunchBurn;
    const receipt = burn?.receipt;
    if (burn?.status !== 'verified' || !receipt?.signature || seenBurns.has(receipt.signature)) return [];
    seenBurns.add(receipt.signature);
    const amount = Number(receipt.amountTokens ?? burn.amountTokens);
    return [{ type:'burn', time:Date.parse(launch.onchainVerifiedAt || launch.createdAt || '') || 0, html:`<a class="wallet-activity-row" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer"><span class="wallet-activity-icon burn">♨</span><span><strong>Burned $FUNDED</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} launch · confirmed</small></span><b>${Number.isFinite(amount) ? escapeHtml(formatOnChainNumber(amount, 2)) : '—'} $FUNDED<small>View transaction ↗</small></b></a>` }];
  });
  const historyRows = history.rows.map(row => ({ type:row.type, time:row.time || 0,
    html:`<a class="wallet-activity-row" href="${escapeHtml(row.href)}" target="_blank" rel="noopener noreferrer"><span class="wallet-activity-icon ${escapeHtml(row.type)}" aria-hidden="true">${({claim:'✓',reward:'✦',airdrop:'◈',bonus:'★'})[row.type]}</span><span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.detail)}</small></span><b>${escapeHtml(row.amount)}<small>${row.time ? escapeHtml(formatOnchainAge(row.time)) : 'View on-chain proof ↗'}</small></b></a>` }));
  const rows = [...tradeRows, ...launchRows, ...burnRows, ...historyRows]
    .filter(row => activeFilter === 'all' || row.type === activeFilter)
    .sort((a,b) => b.time - a.time);
  const historyCoverage = history.coverage?.[activeFilter];
  const historyUnavailable = isSelf && historyFilters.includes(activeFilter)
    && (history.status === 'loading' || historyCoverage === 'unavailable'
      || historyCoverage === 'partial' || historyCoverage === 'sign-in-required' || historyCoverage === 'pending');
  const coverageIncomplete = (['all', 'launch', 'burn'].includes(activeFilter) && !registryReady)
    || (['all', 'buy', 'sell'].includes(activeFilter) && !tradeScanReady)
    || (activeFilter === 'all' && isSelf && (history.status === 'loading'
      || ['claim','reward','airdrop'].some(kind => history.coverage?.[kind] === 'unavailable')
      || ['partial','unavailable'].includes(history.coverage?.bonus)));
  const unavailableDetail = history.status === 'loading' ? 'Checking this wallet’s confirmed history…'
    : activeFilter === 'bonus' ? walletBonusCoverage(history.coverage).message
    : historyCoverage === 'sign-in-required' ? 'Verify this wallet in Referrals to see private bonus records.'
    : historyCoverage === 'pending' ? 'V3 referral bonus payouts are not active yet.'
    : 'This history could not be verified right now. Please retry later.';
  content.innerHTML = rows.map(row => row.html).join('')
    || walletDetailEmpty(historyUnavailable || coverageIncomplete ? 'Activity unavailable' : 'No matching activity',
      historyUnavailable ? unavailableDetail
        : coverageIncomplete ? 'Some activity cannot be shown right now. Please check again later.'
          : activeFilter === 'all' ? 'No confirmed launches, trades, burns, or wallet payments were found.'
            : `No confirmed ${activeFilter} history was found for this wallet.`);
  if (isSelf && ['all', 'bonus'].includes(activeFilter) && history.status === 'ready') {
    const note = document.createElement('p'); note.className = 'source-note'; note.dataset.walletBonusCoverage = '';
    note.textContent = walletBonusCoverage(history.coverage).message;
    content.append(note);
  }
  loadWalletRowLogos(content, launches);
}
