import { summarizeBuybackLedger } from '../../../buyback-policy.js';
import { formatTokenBaseUnits } from '../../../funded-burn.js';
import { escapeHtml } from '../shared/display.js';
import { canSignTransactions } from '../../../wallet-core.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderBuybackDashboard(
  message,
  {
    connectedWalletAddress,
    fundedBurnState,
    verifiedLaunchPolicies,
    buybackNetworkState,
    verifiedLaunchPoliciesStatus,
    wallet,
    LAUNCH_BURN_TIERS,
    SELECTABLE_LAUNCH_TIERS,
  },
  {
    getBuybackPreviewState,
    formatBuybackAmount,
    fundedReceiptProject,
    renderBuybackExample,
    updateFundedBurnButton,
    exploreExplorer,
    document = globalThis.document,
  } = {}
) {
  const state = getBuybackPreviewState();
  const summary = summarizeBuybackLedger(state.accruals, state.receipts);
  const pendingSol = summary.pendingByAsset.SOL || 0;
  const walletBalanceReady = Boolean(connectedWalletAddress && fundedBurnState.wallet === connectedWalletAddress && fundedBurnState.status === 'ready');
  const launchBurns = verifiedLaunchPolicies.filter(launch => launch?.creatorLaunchBurn?.status === 'verified'
    && launch.creatorLaunchBurn.receipt && Number(launch.creatorLaunchBurn.receipt.amountTokens ?? launch.creatorLaunchBurn.amountTokens) > 0);
  const walletLaunchBurns = launchBurns.filter(launch => launch.creatorWallet === connectedWalletAddress);
  const standaloneReceipts = fundedBurnState.wallet === connectedWalletAddress ? fundedBurnState.receipts : [];
  const receiptSignatures = new Set([...walletLaunchBurns.map(launch => launch.creatorLaunchBurn.receipt.signature), ...standaloneReceipts.map(receipt => receipt.signature)].filter(Boolean));
  document.querySelector('#buyback-pending').textContent = walletBalanceReady ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6) : '—';
  document.querySelector('#buyback-burned').textContent = fundedBurnState.status === 'ready' ? formatTokenBaseUnits(fundedBurnState.burnedBaseUnits, fundedBurnState.decimals, 6) : '—';
  document.querySelector('#buyback-claims').textContent = connectedWalletAddress && fundedBurnState.status === 'ready' ? String(receiptSignatures.size) : '—';
  const feeReceipts = buybackNetworkState.receipts;
  const totalReceiptCount = feeReceipts.length + launchBurns.length + standaloneReceipts.filter(receipt => !launchBurns.some(launch => launch.creatorLaunchBurn.receipt.signature === receipt.signature)).length;
  document.querySelector('#buyback-execution-count').textContent = totalReceiptCount
    ? `${totalReceiptCount} verified receipt${totalReceiptCount === 1 ? '' : 's'}`
    : buybackNetworkState.status === 'unavailable' && verifiedLaunchPoliciesStatus !== 'ready' && !fundedBurnState.receiptIndexAvailable
      ? 'Receipt index unavailable'
      : '0 verified receipts';
  const burnedNote = document.querySelector('#buyback-burned')?.parentElement?.querySelector('em');
  const claimsNote = document.querySelector('#buyback-claims')?.parentElement?.querySelector('em');
  const balanceNote = document.querySelector('#buyback-pending')?.parentElement?.querySelector('em');
  if (balanceNote) balanceNote.textContent = walletBalanceReady ? 'Current wallet balance' : connectedWalletAddress && fundedBurnState.status === 'loading' ? 'Loading from Solana' : connectedWalletAddress ? 'Balance unavailable' : 'Connect wallet to check balance';
  if (burnedNote) burnedNote.textContent = fundedBurnState.status === 'ready' ? 'Confirmed supply reduction' : 'Supply unavailable';
  if (claimsNote) claimsNote.textContent = fundedBurnState.receiptIndexAvailable ? 'Confirmed burn transactions' : 'Burn history unavailable';
  const executedIds = new Set(state.receipts.flatMap(receipt => receipt.accrualIds || []));
  const events = [
    ...state.accruals.map(accrual => ({ type: 'accrual', at: accrual.claimedAt, data: accrual })),
    ...state.receipts.map(receipt => ({ type: 'receipt', at: receipt.executedAt, data: receipt })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const previewRows = events.map(event => {
    if (event.type === 'receipt') {
      const receipt = event.data;
      return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.tokensBurned, 2)} $FUNDED burned</strong><small>${formatBuybackAmount(receipt.inputAmount)} ${escapeHtml(receipt.asset)} · ${escapeHtml(receipt.burnInstruction)} · local preview</small></span><b>Supply ↓</b></div>`;
    }
    const accrual = event.data;
    const executed = executedIds.has(accrual.id);
    return `<div class="buyback-ledger-row"><span class="buyback-ledger-icon">↗</span><span><strong>${formatBuybackAmount(accrual.buybackAmount)} ${escapeHtml(accrual.asset)} allocated</strong><small>${formatBuybackAmount(accrual.grossCreatorFees)} ${escapeHtml(accrual.asset)} gross fees · claim ${escapeHtml(accrual.claimSignature.slice(-8))}</small></span><b>${executed ? 'Burned' : 'Pending'}</b></div>`;
  }).join('');
  const launchRows = launchBurns.map(launch => {
    const burn = launch.creatorLaunchBurn; const receipt = burn.receipt;
    const signature = String(receipt.signature || '');
    return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.amountTokens ?? burn.amountTokens, 2)} $FUNDED burned</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} launch promotion · ${escapeHtml(burn.label || burn.tier || 'verified tier')}</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed transaction ↗</a></span><b>Supply ↓</b></div>`;
  }).join('');
  const standaloneRows = standaloneReceipts.filter(receipt => !launchBurns.some(launch => launch.creatorLaunchBurn.receipt.signature === receipt.signature)).map(receipt => `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.amountTokens, 6)} $FUNDED burned</strong><small>${escapeHtml(fundedReceiptProject(receipt))} · confirmed</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed transaction ↗</a></span><b>Supply ↓</b></div>`).join('');
  const feeRows = feeReceipts.map(receipt => {
    const baseUnits = BigInt(receipt.boughtAndBurnedBaseUnits || '0');
    const amount = formatTokenBaseUnits(baseUnits, Number(receipt.tokenDecimals ?? 6), 6);
    const spentSol = (BigInt(receipt.settledLamports || '0') - BigInt(receipt.returnedLamports || '0'));
    return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${escapeHtml(amount)} $FUNDED bought and burned</strong><small>${escapeHtml(formatTokenBaseUnits(spentSol, 9, 9))} SOL from collected creator fees · unused SOL returned</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed buy and burn ↗</a></span><b>Supply ↓</b></div>`;
  }).join('');
  document.querySelector('#buyback-ledger').innerHTML = `${feeRows}${standaloneRows}${launchRows}${previewRows}` || (buybackNetworkState.status === 'unavailable' ? '<div class="empty-state">Burn history is temporarily unavailable. Try again shortly.</div>' : '<div class="empty-state">No confirmed $FUNDED burns yet. Fee-funded buybacks and launch promotions appear here separately.</div>');
  const runButton = document.querySelector('#buyback-run-preview');
  const addButton = document.querySelector('#buyback-add-claim');
  if (addButton) { addButton.disabled = true; addButton.title = 'Recording requires verified fee-claim receipts and a deployed buyback vault.'; }
  if (runButton) { runButton.disabled = true; runButton.title = 'Buybacks execute automatically from verified fee accruals. Manual execution is unavailable.'; }
  renderBuybackExample();
  const burnCard = document.querySelector('.burn-token-card');
  const burnBadge = burnCard?.querySelector('.burn-status');
  const burnStatus = document.querySelector('#funded-burn-status');
  const signingReady = fundedBurnState.status === 'ready' && Boolean(wallet && canSignTransactions(wallet)) && fundedBurnState.balanceBaseUnits > 0n;
  if (burnBadge) { burnBadge.textContent = fundedBurnState.status === 'loading' ? 'Loading' : signingReady ? 'Ready' : fundedBurnState.status === 'ready' ? 'View only' : 'Unavailable'; burnBadge.className = `burn-status ${signingReady ? 'available' : fundedBurnState.status === 'loading' ? 'loading' : 'unavailable'}`; }
  if (burnStatus) burnStatus.textContent = fundedBurnState.message;
  const tierCard = document.querySelector('.burn-tier-card');
  if (tierCard) {
    const paidTiers = LAUNCH_BURN_TIERS.filter(tier => SELECTABLE_LAUNCH_TIERS.has(tier.id) && tier.amountTokens > 0);
    const maximum = paidTiers.at(-1)?.amountTokens || 1;
    paidTiers.forEach(tier => {
      const row = tierCard.querySelector(`[data-burn-tier="${tier.id}"]`);
      if (!row) return;
      row.querySelector('b').textContent = `${tier.amountTokens.toLocaleString('en-US')} $FUNDED`;
      row.querySelector('em').style.width = `${Math.max(8, tier.amountTokens / maximum * 100)}%`;
    });
  }
  updateFundedBurnButton();
  const status = document.querySelector('#buyback-preview-status');
  if (message) status.textContent = message;
  else if (pendingSol >= 0.25) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is ready for a protected batch preview.`;
  else if (pendingSol > 0) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is safely accumulating toward the 0.25 SOL threshold.`;
  else status.textContent = feeReceipts.length > 0
    ? `${feeReceipts.length} verified fee-funded Solana buyback${feeReceipts.length === 1 ? '' : 's'} completed. New batches run automatically from collected fees; this example cannot create a claim.`
    : 'Local calculation only. Live Solana buybacks run automatically from verified fee collections; this example cannot create a claim.';
}
