import { launchReviewMarkup } from '../../../launch-review.js';
import { launchEstimateRefreshMessage } from './estimate-refresh.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function updateCostSummary(
  {
    wallet,
    estimatedLaunchFeeLamports,
    walletMetricsLoading,
    walletEstimateError,
    launchCostReview,
    launchEstimateRetry,
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
    ? burnPolicy.amountTokens > 0 ? `${formatLaunchBurnAmount(burnPolicy.amountTokens)} $FUNDED` : 'Quote unavailable'
    : '0 $FUNDED';
  if (burnRow) burnRow.hidden = !burnPolicy.requiresBurn;
  if (tierLabelNode) tierLabelNode.textContent = burnPolicy.requiresBurn ? burnPolicy.label.toUpperCase() : 'Platform launch fee: 0';
  if (summaryNode) summaryNode.classList.toggle('free-launch', !burnPolicy.requiresBurn);
  if (creatorBuyNode && creatorBuy.sol > 0) {
    const buyStatus = creatorBuyExceedsWalletBalance() ? 'insufficient SOL'
      : developerBuyLimitReached() ? 'over 20% limit'
        : walletEstimateError ? retrySeconds == null ? 'estimate unavailable' : `retrying in ${retrySeconds}s`
          : walletMetricsLoading ? 'calculating…'
            : creatorBuy.tokens > 0 ? `${Math.round(creatorBuy.tokens).toLocaleString()} tokens`
              : wallet ? 'calculating…' : 'connect wallet to quote';
    creatorBuyNode.textContent = `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL · ${buyStatus}`;
  } else if (creatorBuyNode) creatorBuyNode.textContent = 'None';
  if (!launchNode || !totalNode || !noteNode) return;
  if (estimatedLaunchFeeLamports == null) {
    const pending = !wallet ? 'Connect wallet to estimate' : walletMetricsLoading ? 'Calculating…'
      : retrySeconds == null ? 'Estimate unavailable' : `Retrying in ${retrySeconds}s`;
    launchNode.textContent = pending;
    totalNode.textContent = '—';
    if (previewLaunchNode) previewLaunchNode.textContent = !wallet ? 'Connect wallet' : pending;
    noteNode.textContent = !wallet
      ? 'Connect a wallet to build and estimate the transaction.'
      : walletMetricsLoading
        ? 'Building and estimating the Solana transaction…'
        : developerBuyLimitReached()
          ? 'Developer buy exceeds 20% of the token supply. Return to Launch settings and lower the SOL amount or set it to 0. A new estimate will run after you change it.'
          : walletEstimateError
            ? `Could not estimate the transaction: ${walletEstimateError} ${launchEstimateRetry?.retryable ? launchEstimateRefreshMessage({ wallet, retry: launchEstimateRetry }) : 'Correct the issue, then retry the estimate.'}`
            : 'The launch cost is not verified. Refresh the estimate before signing.';
    return;
  }
  const launchCost = formatLaunchCost(estimatedLaunchFeeLamports);
  const networkReserve = launchCostReview
    ? formatLaunchCost(Number(BigInt(launchCostReview.networkFee) + BigInt(launchCostReview.otherLaunchCosts)))
    : launchCost;
  launchNode.textContent = networkReserve;
  totalNode.textContent = launchCost;
  if (previewLaunchNode) previewLaunchNode.textContent = launchCost;
  noteNode.textContent = burnPolicy.requiresBurn
    ? 'SOL total includes network fees, account reserve, and any developer buy. The $FUNDED burn is separate.'
    : 'The free tier has no $FUNDED burn. Total includes network fees, account reserve, and any creator buy with its 1% allowance.';
}

export function renderLaunchCostDetails(
  {
    launchCostReview,
    wallet,
    walletMetricsLoading,
    launchEstimateRetry,
  },
  {
    document = globalThis.document,
  } = {}
) {
  let node=document.querySelector('#launch-cost-details');
  if(!node){node=document.createElement('div');node.id='launch-cost-details';node.className='adoption-panel';document.querySelector('#cost-note')?.after(node);}
  const expanded = node.querySelector('details')?.open;
  const refreshMessage = launchEstimateRefreshMessage({ wallet, loading: walletMetricsLoading, retry: launchEstimateRetry });
  if (!launchCostReview && refreshMessage) node.textContent = refreshMessage;
  else node.innerHTML=launchReviewMarkup(launchCostReview);
  if (expanded && node.querySelector('details')) node.querySelector('details').open = true;
}
