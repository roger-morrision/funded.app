import { currentServiceFees, serviceFeeSol } from '../../../service-fees.js';
import { launchReviewMarkup } from '../../../launch-review.js';
import { launchEstimateRefreshMessage } from './estimate-refresh.js';
import { publicLaunchBudget } from '../../../public-launch-budget.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function updateCostSummary(
  {
    wallet,
    estimatedLaunchFeeLamports,
    walletMetricsLoading,
    walletEstimateError,
    launchCostReview,
    launchEstimateRetry,
    publicQuote,
  },
  {
    renderLaunchCostDetails,
    getLaunchBurnPolicy,
    getCreatorBuySummary,
    getCommunityAirdropTokens,
    getCommunityAllocationPercent,
    formatLaunchBurnAmount,
    creatorBuyExceedsWalletBalance,
    developerBuyLimitReached,
    formatLaunchCost,
    document = globalThis.document,
  } = {}
) {
  renderLaunchCostDetails();
  const launchNode = document.querySelector('#cost-launch');
  const totalNode = document.querySelector('#cost-total-enabled');
  const noteNode = document.querySelector('#cost-note');
  const previewLaunchNode = document.querySelector('#preview-launch-cost');
  const previewCostLabel = document.querySelector('#preview-cost-label');
  let initialBuyNode = document.querySelector('#cost-initial-buy');
  if (!initialBuyNode && document.createElement) {
    const networkRow = document.querySelector('#cost-launch')?.parentElement;
    if (networkRow) {
      const row = document.createElement('div');
      const label = document.createElement('span');
      initialBuyNode = document.createElement('b');
      row.className = 'cost-row cost-initial-buy-row';
      label.textContent = 'Initial purchase + 1% allowance';
      initialBuyNode.id = 'cost-initial-buy';
      row.append(label, initialBuyNode);
      networkRow.before(row);
    }
  }
  const totalLabelNode = document.querySelector('#cost-total-label');
  const mobileBudgetLabel = document.querySelector('#launch-mobile-budget-label');
  const mobileBudgetValue = document.querySelector('#launch-mobile-budget-value');
  const mobileBudgetNote = document.querySelector('#launch-mobile-budget-note');
  const syncMobileBudget = (value = totalNode?.textContent) => {
    if (mobileBudgetLabel) mobileBudgetLabel.textContent = totalLabelNode?.textContent || 'Estimated total budget';
    if (mobileBudgetValue) mobileBudgetValue.textContent = value || 'Calculating…';
    if (mobileBudgetNote) mobileBudgetNote.textContent = wallet
      ? estimatedLaunchFeeLamports != null
        ? 'Estimated total includes network fees and account rent. Review again before signing.'
        : 'Checking the wallet-specific network fees and account rent before signing.'
      : publicLaunchBudget(publicQuote)
        ? 'Includes a 0.05 SOL planning allowance for network fees and account rent. The wallet estimate replaces it before signing.'
        : 'A current public Pump quote is needed. No wallet is required to view the planning budget.';
  };
  const burnNode = document.querySelector('#cost-burn');
  const burnRow = document.querySelector('#cost-burn-row');
  const tierLabelNode = document.querySelector('#cost-tier-label');
  const creatorBuyNode = document.querySelector('#cost-creator-buy');
  const communityTokensNode = document.querySelector('#cost-community-tokens');
  const communityDetailNode = document.querySelector('#cost-community-detail');
  const summaryNode = document.querySelector('#cost-summary');
  const burnPolicy = getLaunchBurnPolicy();
  const creatorBuy = getCreatorBuySummary();
  const retrySeconds = launchEstimateRetry?.retryable
    ? Math.max(0, Math.ceil((launchEstimateRetry.nextAt - Date.now()) / 1000)) : null;
  const communityTokens = getCommunityAirdropTokens();
  const communityPercent = getCommunityAllocationPercent();
  if (communityTokensNode) communityTokensNode.textContent = Number.isFinite(communityTokens) ? communityTokens.toLocaleString() : '—';
  if (communityDetailNode) communityDetailNode.innerHTML = Number.isFinite(communityPercent)
    ? `<b>${communityPercent.toFixed(2)}% of supply</b> · bought and locked in the reward vault when launch finalizes`
    : '<b>Enter a valid airdrop amount</b>';
  if (burnNode) burnNode.textContent = burnPolicy.requiresBurn
    ? burnPolicy.amountTokens > 0 ? `${formatLaunchBurnAmount(burnPolicy.amountTokens)} $FUNDED${burnPolicy.usdTarget ? ` (≈$${burnPolicy.usdTarget})` : ''}` : 'Quote unavailable'
    : '0 $FUNDED';
  if (burnRow) burnRow.hidden = !burnPolicy.requiresBurn;
  if (tierLabelNode) tierLabelNode.textContent = `Launch service fee: ${serviceFeeSol(currentServiceFees().launchLamports)} SOL${burnPolicy.requiresBurn ? ` · ${burnPolicy.label}` : ''}`;
  if (summaryNode) summaryNode.classList.toggle('free-launch', !burnPolicy.requiresBurn);
  if (creatorBuyNode && creatorBuy.sol > 0) {
    const buyStatus = creatorBuyExceedsWalletBalance() ? 'insufficient SOL'
      : developerBuyLimitReached() ? 'over 20% limit'
        : walletEstimateError ? retrySeconds == null ? 'estimate unavailable' : `retrying in ${retrySeconds}s`
          : walletMetricsLoading ? 'calculating…'
            : creatorBuy.tokens > 0 ? `${Math.round(creatorBuy.tokens).toLocaleString()} tokens`
              : wallet ? 'calculating…' : publicQuote?.status === 'ready' && publicQuote.developerTokens > 0
                ? `${Math.round(publicQuote.developerTokens).toLocaleString()} tokens`
                : publicQuote?.status === 'invalid' ? 'invalid amount'
                  : publicQuote?.status === 'unavailable' ? 'quote unavailable' : 'calculating…';
    creatorBuyNode.textContent = `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL · ${buyStatus}`;
  } else if (creatorBuyNode) creatorBuyNode.textContent = 'None';
  if (!launchNode || !totalNode || !noteNode) return;
  if (previewCostLabel) previewCostLabel.textContent = !wallet ? 'Estimated total budget' : 'Estimated total';
  if (totalLabelNode) totalLabelNode.textContent = !wallet ? 'Estimated total budget' : 'Estimated total';
  if (estimatedLaunchFeeLamports == null) {
    if (!wallet) {
      const budget = publicLaunchBudget(publicQuote);
      if (budget) {
        if (initialBuyNode) initialBuyNode.textContent = formatLaunchCost(budget.purchase + budget.allowance);
        launchNode.textContent = `${formatLaunchCost(budget.overhead)} planning allowance`;
        totalNode.textContent = formatLaunchCost(budget.total);
        if (previewLaunchNode) previewLaunchNode.textContent = formatLaunchCost(budget.total);
        noteNode.textContent = 'Estimated total includes the live Pump quote for the holder reserve and optional developer buy, its 1% purchase allowance, and a 0.05 SOL planning allowance for network fees and account rent. The actual wallet-specific amount is simulated before signing. Any $FUNDED tier burn is separate.';
      } else {
        const pending = publicQuote?.status === 'unavailable' ? 'Quote unavailable'
          : publicQuote?.status === 'invalid' ? 'Enter valid amounts' : 'Calculating…';
        if (initialBuyNode) initialBuyNode.textContent = pending;
        launchNode.textContent = pending;
        totalNode.textContent = pending;
        if (previewLaunchNode) previewLaunchNode.textContent = pending;
        noteNode.textContent = 'The full planning budget needs a current public Pump quote. No wallet is required to view it; retry when the quote service is available.';
      }
      syncMobileBudget(totalNode.textContent);
      return;
    }
    const pending = walletMetricsLoading ? 'Calculating…'
      : retrySeconds == null ? 'Estimate unavailable' : `Retrying in ${retrySeconds}s`;
    launchNode.textContent = pending;
    if (initialBuyNode) initialBuyNode.textContent = pending;
    totalNode.textContent = '—';
    if (previewLaunchNode) previewLaunchNode.textContent = pending;
    noteNode.textContent = walletMetricsLoading
        ? 'Building and estimating the Solana transaction…'
        : developerBuyLimitReached()
          ? 'Developer buy exceeds 20% of the token supply. Return to Launch settings and lower the SOL amount or set it to 0. A new estimate will run after you change it.'
          : walletEstimateError
            ? `Could not estimate the transaction: ${walletEstimateError} ${launchEstimateRetry?.retryable ? launchEstimateRefreshMessage({ wallet, retry: launchEstimateRetry }) : 'Correct the issue, then retry the estimate.'}`
            : 'The launch cost is not verified. Refresh the estimate before signing.';
    syncMobileBudget(pending);
    return;
  }
  const launchCost = formatLaunchCost(estimatedLaunchFeeLamports);
  const networkReserve = launchCostReview
    ? formatLaunchCost(Number(BigInt(launchCostReview.networkFee) + BigInt(launchCostReview.otherLaunchCosts)))
    : launchCost;
  launchNode.textContent = networkReserve;
  if (initialBuyNode) initialBuyNode.textContent = launchCostReview
    ? formatLaunchCost(launchCostReview.buyMaximum) : 'Included in total';
  totalNode.textContent = launchCost;
  if (previewLaunchNode) previewLaunchNode.textContent = launchCost;
  noteNode.textContent = burnPolicy.requiresBurn
    ? 'SOL total includes network fees, account reserve, and any developer buy. The $FUNDED burn is separate.'
    : 'The free tier has no $FUNDED burn. Total includes network fees, account reserve, and any creator buy with its 1% allowance.';
  syncMobileBudget();
}

