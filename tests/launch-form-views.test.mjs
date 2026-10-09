import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLaunchButton, renderPendingLaunchReview } from '../src/features/launch/action-view.js';
import { getLaunchStepState, getLaunchSubmissionState } from '../src/features/launch/form-validation.js';
import { exploreEmptyReason } from '../src/features/explore/status-view.js';
import { compactCoinSocials } from '../src/features/coin/header-view.js';
import { renderHomeHolderRewardCoins } from '../src/features/home/holder-rewards-view.js';
import { launchReview } from '../launch-review.js';

function element() {
  return { value: '', checked: true, dataset: {}, attributes: {}, hidden: false,
    textContent: '', innerHTML: '', classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] || null; },
    removeAttribute(name) { delete this.attributes[name]; } };
}
function fixture() {
  const nodes = new Map(['launch-button', 'token-name', 'token-symbol', 'creator-buy-sol',
    'creator-buy-help', 'creator-buy-token-amount', 'terms-agree', 'fee-route-agree',
    'launch-review-dialog', 'launch-review-details', 'launch-review-confirm'].map(id => [`#${id}`, element()]));
  nodes.get('#token-name').value = 'Example';
  nodes.get('#token-symbol').value = 'EX';
  const review = launchReview({ balance: 1_000_000_000, simulatedSpend: 10_000_000,
    networkFee: 5000, transactionCount: 1 });
  const state = { wallet: null, walletBalanceLamports: 1_000_000_000, estimatedLaunchFeeLamports: 10_000_000,
    launchCostReview: review, estimatedInitialBuyTokens: 0, LAUNCH_TOKEN_SUPPLY: 1_000_000_000,
    MIN_COMMUNITY_AIRDROP_TOKENS: 30_000_000, MAX_COMMUNITY_AIRDROP_TOKENS: 500_000_000,
    launchBurnReadiness: { ready: true }, xFeeStatus: { ready: true }, feeRouterState: { verified: true },
    walletMetricsLoading: false, PROTOCOL_FUNDED_MINT: '', APP_MAINNET_READ_ONLY: false, launchMode: 'quick' };
  const services = { document: { querySelector: key => nodes.get(key) },
    creatorBuyExceedsWalletBalance: () => false, getCreatorBuySol: () => 0,
    developerBuyLimitReached: () => false, getCommunityAirdropTokens: () => 30_000_000,
    getFeeDistributionInputs: () => ({ creatorWalletPercent: 80, holderAirdropPercent: 0, solClaimPercent: 0 }),
    getLaunchBurnPolicy: () => ({ tier: 'standard', requiresBurn: false }),
    getLaunchStepState: () => ({ valid: true }), updateLaunchNavigation() {}, invalidLaunchSocial: () => null,
    launchEstimateRefreshAvailable: input => input.policyValid && input.hasWallet && input.signingReady
      && !input.loading && !input.developerBuyBlocked && input.estimateUnavailable,
  };
  return { nodes, state, services, render: () => updateLaunchButton(state, services) };
}
const signingWallet = () => ({ publicKey: { toBase58: () => 'test-wallet' }, signTransaction() {} });

test('launch action follows wallet connection, quote expiry, signing readiness and consent', () => {
  const f = fixture(), button = f.nodes.get('#launch-button');
  f.render();
  assert.equal(button.dataset.launchAction, 'connect-wallet');
  assert.equal(button.disabled, false);
  f.state.wallet = signingWallet();
  f.render();
  assert.equal(button.dataset.launchAction, 'launch');
  assert.equal(button.disabled, false);
  f.state.launchCostReview = { ...f.state.launchCostReview, expiresAt: 0 };
  f.render();
  assert.equal(button.dataset.launchAction, 'refresh-estimate');
  assert.equal(button.disabled, false);
  f.state.walletMetricsLoading = true;
  f.render();
  assert.equal(button.disabled, true);
  f.state.walletMetricsLoading = false;
  f.state.launchCostReview = launchReview({ balance: 1e9, simulatedSpend: 1e7, networkFee: 5000, transactionCount: 1 });
  f.nodes.get('#terms-agree').checked = false;
  f.render();
  assert.equal(button.disabled, true);
  assert.match(button.textContent, /Agree to terms/);
});

test('over-limit developer buy blocks launch and clears its invalid marker after correction', () => {
  const f = fixture(), input = f.nodes.get('#creator-buy-sol');
  let exceeded = true;
  f.services.developerBuyLimitReached = () => exceeded;
  f.render();
  assert.equal(f.nodes.get('#launch-button').disabled, true);
  assert.equal(input.attributes['aria-invalid'], 'true');
  assert.match(f.nodes.get('#creator-buy-token-amount').textContent, /Over 20%/);
  exceeded = false;
  f.render();
  assert.equal(input.attributes['aria-invalid'], undefined);
  assert.equal(input.dataset.overLimit, undefined);
  assert.equal(f.nodes.get('#launch-button').disabled, false);
});

