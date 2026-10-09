import { shortAddress, escapeHtml, formatOnChainNumber, formatDashboardUsd } from '../shared/display.js';
import { matchedTradePnl } from '../../../portfolio-model.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderPortfolio(
  {
    connectedWalletAddress,
    portfolioHoldings,
    assets,
    exploreScannedCount,
  },
  {
    portfolioUnitPriceUsd,
    walletDetailTrades,
    formatOnchainAge,
    exploreExplorer,
    document = globalThis.document,
  } = {}
) {
  const status = document.querySelector('#portfolio-holdings-status');
  const rows = document.querySelector('#portfolio-holding-rows');
  const value = document.querySelector('#portfolio-total-value');
  const pnl = document.querySelector('#portfolio-observed-pnl');
  const txRows = document.querySelector('#portfolio-trade-rows');
  const txNote = document.querySelector('#portfolio-trade-note');
  if (!status || !rows || !value || !pnl || !txRows || !txNote) return;
  const address = connectedWalletAddress;
  const current = portfolioHoldings.wallet === address && portfolioHoldings.status === 'ready';
  const holdings = current ? portfolioHoldings.accounts : [];
  const assetByMint = new Map(assets.map(asset => [asset.address, asset]));
  const decimalsByMint = new Map(assets.filter(asset => Number.isInteger(asset.mintDecimals)).map(asset => [asset.address, asset.mintDecimals]));
  for (const holding of holdings) decimalsByMint.set(holding.mint, holding.decimals);
  let pricedCount = 0;
  let total = 0;
  rows.innerHTML = holdings.map(holding => {
    const asset = assetByMint.get(holding.mint);
    const unitUsd = portfolioUnitPriceUsd(asset);
    const holdingValue = unitUsd == null ? null : holding.quantity * unitUsd;
    if (holdingValue != null) { pricedCount += 1; total += holdingValue; }
    const label = asset?.symbol || shortAddress(holding.mint);
    return `<a class="portfolio-holding-row" href="/token/${encodeURIComponent(holding.mint)}"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(asset?.name || shortAddress(holding.mint))}</small></span><span>${escapeHtml(formatOnChainNumber(holding.quantity, 6))}</span><span>${holdingValue == null ? '—' : escapeHtml(formatDashboardUsd(holdingValue))}</span><span title="Complete cost basis unavailable">—</span></a>`;
  }).join('') || `<div class="empty-state">${!address ? 'Connect a wallet to see token holdings.' : portfolioHoldings.status === 'loading' ? 'Checking live Solana balances…' : portfolioHoldings.status === 'unavailable' ? 'Token balances are unavailable from Solana RPC.' : 'No SPL token holdings in this wallet.'}</div>`;
  status.textContent = !address ? 'Connect wallet' : current ? `${holdings.length} tokens · ${portfolioHoldings.coverage}${pricedCount < holdings.length ? ' · some values unavailable' : ''}` : portfolioHoldings.status === 'loading' ? 'Checking Solana balances' : 'Balance lookup unavailable';
  value.textContent = pricedCount ? `${pricedCount < holdings.length ? '≥' : ''}${formatDashboardUsd(total)}` : holdings.length ? '—' : current ? '$0.00' : '—';
  const trades = address ? walletDetailTrades(address) : [];
  const observed = matchedTradePnl(trades, decimalsByMint);
  pnl.textContent = observed.matchedSales ? `${observed.pnlSol >= 0 ? '+' : ''}${formatOnChainNumber(observed.pnlSol, 5)} SOL` : '—';
  pnl.title = observed.matchedSales ? `${observed.matchedSales} sale${observed.matchedSales === 1 ? '' : 's'} matched to buys observed in the last 24 hours. Excludes fees, unmatched trades and open positions.` : 'Cost basis is unavailable for older holdings and unmatched trades.';
  txRows.innerHTML = trades.map(trade => {
    const timestamp = Number(trade.blockTime) * 1000;
    const decimals = decimalsByMint.get(trade.mint);
    const raw = String(trade.tokenAmountRaw ?? '');
    const quantity = Number.isInteger(decimals) && /^\d+$/.test(raw) ? Number(raw) / 10 ** decimals : NaN;
    const tokenAmount = Number.isFinite(quantity) ? formatOnChainNumber(quantity, 6) : '—';
    const receiptUrl = exploreExplorer(`tx/${encodeURIComponent(trade.signature)}`);
    return `<tr class="portfolio-trade-row"><td><time datetime="${escapeHtml(new Date(timestamp).toISOString())}" title="${escapeHtml(new Date(timestamp).toLocaleString())}">${escapeHtml(formatOnchainAge(timestamp))}</time></td><td><span class="portfolio-trade-side ${trade.side}">${trade.side === 'buy' ? 'Buy' : 'Sell'}</span></td><td><a href="/token/${encodeURIComponent(trade.mint)}">${escapeHtml(trade.symbol || shortAddress(trade.mint))}</a></td><td class="numeric">${escapeHtml(tokenAmount)}</td><td class="numeric">${escapeHtml(formatOnChainNumber(trade.solAmount, 5))}</td><td><a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener noreferrer" aria-label="View transaction ${escapeHtml(shortAddress(trade.signature))} on Solana Explorer">${escapeHtml(shortAddress(trade.signature))} ↗</a></td></tr>`;
  }).join('') || `<tr><td class="portfolio-trade-empty" colspan="6"><span>${!address ? 'Connect a wallet to see trade transactions.' : 'No trades found in the available 24-hour coin scan.'}</span></td></tr>`;
  txNote.textContent = !address ? 'Connect a wallet for Solana trade history.' : `Last 24 hours · ${exploreScannedCount} of ${assets.length} listed coins scanned · up to 20 trades per coin, 100 wallet rows. Older or unscanned transactions may be missing.`;
}