export function renderLaunchCostDetails(
  {
    launchCostReview,
    wallet,
    walletMetricsLoading,
    launchEstimateRetry,
    publicQuote,
  },
  {
    formatLaunchCost,
    document = globalThis.document,
  } = {}
) {
  let node=document.querySelector('#launch-cost-details');
  if(!node){node=document.createElement('div');node.id='launch-cost-details';node.className='adoption-panel';document.querySelector('#cost-note')?.after(node);}
  const publicBudget = !wallet ? publicLaunchBudget(publicQuote) : null;
  node.hidden = !wallet && !publicBudget;
  const expanded = node.querySelector('details')?.open;
  const refreshMessage = launchEstimateRefreshMessage({ wallet, loading: walletMetricsLoading, retry: launchEstimateRetry });
  if (publicBudget) node.innerHTML = `<section class="launch-review-costs" aria-labelledby="public-launch-cost-heading"><h3 id="public-launch-cost-heading">Cost breakdown before connecting</h3><dl><div><dt>Holder reserve + optional developer buy</dt><dd>${formatLaunchCost(publicBudget.purchase)}</dd></div><div><dt>Purchase allowance (1%)</dt><dd>${formatLaunchCost(publicBudget.allowance)}</dd></div><div><dt>Network fees + account rent planning allowance</dt><dd>${formatLaunchCost(publicBudget.overhead)}</dd></div><div><dt>Estimated total SOL budget</dt><dd>${formatLaunchCost(publicBudget.total)}</dd></div></dl><p>The wallet-specific simulation replaces the planning allowance before signing. Any $FUNDED tier burn is shown separately above.</p></section>`;
  else if (!wallet) node.textContent = '';
  else if (!launchCostReview && refreshMessage) node.textContent = refreshMessage;
  else node.innerHTML=launchReviewMarkup(launchCostReview);
  if (expanded && node.querySelector('details')) node.querySelector('details').open = true;
}