test('form validation reports identity, reserve, distribution and unavailable X reward errors', () => {
  const f = fixture();
  assert.equal(getLaunchStepState(1, f.state, f.services).valid, true);
  f.nodes.get('#token-symbol').value = 'INVALID!';
  assert.equal(getLaunchStepState(1, f.state, f.services).field, '#token-symbol');
  f.services.getCommunityAirdropTokens = () => 29_999_999;
  assert.equal(getLaunchStepState(2, f.state, f.services).field, '#community-airdrop-tokens');
  f.services.getCommunityAirdropTokens = () => 30_000_000;
  f.services.getFeeDistributionInputs = () => ({ creatorWalletPercent: 50 });
  assert.match(getLaunchStepState(2, f.state, f.services).message, /total exactly 80%/);
  f.services.getFeeDistributionInputs = () => ({ creatorWalletPercent: 0, solClaimPercent: 80, xRecipient: '@example' });
  f.state.xFeeStatus.ready = false;
  f.services.xFeeFailureDetail = () => 'identity unavailable';
  assert.match(getLaunchStepState(2, f.state, f.services).message, /identity unavailable/);
});

test('submission validation refuses stale estimates, insufficient balance and a disconnected wallet', () => {
  const f = fixture();
  f.state.wallet = signingWallet();
  assert.equal(getLaunchSubmissionState(f.state, f.services).valid, true);
  f.state.walletBalanceLamports = 1;
  assert.match(getLaunchSubmissionState(f.state, f.services).message, /Add SOL/);
  f.state.launchCostReview = null;
  assert.match(getLaunchSubmissionState(f.state, f.services).message, /Refresh the launch estimate/);
  f.state.wallet = null;
  assert.match(getLaunchSubmissionState(f.state, f.services).message, /Connect a wallet/);
});

test('review confirmation disables immediately when wallet or consent changes', () => {
  const f = fixture();
  f.nodes.get('#launch-review-dialog').open = true;
  const pending = { reviewedCost: f.state.launchCostReview, wallet: 'wallet-a', router: 'router', form: 'form' };
  let current = { ...pending, feeConsent: true, termsConsent: true };
  const render = () => renderPendingLaunchReview({ pendingLaunchReview: pending }, {
    document: f.services.document, currentLaunchReviewState: () => current,
  });
  render();
  assert.equal(f.nodes.get('#launch-review-confirm').disabled, false);
  current = { ...current, wallet: 'wallet-b' };
  render();
  assert.equal(f.nodes.get('#launch-review-confirm').disabled, true);
  assert.match(f.nodes.get('#launch-review-details').innerHTML, /expired or changed/);
  current = { ...pending, feeConsent: true, termsConsent: false };
  render();
  assert.equal(f.nodes.get('#launch-review-confirm').disabled, true);
});

test('Explore distinguishes an empty followed list from unavailable saved tokens and quote filters', () => {
  const state = { exploreTab: 'following', assets: [] };
  assert.match(exploreEmptyReason(state, { getWatchlist: () => [] })[0], /No followed tokens/);
  assert.match(exploreEmptyReason(state, { getWatchlist: () => ['saved'] })[0], /unavailable in this feed/);
  state.assets = [{ address: 'saved' }];
  assert.match(exploreEmptyReason(state, { getWatchlist: () => ['saved'] })[0], /match this view/);
  state.exploreTab = 'new'; state.exploreMinMarketCapUsd = 1000; state.coinSolUsdPrice = null;
  assert.match(exploreEmptyReason(state)[0], /waiting for a conversion quote/);
});

test('token social controls regain accessible labels when verified links arrive', () => {
  const link = { ...element(), tagName: 'A' };
  const socials = { classList: { add() {} }, querySelector: key => key === '#coin-website-link' ? link : null };
  const services = { document: { querySelector: () => socials } };
  compactCoinSocials({}, services);
  assert.equal(link.attributes['aria-disabled'], 'true');
  assert.equal(link.attributes['aria-label'], 'Website not provided');
  link.attributes.href = 'https://example.org';
  compactCoinSocials({}, services);
  assert.equal(link.attributes['aria-disabled'], undefined);
  assert.equal(link.attributes['aria-label'], 'Open token website');
});

test('holder reward list excludes unverified routes and escapes token metadata', () => {
  const list = element(), count = element();
  const launch = { mint: 'example', creator: 'router', symbol: 'EX', name: '<img onerror=bad>',
    feeDistribution: { creatorDirected: { shares: { holderAirdropPercent: 10 } } },
    pumpFeeRoute: { scope: 'per-mint-v2', verified: true, router: 'router' } };
  const state = { verifiedLaunchPoliciesStatus: 'ready', verifiedLaunchPolicies: [launch,
    { ...launch, mint: 'unverified', pumpFeeRoute: { ...launch.pumpFeeRoute, verified: false } }] };
  const services = { document: { querySelector: key => key === '#home-holder-rewards-list' ? list : count },
    verifiedPolicyPercent: Number, loadVerifiedTokenLogos() {} };
  renderHomeHolderRewardCoins(state, services);
  assert.equal(count.textContent, '1 verified coin');
  assert.match(list.innerHTML, /&lt;img/);
  assert.doesNotMatch(list.innerHTML, /\/token\/unverified|<img onerror/);
  state.verifiedLaunchPoliciesStatus = 'unavailable';
  renderHomeHolderRewardCoins(state, services);
  assert.equal(count.textContent, 'Unavailable');
  assert.doesNotMatch(list.innerHTML, /\/token\//);
});
