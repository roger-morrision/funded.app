import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, styles, pageStyles] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../page-experience.css', import.meta.url), 'utf8'),
]);

for (const step of [1, 2, 3]) {
  assert.match(html, new RegExp(`data-launch-step="${step}"`));
  assert.match(html, new RegExp(`data-launch-step-target="${step}"`));
}

assert.match(html, /id="launch-mode-quick"/);
assert.match(html, /id="launch-mode-custom"/);
const launchPage = html.split('<section class="launch-dialog launch-page launch-page-flat"')[1]?.split('<dialog class="info-dialog"')[0] || '';
assert.ok(launchPage, 'Dedicated launch page must exist');
assert.doesNotMatch(html, /<dialog[^>]+id="launch-dialog"/, 'Launch workspace must not be a modal dialog.');
assert.match(html, /class="launch-dialog launch-page launch-page-flat"/, 'Launch workspace must use the single-page form layout.');
assert.match(app, /function mountLaunchPage\(\)/, 'Launch workspace must mount into its route shell.');
assert.match(app, /shell\.append\(page\)/, 'Launch workspace must render inside the dedicated route.');
assert.match(app, /flatPage[\s\S]*?panel\.hidden = false/, 'Every launch section must remain visible on the single-page form.');
assert.match(pageStyles, /\.launch-page-flat \.wizard-actions[\s\S]*?display: none !important/, 'Wizard navigation must stay hidden in the single-page layout.');
assert.match(launchPage, /class="launch-platform-grid"[\s\S]*?Pump\.fun[\s\S]*?1 billion/, 'The launch form must summarize its launchpad and fixed supply before the inputs.');
assert.match(launchPage, /id="launch-preview-title">Launch summary[\s\S]*?id="preview-community"[\s\S]*?id="preview-creator-buy"[\s\S]*?id="preview-launch-cost"/, 'The sticky summary must expose the live community reserve, developer buy, and total.');
assert.match(launchPage, /<aside class="launch-preview"[^>]*><div class="launch-preview-sticky">/, 'The summary must use an inner sticky card so the launch action remains available through the full form.');
assert.match(pageStyles, /\[data-launch-step='2'\] \{ order: 1; \}[\s\S]*?\[data-launch-step='1'\] \{ order: 2; \}/, 'Launch settings must appear before token identity in the continuous form.');
assert.doesNotMatch(launchPage, /data-launch-step="4"|sign-step-title|Sign and verify|sign-checklist|Run local dry run/, 'The removed sign-and-verify panel must not return.');
assert.doesNotMatch(launchPage, /launch-page-checks|>Logo<\/span>|>Thesis<\/span>|>Official links<\/span>/, 'The removed launch-page readiness badges must not return.');
assert.doesNotMatch(launchPage, /Before the Pump transaction|desktop-hosted URL|preview database/, 'The removed metadata-storage warning must not return to the launch form.');
assert.doesNotMatch(launchPage, /Seed the curve from the same wallet|Pump quotes the SOL cost from the initial curve/, 'The removed creator-buy explanation must not return.');
assert.doesNotMatch(launchPage, /creator-buy-warning|Buying is optional and market-sensitive|Review the SOL quote and slippage cap/, 'The removed creator-buy warning must not return.');
assert.doesNotMatch(launchPage, /creator-burn-status|creator-burn-disclosure|Burns are irreversible|Featured-review eligibility never guarantees placement/, 'The removed launch-tier status and disclosure must not return.');
assert.match(launchPage, /id="community-airdrop-tokens"[\s\S]*?min="30000000"[\s\S]*?max="500000000"/, 'The launch form must accept a 30M–500M community airdrop amount.');
assert.match(launchPage, /data-airdrop-tokens="30000000"[\s\S]*?data-airdrop-tokens="50000000"/, 'The launch form must offer 30M and 50M airdrop presets.');
assert.match(launchPage, /id="creator-buy-sol"[\s\S]*?min="0"[\s\S]*?step="0\.01"/, 'The launch form must accept an optional developer buy in SOL.');
assert.match(app, /function getCommunityAllocationPercent\(\)[\s\S]*?getCommunityAirdropTokens\(\) \/ LAUNCH_TOKEN_SUPPLY \* 100/, 'The airdrop policy percentage must derive from the entered token amount.');
assert.match(app, /initialBuySol: getCreatorBuySol\(\)/, 'The developer SOL amount must feed the live Pump quote.');
assert.match(app, /estimatedInitialBuyTokens=Number\(initialBuy\.amountTokens\);\s*updateLaunchPreview\(\);/, 'The live Pump quote must refresh the visible developer-buy token estimate.');
assert.match(launchPage, /id="preview-promotion-badge"/, 'The launch preview must show the selected promotion badge.');
assert.match(launchPage, /class="cost-summary launch-pay-summary free-launch"[\s\S]*?id="cost-tier-label">FREE LAUNCH[\s\S]*?id="cost-burn-row" hidden[\s\S]*?id="cost-burn"/, 'The You pay panel must distinguish the free tier from paid $FUNDED burn tiers.');
assert.match(launchPage, /class="community-airdrop-highlight"[\s\S]*?30,000,000[\s\S]*?3\.00% of supply[\s\S]*?\$FUNDED holders[\s\S]*?migration snapshot eligibility · delivery requires vault funding and a verified active distribution cycle/, 'The You pay panel must distinguish airdrop eligibility from delivery gated by funding and an active cycle.');
assert.doesNotMatch(launchPage, /claimable at migration/, 'Migration alone must not promise a claimable payout.');
assert.match(launchPage, /class="enhanced-token-page"[\s\S]*?Enhanced token page[\s\S]*?INCLUDED/, 'The enhanced token-page editor must remain visible.');
assert.doesNotMatch(launchPage, /launch-route-badge|Pump launch<\/strong>|Solana · Devnet preview/, 'The removed launch-route banner must not return.');
assert.doesNotMatch(launchPage, /HTTPS links are published with the signed Devnet metadata|must use their official domains/, 'The removed social-link helper sentence must not return.');
assert.match(launchPage, /placeholder="https:\/\/yourproject\.com"/);
assert.match(launchPage, /placeholder="https:\/\/x\.com\/yourproject"/);
assert.match(launchPage, /placeholder="https:\/\/t\.me\/yourproject"/);
assert.match(launchPage, /placeholder="https:\/\/discord\.gg\/yourproject"/);
assert.match(launchPage, /class="launch-submit-row launch-preview-submit"[\s\S]*?id="launch-button"/, 'The essential launch action must sit directly below the You pay panel.');
assert.match(launchPage, /class="launch-review-submit"[\s\S]*?id="launch-button-review"/, 'A synchronized launch action must remain available beside the final wallet review.');
assert.match(app, /reviewButton\.disabled = button\.disabled; reviewButton\.textContent = button\.textContent/, 'The final-review launch action must mirror the summary action state.');
assert.doesNotMatch(launchPage, /review-referrer|<span>Inviter<\/span>|Gross fees across three app levels|<small>Referrals<\/small>/);
assert.match(launchPage, /APP PROTOCOL<\/span><strong>20%/);
assert.match(launchPage, /app-level referrals, \$FUNDED buyback and burn, community programs, and operations\/marketing/);
assert.doesNotMatch(launchPage, /automated funding and settlement are not live yet/, 'The removed Devnet policy paragraph must not return to the launch form.');
assert.match(launchPage, /the launch transaction is blocked before signing/);
assert.match(launchPage, /A paid-tier burn must fit atomically with Pump creation/);
assert.doesNotMatch(launchPage, /claim-example-receipt|Example for 1 SOL claimed|Illustration only; this is not a revenue forecast or a live claim/, 'The removed after-launch example card must not return.');
assert.match(html, /data-burn-tier="standard"/);
assert.match(html, /data-burn-tier="boost"/);
assert.match(html, /data-burn-tier="pro"/);
assert.match(html, /data-burn-tier="premier"/);
assert.match(html, /id="review-burn-tier"/);
assert.match(html, /id="fee-route-agree"/);
assert.doesNotMatch(launchPage, /Creator-fee route|Your wallet pays and signs, but it never receives Pump creator-fee authority/, 'The redundant creator-fee route card must remain removed from the launch form.');
assert.match(app, /function setLaunchStep\(/);
assert.match(app, /function setLaunchMode\(/);
assert.match(app, /function getLaunchStepState\(/);
assert.match(app, /function openBurnPageAfterLaunch\(launchPolicy\)[\s\S]*?projectSelect\.value = mint[\s\S]*?location\.hash = '#buybacks'/, 'A confirmed launch must open the Burn page with the new project selected.');
assert.match(app, /showToast\(persistedLaunch\.available[\s\S]*?openBurnPageAfterLaunch\(launchPolicy\)/, 'The Burn-page transition must run only from the confirmed launch success path.');
assert.match(app, /const infoDialogRoutes = new Set\(\['terms', 'disclosures', 'opt-out'\]\)/, 'Legal deep links must resolve to their information dialogs.');
assert.match(app, /openInfoDialog\(infoRoute, \{ routeDriven: true \}\)/, 'Direct legal hashes must open a route-driven dialog.');
assert.match(app, /history\.replaceState\(\{\}, '', `\$\{location\.pathname\}\$\{location\.search\}#overview`\)/, 'Closing a direct legal dialog must clear the stale legal hash.');
assert.match(app, /fee-route-agree/);
assert.match(app, /function setLaunchBurnTier\(/);
assert.match(app, /launchBurnReadiness/);
assert.match(app, /buildPumpLaunchPlan\(\{ payer, mint, blockhash: latest\.blockhash, launchInstructions, burnInstruction: burnPlan\?\.instruction, mintRouterInstruction: mintRouter\?\.instruction \}\)/, 'Estimate must use the same size-bounded transaction plan as launch.');
assert.match(app, /burnReceipt && !burnReceipt\.atomicWithPumpLaunch[\s\S]*?Verify separate \$FUNDED burn on Explorer/);
assert.doesNotMatch(app, /if \(DEV_MODE && !getProvider\(\)\)/, 'Devnet test wallets must reach the launch fee estimator.');
assert.match(app, /connection\.simulateTransaction\(transaction, undefined, \[payer\]\)/, 'Launch estimate must simulate every planned transaction.');
assert.match(app, /estimatedSpend = balance - simulatedPayerBalance/, 'Launch estimate must include rent, not only the signature fee.');
assert.doesNotMatch(app.split('const fee = estimates.reduce')[1]?.split('if (request !== metricsRequest')[0] || '', /simulatedPayerBalance/, 'The aggregate launch estimate must not reference a per-transaction simulation variable.');
assert.match(app, /function formatLaunchCost\(lamports\).*toFixed\(6\)/, 'Launch cost must show enough SOL precision for rent and transaction fees.');
assert.match(app, /if \(wallet\) refreshWalletInfo\(\);/, 'Switching back to Standard must refresh the estimate.');
assert.match(app, /if \(input\.matches\('#token-name, #token-symbol, #creator-buy-sol'\)\) scheduleLaunchCostRefresh\(\)/, 'Editing launch metadata or the developer buy must invalidate and refresh the estimate.');
assert.match(app, /if\s*\(\s*launchCostReview\s*&&\s*!freshLaunchReview\(launchCostReview\)\s*\)\s*\{[\s\S]*?setWalletMetrics\(\{[\s\S]*?balance:\s*walletBalanceLamports,[\s\S]*?fee:\s*null,[\s\S]*?Estimate expired\. Refresh before signing\./, 'An expired quote must clear the visible wallet estimate as well as the cost summary.');
assert.match(app, /note\.hidden = !loading && \(balance == null \|\| fee == null\)/, 'Unavailable estimates must not render the removed long warning below wallet metrics.');
assert.doesNotMatch(app, /Launch estimate unavailable: \$\{walletEstimateError\} Refresh the estimate before launching\./, 'The removed launch-estimate sentence must not return.');
assert.match(html, /X account reward %/);
assert.match(html, /An X handle cannot receive SOL directly/);
assert.match(app, /if \(feeDistributionInput\.solClaimPercent > 0 && !xFeeStatus\.ready\)/);
assert.match(app, /X account rewards unavailable/);
assert.match(app, /if \(wallet\) scheduleLaunchCostRefresh\(\);/, 'Tier changes must invalidate and recalculate the connected wallet estimate.');
for (const id of ['review-wallet-intro', 'profile-wallet-address', 'launch-path-wallet', 'sol-claim-submit']) {
  assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, new RegExp(`#${id}`));
}
const costSummarySource = app.match(/function updateCostSummary\(\)\{[\s\S]*?\n\}(?=\nfunction renderLaunchCostDetails)/)?.[0];
assert.ok(costSummarySource, 'Launch cost summary function must remain testable.');
const renderCostSummary = new Function('document', 'getLaunchBurnPolicy', 'getCreatorBuySummary', 'getCommunityAirdropTokens', 'getCommunityAllocationPercent', 'formatLaunchBurnAmount', 'formatLaunchCost', 'wallet', 'walletMetricsLoading', 'walletEstimateError', 'estimatedLaunchFeeLamports', 'launchCostReview', `const renderLaunchCostDetails=()=>{};${costSummarySource}\nupdateCostSummary();`);
function costSummaryFor({ connected = false, loading = false, fee = null, error = '' } = {}) {
  const nodes = Object.fromEntries(['cost-launch', 'cost-total-enabled', 'cost-total', 'cost-note', 'preview-launch-cost', 'cost-burn', 'cost-community-tokens', 'cost-community-detail', 'cost-creator-buy'].map(id => [`#${id}`, { textContent: '', innerHTML: '' }]));
  renderCostSummary({ querySelector: selector => nodes[selector] || null }, () => ({ requiresBurn: false }), () => ({ sol: 0, tokens: 0, percent: 0 }), () => 30_000_000, () => 3, String, lamports => `${(Number(lamports) / 1_000_000_000).toFixed(6)} SOL`, connected ? { publicKey: true } : null, loading, error, fee, null);
  return nodes;
}
assert.equal(costSummaryFor()['#cost-launch'].textContent, 'Connect wallet to estimate');
assert.equal(costSummaryFor()['#cost-burn'].textContent, '0 $FUNDED');
assert.equal(costSummaryFor({ connected: true, loading: true })['#cost-launch'].textContent, 'Calculating…');
const connectedWithoutEstimate = costSummaryFor({ connected: true, error: 'RPC unavailable.' });
assert.equal(connectedWithoutEstimate['#cost-launch'].textContent, 'Estimate unavailable');
assert.doesNotMatch(connectedWithoutEstimate['#cost-note'].textContent, /Connect (a |Phantom|your )?wallet/i);
assert.match(connectedWithoutEstimate['#cost-note'].textContent, /RPC unavailable/);
assert.equal(costSummaryFor({ connected: true, fee: 10_000_000 })['#cost-launch'].textContent, '0.010000 SOL');
assert.match(app, /ready \? \(launchBurn\.requiresBurn \? `Create coin · \$\{launchBurn\.label\}` : 'Create coin · Free launch'\)/, 'The ready launch action must identify the free launch tier.');
assert.match(pageStyles, /\.launch-token-preview-image \{[^}]*aspect-ratio: 1 \/ 1/, 'The token preview must retain a square image area.');
assert.match(pageStyles, /\.preview-promotion-badge\.premier/, 'The preview badge must support the Premier promotion tier.');
assert.match(pageStyles, /\.launch-enhanced-preview/, 'The enhanced token-page preview must remain styled.');
assert.match(pageStyles, /\.launch-page-flat \.launch-preview #launch-cost-details,[\s\S]*?\.launch-page-flat \.launch-enhanced-preview \{ display: none; \}/, 'Duplicate sidebar detail blocks must stay hidden so the essential launch summary remains sticky.');
assert.match(pageStyles, /#cost-burn-row\[hidden\] \{ display: none; \}/, 'The free tier must fully hide the zero-value $FUNDED burn row.');
assert.match(pageStyles, /\.launch-page input:not\(\[type='checkbox'\]\):not\(\[type='file'\]\)[\s\S]*?font-size: 14px/, 'Launch page fields must keep readable input text.');

const removedDeadFeatures = [
  /id="dev-buy"/,
  /id="wallet-qr-button"/,
  /id="devnet-only-image-field"/,
  /id="payment-note"/,
  /id="funded-burn-enable"/,
];

for (const pattern of removedDeadFeatures) assert.doesNotMatch(html, pattern);
assert.doesNotMatch(app, /launchFeeSol/);
assert.doesNotMatch(app, /handleMobileWalletCallback/);
assert.doesNotMatch(app, /mobile signing setup required/i);

console.log('launch wizard checks passed');
