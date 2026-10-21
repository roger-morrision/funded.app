import { serviceFeeSol } from '../../../service-fees.js';
import { currentVerifiedLaunchFeeLamports } from '../fees/service-fees-client.js';
import { launchReviewMarkup } from '../../../launch-review.js';
import { launchEstimateRefreshMessage } from './estimate-refresh.js';
import { publicLaunchBudget } from '../../../public-launch-budget.js';

function publicPlanningStatus(quote, fee) {
  return quote?.status === 'unavailable' ? 'Quote unavailable'
    : quote?.status === 'invalid' ? 'Enter valid amounts'
      : quote?.status === 'ready' && fee == null ? 'Fee policy unavailable' : 'Calculating…';
}

function syncPlanningPresentation(wallet, document) {
  document.querySelector('#cost-summary')?.classList.toggle('public-launch-planning', !wallet);
  const synopsis = document.querySelector('#preview-launch-cost')?.parentElement;
  if (synopsis) synopsis.hidden = !wallet;
  const tier = document.querySelector('#cost-public-tier-note');
  if (tier) tier.hidden = Boolean(wallet);
}

// Display only: the controller still owns debounce, cache and request admission.
export function bindPublicQuoteRetry(appState, document = globalThis.document) {
  document.querySelector('#launch-public-quote-retry-button')?.addEventListener('click', event => {
    if (event.currentTarget.getAttribute('aria-disabled') === 'true' || appState.wallet
      || appState.requestedPageRoute() !== 'launch' || !appState.getLaunchStepState(2).valid) return;
    appState.updateCostSummary();
  });
}

