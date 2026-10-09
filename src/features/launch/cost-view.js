import { launchReviewMarkup } from '../../../launch-review.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function updateCostSummary(
  {
    wallet,
    estimatedLaunchFeeLamports,
    walletMetricsLoading,
    walletEstimateError,
    launchCostReview,
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
  if (creatorBuyNode) creatorBuyNode.textContent = creatorBuy.sol > 0
    ? `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL${creatorBuyExceedsWalletBalance() ? ' · insufficient SOL' : creatorBuy.tokens > 0 ? ` · ${Math.round(creatorBuy.tokens).toLocaleString()} tokens` : wallet ? ' · quote pending' : ' · connect wallet to quote'}`
    : 'None';
  if (!launchNode || !totalNode || !noteNode) return;
  if (estimatedLaunchFeeLamports == null) {
    const pending = !wallet ? 'Connect wallet to estimate' : walletMetricsLoading ? 'Calculating…' : 'Estimate unavailable';
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
            ? `Could not estimate the transaction: ${walletEstimateError} Refresh the estimate to try again.`
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
  },
  {
    document = globalThis.document,
  } = {}
) {
  let node=document.querySelector('#launch-cost-details');
  if(!node){node=document.createElement('div');node.id='launch-cost-details';node.className='adoption-panel';document.querySelector('#cost-note')?.after(node);}
  const expanded = node.querySelector('details')?.open;
  node.innerHTML=launchReviewMarkup(launchCostReview);
  if (expanded && node.querySelector('details')) node.querySelector('details').open = true;
}
