import {burnHistoryTable} from './burn-history-table.js';
import { summarizeBuybackLedger } from '../../../buyback-policy.js';
import { formatTokenBaseUnits } from '../../../funded-burn.js';
import { escapeHtml, formatTokenDisplay } from '../shared/display.js';
import { canSignTransactions } from '../../../wallet-core.js';
import { newestBuybackReceipts } from './buyback-receipts.js';
import { preserveBuybackLedgerFocus } from './buyback-ledger-focus.js';

// Compact for reading (1.89M); the exact value stays in the tooltip.
function setTokenAmount(node, exact) {
  if (!node) return;
  node.textContent = exact == null ? '—' : formatTokenDisplay(exact);
  if (exact == null) node.removeAttribute('title'); else node.title = `${exact} $RICH`;
}

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
  setTokenAmount(document.querySelector('#buyback-pending'), walletBalanceReady ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6) : null);
  setTokenAmount(document.querySelector('#buyback-burned'), fundedBurnState.status === 'ready' ? formatTokenBaseUnits(fundedBurnState.burnedBaseUnits, fundedBurnState.decimals, 6) : null);
  document.querySelector('#buyback-claims').textContent = connectedWalletAddress && fundedBurnState.status === 'ready' ? String(receiptSignatures.size) : '—';
  const feeReceipts = newestBuybackReceipts(buybackNetworkState.receipts);
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
      return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.tokensBurned, 2)} $RICH burned</strong><small>${formatBuybackAmount(receipt.inputAmount)} ${escapeHtml(receipt.asset)} · ${escapeHtml(receipt.burnInstruction)} · local preview</small></span><b>Supply ↓</b></div>`;
    }
    const accrual = event.data;
    const executed = executedIds.has(accrual.id);
    return `<div class="buyback-ledger-row"><span class="buyback-ledger-icon">↗</span><span><strong>${formatBuybackAmount(accrual.buybackAmount)} ${escapeHtml(accrual.asset)} allocated</strong><small>${formatBuybackAmount(accrual.grossCreatorFees)} ${escapeHtml(accrual.asset)} gross fees · claim ${escapeHtml(accrual.claimSignature.slice(-8))}</small></span><b>${executed ? 'Burned' : 'Pending'}</b></div>`;
  }).join('');
  const historyTable=burnHistoryTable({feeReceipts,launchBurns,standaloneReceipts,exploreExplorer,fundedReceiptProject});
  const ledger = document.querySelector('#buyback-ledger');
  const restoreFocus = preserveBuybackLedgerFocus(ledger, document);
  const more = ledger.querySelector(':scope > .concise-ledger-more');
  if (more) ledger.dataset.buybackExpanded = String(more.open);
  ledger.innerHTML = `${historyTable}${previewRows?'<h3>Local preview</h3>'+previewRows:''}` || (buybackNetworkState.status === 'unavailable' ? '<div class="empty-state">Burn history is temporarily unavailable. Try again shortly.</div>' : '<div class="empty-state">No confirmed $RICH burns yet. Fee-funded buybacks and launch promotions appear here separately.</div>');
  restoreFocus();
  const runButton = document.querySelector('#buyback-run-preview');
  const addButton = document.querySelector('#buyback-add-claim');
  if (addButton) { addButton.disabled = true; addButton.title = 'Recording requires verified fee-claim receipts and a deployed buyback vault.'; }
  if (runButton) { runButton.disabled = true; runButton.title = 'Local simulation is disabled; V3 fee-funded buybacks execute automatically after the verified trigger.'; }
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
      row.querySelector('b').textContent = `${tier.amountTokens.toLocaleString('en-US')} $RICH`;
      row.querySelector('em').style.width = `${Math.max(8, tier.amountTokens / maximum * 100)}%`;
    });
  }
  updateFundedBurnButton();
  // The example-calculator panel was removed; its status line is optional.
  const status = document.querySelector('#buyback-preview-status');
  if (!status) return;
  if (message) status.textContent = message;
  else if (pendingSol > 0) status.textContent = `${formatBuybackAmount(pendingSol)} SOL appears in the local preview. Only verified on-chain vault fees count toward automatic execution.`;
  else status.textContent = buybackNetworkState.automationEnabled
    ? 'Automatic V3 buybacks require the verified vault trigger and a protected market quote.'
    : 'Local calculation only. Automatic V3 buyback execution is not active.';
}