export function renderPublicQuoteRetry({wallet, publicQuote, active}, {document = globalThis.document, now = Date.now()} = {}) {
  const group = document?.querySelector('#launch-public-quote-retry');
  const button = document?.querySelector('#launch-public-quote-retry-button');
  const status = document?.querySelector('#launch-public-quote-retry-status');
  if (!group || !button || !status) return;
  if (publicQuote?.status === 'unavailable') button.dataset.quoteRetryShown = 'true';
  const loading = publicQuote?.status === 'loading';
  const visible = active && !wallet && (publicQuote?.status === 'unavailable' || loading && button.dataset.quoteRetryShown === 'true');
  const wasFocused = document.activeElement === button;
  group.hidden = !visible;
  if (!visible) {
    delete button.dataset.quoteRetryShown;
    if (wasFocused && active && !wallet && publicQuote?.status === 'ready') {
      const heading = document.querySelector('#public-launch-cost-heading');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    }
    return;
  }
  const seconds = Math.max(0, Math.ceil((publicQuote.updatedAt + 15_000 - now) / 1000));
  button.setAttribute('aria-disabled', String(loading || seconds > 0));
  status.textContent = loading ? 'Requesting a planning quote…'
    : seconds > 0 ? `Quote unavailable. Retry available in ${seconds}s. This retries the quote only.`
      : 'Quote unavailable. Retry the planning quote when ready. Fee policy is checked separately.';
}

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
    getLaunchFeeLamports = currentVerifiedLaunchFeeLamports,
    document = globalThis.document,
  } = {}
) {
  const launchFeeLamports = getLaunchFeeLamports();
  const displayedLaunchFeeLamports = wallet && launchCostReview?.serviceFeeLamports != null
    ? launchCostReview.serviceFeeLamports : launchFeeLamports;
  const publicBudget = !wallet ? publicLaunchBudget(publicQuote, launchFeeLamports) : null;
  syncPlanningPresentation(wallet, document);
  renderLaunchCostDetails(launchFeeLamports);
  const launchNode = document.querySelector('#cost-launch');
  const serviceFeeNode = document.querySelector('#cost-service-fee');
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
        ? 'Estimated total includes the approved app launch service fee, network fees and account rent. Review again before signing.'
        : 'Checking the wallet-specific network fees and account rent before signing.'
      : publicBudget
        ? 'Planning estimate. Review the itemized costs below; wallet-specific simulation is required before signing.'
        : 'A current public Pump quote and app fee policy are needed. No wallet is required to view the planning budget.';
  };
  const burnNode = document.querySelector('#cost-burn');
  const burnRow = document.querySelector('#cost-burn-row');
  const tierLabelNode = document.querySelector('#cost-tier-label');
  const creatorBuyNode = document.querySelector('#cost-creator-buy');
  const communityTokensNode = document.querySelector('#cost-community-tokens');
  const communityDetailNode = document.querySelector('#cost-community-detail');
  const summaryNode = document.querySelector('#cost-summary');
  const burnPolicy = getLaunchBurnPolicy();
  const publicTier = document.querySelector('#cost-public-tier-note');
  if (publicTier) publicTier.textContent = burnPolicy.requiresBurn
    ? `Selected tier: ${burnPolicy.label}. The $FUNDED burn is separate from the SOL budget.`
    : 'Standard has no $FUNDED burn.';
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
  if (tierLabelNode) tierLabelNode.textContent = displayedLaunchFeeLamports == null
    ? 'Checking current launch service fee…'
    : `Launch service fee: ${serviceFeeSol(displayedLaunchFeeLamports)} SOL${burnPolicy.requiresBurn ? ` · ${burnPolicy.label}` : ''}`;
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
      if (publicBudget) {
        if (initialBuyNode) initialBuyNode.textContent = formatLaunchCost(publicBudget.purchase + publicBudget.allowance);
        launchNode.textContent = `${formatLaunchCost(publicBudget.overhead)} planning allowance`;
        if (serviceFeeNode) serviceFeeNode.textContent = formatLaunchCost(publicBudget.serviceFee);
        totalNode.textContent = formatLaunchCost(publicBudget.total);
        if (previewLaunchNode) previewLaunchNode.textContent = formatLaunchCost(publicBudget.total);
        noteNode.textContent = 'Estimated total includes the live Pump quote for the holder reserve and optional developer buy, its 1% purchase allowance, the current app launch service fee, and a 0.05 SOL planning allowance for network fees and account rent. The wallet-specific simulation replaces the planning allowance before signing. Any $FUNDED tier burn is separate.';
      } else {
        const pending = publicPlanningStatus(publicQuote, launchFeeLamports);
        if (initialBuyNode) initialBuyNode.textContent = pending;
        launchNode.textContent = pending;
        if (serviceFeeNode) serviceFeeNode.textContent = launchFeeLamports == null ? 'Unavailable' : formatLaunchCost(BigInt(launchFeeLamports));
        totalNode.textContent = pending;
        if (previewLaunchNode) previewLaunchNode.textContent = pending;
        noteNode.textContent = 'The full planning budget needs a current public Pump quote and app fee policy. No wallet is required to view it; retry when either service is available.';
      }
      syncMobileBudget(totalNode.textContent);
      return;
    }
    const pending = walletMetricsLoading ? 'Calculating…'
      : retrySeconds == null ? 'Estimate unavailable' : `Retrying in ${retrySeconds}s`;
    launchNode.textContent = pending;
    if (serviceFeeNode) serviceFeeNode.textContent = pending;
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
  if (serviceFeeNode) serviceFeeNode.textContent = launchCostReview
    ? formatLaunchCost(launchCostReview.serviceFeeLamports) : 'Included in total';
  if (initialBuyNode) initialBuyNode.textContent = launchCostReview
    ? formatLaunchCost(launchCostReview.buyMaximum) : 'Included in total';
  totalNode.textContent = launchCost;
  if (previewLaunchNode) previewLaunchNode.textContent = launchCost;
  noteNode.textContent = burnPolicy.requiresBurn
    ? 'SOL total includes the approved app launch service fee, network fees, account reserve, and any developer buy. The $FUNDED burn is separate.'
    : 'Standard has no $FUNDED burn. Total includes the approved app launch service fee, network fees, account reserve, and any creator buy with its 1% allowance.';
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
    getLaunchFeeLamports = currentVerifiedLaunchFeeLamports,
    document = globalThis.document,
  } = {}
) {
  let node=document.querySelector('#launch-cost-details');
  if(!node){node=document.createElement('div');node.id='launch-cost-details';node.className='adoption-panel';document.querySelector('#cost-note')?.after(node);}
  const fee = wallet ? null : getLaunchFeeLamports();
  const publicBudget = !wallet ? publicLaunchBudget(publicQuote, fee) : null;
  syncPlanningPresentation(wallet, document);
  node.hidden = false;
  const expanded = node.querySelector('details')?.open;
  const refreshMessage = launchEstimateRefreshMessage({ wallet, loading: walletMetricsLoading, retry: launchEstimateRetry });
  if (publicBudget) node.innerHTML = `<section class="launch-review-costs" aria-labelledby="public-launch-cost-heading"><h3 id="public-launch-cost-heading">Review launch costs</h3><dl><div><dt>Holder reserve + optional developer buy</dt><dd>${formatLaunchCost(publicBudget.purchase)}</dd></div><div><dt>Purchase allowance (1%)</dt><dd>${formatLaunchCost(publicBudget.allowance)}</dd></div><div><dt>App launch service fee</dt><dd>${formatLaunchCost(publicBudget.serviceFee)}</dd></div><div><dt>Network fees + account rent planning allowance</dt><dd>${formatLaunchCost(publicBudget.overhead)}</dd></div><div><dt>Estimated total SOL budget</dt><dd>${formatLaunchCost(publicBudget.total)}</dd></div></dl><p>Planning estimate only. Wallet-specific simulation replaces the network and account allowance before signing.</p></section>`;
  else if (!wallet) node.innerHTML = `<section class="launch-review-costs" aria-labelledby="public-launch-cost-heading"><h3 id="public-launch-cost-heading">Review launch costs</h3><p class="launch-public-budget-status">${publicPlanningStatus(publicQuote, fee)}</p><p>A complete planning budget needs a current public Pump quote and app fee policy. No wallet is required to view it; retry when either service is available.</p></section>`;
  else if (!launchCostReview && refreshMessage) node.textContent = refreshMessage;
  else node.innerHTML=launchReviewMarkup(launchCostReview);
  if (expanded && node.querySelector('details')) node.querySelector('details').open = true;
}
