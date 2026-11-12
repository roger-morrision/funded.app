import { walletBonusCoverage } from './wallet-history-model.js';
import { setCoinField as writeCoinField, shortAddress, escapeHtml, formatDashboardUsd, formatOnChainNumber } from '../shared/display.js';
import { formatTokenBaseUnits } from '../../../funded-burn.js';
import { tokenIdentityMarkup } from '../shared/token-identity.js';
import { portfolioTokenIdentity } from '../../../token-identity.js';
import { holdingImageUrl } from './holdings-metadata.js';
import { tokenArtworkUrl } from '../shared/token-artwork.js';

// DOM identity belongs to one displayed wallet and only its Created tab.
const createdWalletRows = new WeakMap();

function reconcileCreatedRows(content, address, rows, emptyHtml, document) {
  const previous = createdWalletRows.get(content);
  const sameWallet = previous?.address === address;
  const active = document.activeElement;
  const ownedFocus = sameWallet && [...previous.rows.values()].includes(active);
  const next = new Map();
  for (const row of rows) {
    if (next.has(row.mint)) continue;
    let anchor = sameWallet && previous.rows.get(row.mint);
    const template = document.createElement('template');
    template.innerHTML = row.html;
    const fresh = template.content.firstElementChild;
    if (!anchor) anchor = fresh;
    else {
      anchor.setAttribute('href', fresh.getAttribute('href'));
      // Retire the old icon so its pending image callbacks cannot overwrite
      // newer artwork. The focused link itself stays connected and active.
      anchor.replaceChildren(...fresh.childNodes);
    }
    next.set(row.mint, anchor);
  }
  const retainedFocus = ownedFocus && [...next.values()].includes(active);
  for (const child of [...content.children]) if (![...next.values()].includes(child)) child.remove();
  const anchors = [...next.values()];
  if (retainedFocus) {
    // Move siblings around the focused anchor: detaching/reinserting that anchor
    // would lose focus in browsers without state-preserving DOM moves.
    const index = anchors.indexOf(active);
    for (const anchor of anchors.slice(0, index)) content.insertBefore(anchor, active);
    let after = null;
    for (const anchor of anchors.slice(index + 1).reverse()) {
      if (anchor.nextSibling !== after) content.insertBefore(anchor, after);
      after = anchor;
    }
    active.scrollIntoView({ block:'nearest', behavior:'instant' });
  } else {
    let cursor = content.firstElementChild;
    for (const anchor of anchors) {
      if (anchor !== cursor) content.insertBefore(anchor, cursor);
      cursor = anchor.nextElementSibling;
    }
  }
  if (!anchors.length) content.innerHTML = emptyHtml;
  createdWalletRows.set(content, { address, rows:next });
  if (ownedFocus && !retainedFocus) document.querySelector('[data-wallet-tab="created"][aria-selected="true"]')?.focus();
}

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderWalletDetail(
  {
    connectedWalletAddress,
    portfolioHoldings,
    portfolioTradeHistory,
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
    PROTOCOL_FUNDED_MINT,
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
    verifiedLaunchPolicyForMint,
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
  const directTrades=portfolioTradeHistory?.wallet===address?portfolioTradeHistory:null;
  const tradeScanReady = directTrades ? directTrades.status==='ready' : exploreScannedCount > 0 && assets.length > 0;
  const tradeScanStale = exploreProviderStatus.includes('stale');
  const scanNote = directTrades ? directTrades.status==='loading' ? 'Checking finalized wallet trades'
    : directTrades.status==='ready' ? `${directTrades.scannedSignatures} wallet transactions checked · ${directTrades.coverage} trade history`
      : 'Wallet trade history is unavailable'
    : tradeScanReady ? `Trades shown for ${exploreScannedCount} of ${assets.length} listed coins${tradeScanStale ? ' (last available update)' : ''}` : 'Recent trades are unavailable';
  const publicScopeNote = !isSelf && tradeScanReady && (directTrades
    ? directTrades.coverage === 'partial' : exploreScannedCount < assets.length || tradeScanStale) ? ` ${scanNote}.` : '';
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
    follow.setAttribute('aria-label', `${active ? 'Unfollow' : 'Follow'} ${escapeHtml(address || 'wallet')}`);
  }
  const statSol = document.querySelector('#wallet-stat-sol');
    const statSolNote = document.querySelector('#wallet-stat-sol-note');
    if (statSol) statSol.textContent = walletBalanceLamports != null ? formatSol(walletBalanceLamports) : '—';
    if (statSolNote) statSolNote.textContent = isSelf ? (walletBalanceLamports == null ? 'Balance currently unavailable' : 'Connected wallet balance') : 'Wallet SOL balance';
  setCoinField('#wallet-stat-launches', registryReady ? String(launches.length) : '—');
  setCoinField('#wallet-stat-trades', tradeScanReady ? String(trades.length) : '—');
  setCoinField('#wallet-stat-trades-note', scanNote);
  const hasSolUsdQuote = Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0;
  setCoinField('#wallet-stat-volume', !tradeScanReady ? '$—' : !trades.length ? '$0.00' : hasSolUsdQuote ? formatDashboardUsd(volume * coinSolUsdPrice) : '$—');
  setCoinField('#wallet-stat-volume-note', !tradeScanReady ? scanNote : !trades.length ? isSelf ? 'No recent trades found' : `No trades observed in available 24-hour records.${publicScopeNote}` : hasSolUsdQuote ? 'Estimated USD at the current SOL price' : 'SOL price unavailable');
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
    if (walletDetailTab !== 'created') createdWalletRows.delete(content);
    if (walletDetailTab === 'holdings') {
      description.textContent = 'Token balances from Solana RPC.';
      const assetByMint = new Map(assets.map(asset => [asset.address, asset]));
      const holdings = isSelf && portfolioHoldings?.wallet === address && portfolioHoldings?.status === 'ready'
        ? portfolioHoldings.accounts
        : [];
      if (!holdings.length) {
        content.innerHTML = `<div class="empty-state">${isSelf ? 'No SPL token holdings in this wallet.' : 'Holdings shown only for your connected wallet.'}</div>`;
        return;
      }
      content.innerHTML = `<div class="wallet-balance-table-wrap" role="region" aria-label="Token holdings" tabindex="0"><table class="wallet-balance-table"><thead><tr><th scope="col">Token</th><th scope="col" class="numeric">Quantity</th><th scope="col" class="numeric">Value</th></tr></thead><tbody>${holdings.map(holding => {
        const asset = assetByMint.get(holding.mint);
        const marketUsd = Number(holding.market?.priceUsd);
        const unitUsd = marketUsd > 0 && Number.isFinite(marketUsd) ? marketUsd : null;
        const holdingValue = unitUsd == null ? null : holding.quantity * unitUsd;
        const launch = verifiedLaunchPolicyForMint?.(holding.mint);
        const identity = portfolioTokenIdentity(holding.mint, {asset, launch, metadata:holding.metadata, fundedMint:PROTOCOL_FUNDED_MINT});
        const image = holding.mint === PROTOCOL_FUNDED_MINT ? '/richpad-mark.svg' : (launch?.onchainVerified ? tokenArtworkUrl(holding.mint, holdingImageUrl(launch.imageUri)) : null) || holdingImageUrl(holding.metadata?.image) || holdingImageUrl(asset?.imageUri) || holdingImageUrl(asset?.market?.logoUri);
        return `<tr><td><a href="/token/${encodeURIComponent(holding.mint)}"><span class="wallet-holding-token"><span class="wallet-holding-logo" aria-hidden="true">${escapeHtml(identity.label==='Unnamed token'?'?':identity.label.replace(/^\\$/,'').slice(0,2))}${image?`<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`:''}</span><span class="wallet-holding-identity"><strong>${escapeHtml(identity.label)}</strong><small>${escapeHtml(identity.description)}</small><small class="wallet-token-address" title="${escapeHtml(holding.mint)}">${escapeHtml(identity.address)}</small></span></span></a></td><td class="numeric">${escapeHtml(formatOnChainNumber(holding.quantity, 6))}</td><td class="numeric">${holdingValue == null ? '—' : escapeHtml(formatDashboardUsd(holdingValue))}</td></tr>`;
      }).join('')}</tbody></table></div>`;
      loadWalletRowLogos(content, holdings.map(h => ({ mint: h.mint })));
      return;
    }
  const launchRows = launches.map(launch => ({ type:'launch', time:walletLaunchTimestamp(launch), mint:launch.mint, html:`<a class="wallet-activity-row" data-token-mint="${escapeHtml(launch.mint)}" href="/token/${encodeURIComponent(launch.mint)}"><span class="wallet-activity-icon">✦</span><span><strong>Created ${escapeHtml(launch.name || launch.symbol || 'token')}</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} · ${escapeHtml(shortAddress(launch.mint))}</small></span><b>Verified<small>${walletLaunchTimestamp(launch) ? escapeHtml(formatOnchainAge(walletLaunchTimestamp(launch))) : 'Time unavailable'}</small></b></a>` }));
  if (walletDetailTab === 'created') {
    description.textContent = registryReady ? 'Confirmed coins created by this wallet.' : 'Created coins are unavailable right now.';
    reconcileCreatedRows(content, address, launchRows, registryReady ? walletDetailEmpty('No created coins found', 'No confirmed launch was found for this wallet.') : walletDetailEmpty('Created coins unavailable', 'Please check again later.'), document);
    loadWalletRowLogos(content, launches);
    return;
  }
  // An unavailable scan would turn the whole guidance line into a quiet "-" (technical-notices.js).
  const shownScanNote = /unavailable/i.test(scanNote) ? '' : ` ${scanNote}.`;
  description.textContent = isSelf
    ? `Confirmed wallet payments and airdrop claims, plus launches, burns, and recent trades.${shownScanNote}`
    : `Confirmed launches and burns, plus recent trades from the last 24 hours.${shownScanNote}`;
  const tradeRows = trades.map(trade => ({ type:trade.side, time:Number(trade.blockTime) * 1000 || 0, html:`<a class="wallet-activity-row" data-token-mint="${escapeHtml(trade.mint)}" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(trade.signature)}`))}" target="_blank" rel="noopener noreferrer"><span class="wallet-activity-icon ${trade.side}">${trade.side === 'buy' ? '↗' : '↘'}</span><span><strong>${trade.side === 'buy' ? 'Bought' : 'Sold'} ${trade.symbol ? escapeHtml('$' + trade.symbol) : tokenIdentityMarkup(trade.mint, escapeHtml, 'token')}</strong><small>${escapeHtml(shortAddress(trade.mint))}</small></span><b>${escapeHtml(formatOnChainNumber(trade.solAmount, 4))} SOL<small>${escapeHtml(formatOnchainAge(Number(trade.blockTime) * 1000))}</small></b></a>` }));
  const seenBurns = new Set();
  const burnRows = launches.flatMap(launch => {
    const burn = launch.creatorLaunchBurn;
    const receipt = burn?.receipt;
    if (burn?.status !== 'verified' || !receipt?.signature || seenBurns.has(receipt.signature)) return [];
    seenBurns.add(receipt.signature);
    const amount = Number(receipt.amountTokens ?? burn.amountTokens);
    return [{ type:'burn', time:Date.parse(launch.onchainVerifiedAt || launch.createdAt || '') || 0, html:`<a class="wallet-activity-row" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer"><span class="wallet-activity-icon burn">♨</span><span><strong>Burned $RICH</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} launch · confirmed</small></span><b>${Number.isFinite(amount) ? escapeHtml(formatOnChainNumber(amount, 2)) : '—'} $RICH<small>View transaction ↗</small></b></a>` }];
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
    : activeFilter === 'bonus' ? 'Some bonus records are unavailable. See source coverage below.'
    : historyCoverage === 'sign-in-required' ? 'Verify this wallet in Referrals to see private bonus records.'
    : historyCoverage === 'pending' ? 'V3 referral bonus payouts are not active yet.'
    : 'This history could not be verified right now. Please retry later.';
  content.innerHTML = rows.map(row => row.html).join('')
    || walletDetailEmpty(historyUnavailable || coverageIncomplete ? activeFilter === 'bonus' ? 'Bonus history incomplete' : 'Activity unavailable' : 'No matching activity',
      historyUnavailable ? unavailableDetail
        : coverageIncomplete ? 'Some activity cannot be shown right now. Please check again later.'
          : !isSelf && ['all', 'buy', 'sell'].includes(activeFilter) ? `${activeFilter === 'all' ? 'No matching activity was found in the available public records.' : `No ${activeFilter === 'buy' ? 'buys' : 'sells'} were found in the available 24-hour trade records.`}${publicScopeNote}`
          : activeFilter === 'all' ? 'No confirmed launches, trades, burns, or wallet payments were found.'
            : `No confirmed ${activeFilter} history was found for this wallet.`);
  if (isSelf && ['all', 'bonus'].includes(activeFilter) && history.status === 'ready') {
    const note = document.createElement('p'); note.className = 'source-note'; note.dataset.walletBonusCoverage = '';
    note.textContent = walletBonusCoverage(history.coverage).message;
    content.append(note);
  }
  loadWalletRowLogos(content, launches);
}
