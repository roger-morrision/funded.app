import { serviceFeeSol } from '../../../service-fees.js';
import { currentVerifiedLaunchFeeLamports } from '../fees/service-fees-client.js';
import { freshLaunchReview } from '../../../launch-review.js';
import { quoteCountdownMarkup } from '../../../quote-countdown.js';
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
  if (synopsis) synopsis.hidden = false;
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
      const total = document.querySelector('#preview-launch-cost');
      total?.setAttribute('tabindex', '-1');
      total?.setAttribute('aria-describedby', 'preview-cost-label');
      total?.focus();
      total?.scrollIntoView?.({block: 'center', behavior: 'instant'});
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
  const tokenUnit = document.querySelector('#token-symbol')?.value?.trim().toUpperCase() || 'tokens';
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
        ? 'Includes the launch fee, network fees and account rent. Review before signing.'
        : 'Checking wallet costs before signing.'
      : publicBudget
        ? 'Planning estimate. Your wallet costs are checked before signing.'
        : 'Waiting for a current quote and fee policy. No wallet needed.';
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
    ? `Selected tier: ${burnPolicy.label}. Total $RICH tokens to burn: ${burnPolicy.amountTokens > 0 ? formatLaunchBurnAmount(burnPolicy.amountTokens) : 'Quote unavailable'}.`
    : 'Standard needs no $RICH tier burn (the 5% fee buyback still applies).';
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
    ? burnPolicy.amountTokens > 0 ? `${formatLaunchBurnAmount(burnPolicy.amountTokens)} $RICH${burnPolicy.usdTarget ? ` (≈$${burnPolicy.usdTarget})` : ''}` : 'Quote unavailable'
    : '0 $RICH';
  if (burnRow) burnRow.hidden = !burnPolicy.requiresBurn;
  if (tierLabelNode) tierLabelNode.textContent = displayedLaunchFeeLamports == null
    ? 'Checking current launch service fee…'
    : `Launch service fee: ${serviceFeeSol(displayedLaunchFeeLamports)} SOL${burnPolicy.requiresBurn ? ` · ${burnPolicy.label}` : ''}`;
  if (summaryNode) summaryNode.classList.toggle('free-launch', !burnPolicy.requiresBurn);
  if (creatorBuyNode && creatorBuy.sol > 0) {
    const buyStatus = creatorBuyExceedsWalletBalance() ? 'insufficient SOL'
      : developerBuyLimitReached() ? 'exceeds buy limit'
        : walletEstimateError ? retrySeconds == null ? 'estimate unavailable' : `retrying in ${retrySeconds}s`
          : walletMetricsLoading ? 'calculating…'
            : creatorBuy.tokens > 0 ? `${Math.round(creatorBuy.tokens).toLocaleString()} ${tokenUnit}`
              : wallet ? 'calculating…' : publicQuote?.status === 'ready' && publicQuote.developerTokens > 0
                ? `${Math.round(publicQuote.developerTokens).toLocaleString()} ${tokenUnit}`
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
        noteNode.textContent = 'Estimated total includes the live Pump quote for the holder reserve and optional developer buy, its 1% purchase allowance, the current app launch service fee, and a 0.05 SOL planning allowance for network fees and account rent. The wallet-specific simulation replaces the planning allowance before signing. Any $RICH tier burn is separate.';
      } else {
        const pending = publicPlanningStatus(publicQuote, launchFeeLamports);
        if (initialBuyNode) initialBuyNode.textContent = pending;
        launchNode.textContent = pending;
        if (serviceFeeNode) serviceFeeNode.textContent = launchFeeLamports == null ? 'Unavailable' : formatLaunchCost(BigInt(launchFeeLamports));
        totalNode.textContent = pending;
        if (previewLaunchNode) previewLaunchNode.textContent = pending;
        noteNode.textContent = publicQuote?.status === 'invalid' && publicQuote.message
          ? publicQuote.message
          : 'The full planning budget needs a current public Pump quote and app fee policy. No wallet is required to view it; retry when either service is available.';
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
          ? 'Developer buy exceeds its 20% cap or the curve supply available after the community reserve. Return to Launch settings and lower the SOL amount or set it to 0. A new estimate will run after you change it.'
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
    ? 'SOL total includes the approved app launch service fee, network fees, account reserve, and any developer buy. The $RICH burn is separate.'
    : 'Standard needs no $RICH tier burn (the 5% fee buyback still applies). Total includes the approved app launch service fee, network fees, account reserve, and any creator buy with its 1% allowance.';
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
  syncPlanningPresentation(wallet, document);
  if (!wallet) {
    node.hidden = true;
    node.innerHTML = '';
    return;
  }
  node.hidden = false;
  const refreshMessage = launchEstimateRefreshMessage({ wallet, loading: walletMetricsLoading, retry: launchEstimateRetry });
  if (!launchCostReview && refreshMessage) node.textContent = refreshMessage;
  else node.innerHTML = freshLaunchReview(launchCostReview) ? quoteCountdownMarkup(launchCostReview.expiresAt, Date.now()) : 'Refresh the launch estimate before signing.';
  node.className = 'launch-quote-status';
}
