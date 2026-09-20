import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app, styles] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
]);

for (const step of [1, 2, 3, 4]) {
  assert.match(html, new RegExp(`data-launch-step="${step}"`));
  assert.match(html, new RegExp(`data-launch-step-target="${step}"`));
}

assert.match(html, /id="launch-mode-quick"/);
assert.match(html, /id="launch-mode-custom"/);
const launchDialog = html.split('<dialog class="launch-dialog"')[1]?.split('</dialog>')[0] || '';
assert.ok(launchDialog, 'Launch dialog must exist');
assert.doesNotMatch(launchDialog, /review-referrer|<span>Inviter<\/span>|Gross fees across three app levels|<small>Referrals<\/small>/);
assert.match(launchDialog, /APP PROTOCOL<\/span><strong>20%/);
assert.match(launchDialog, /app-level referrals, \$FUNDED buyback and burn, community programs, and operations\/marketing/);
assert.match(launchDialog, /automated funding and settlement are not live yet/);
assert.match(launchDialog, /the launch transaction is blocked before signing/);
assert.match(launchDialog, /paid-tier burn must fit in the same transaction/);
assert.match(launchDialog, /<b>0\.80<\/b> creator-directed/);
assert.match(launchDialog, /<b>0\.20<\/b> app protocol/);
assert.match(html, /data-burn-tier="standard"/);
assert.match(html, /data-burn-tier="boost"/);
assert.match(html, /data-burn-tier="pro"/);
assert.match(html, /data-burn-tier="premier"/);
assert.match(html, /id="review-burn-tier"/);
assert.match(html, /This launch burn is separate from the automatic 1% revenue buyback and burn/);
assert.match(html, /id="fee-route-agree"/);
assert.match(html, /Your wallet pays and signs, but it never receives Pump creator-fee authority/);
assert.match(app, /function setLaunchStep\(/);
assert.match(app, /function setLaunchMode\(/);
assert.match(app, /function getLaunchStepState\(/);
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
assert.match(app, /if \(input\.matches\('#token-name, #token-symbol'\)\) scheduleLaunchCostRefresh\(\)/, 'Editing launch metadata must invalidate and refresh the estimate.');
assert.match(html, /X account reward %/);
assert.match(html, /An X handle cannot receive SOL directly/);
assert.match(app, /if \(feeDistributionInput\.solClaimPercent > 0 && !xFeeStatus\.ready\)/);
assert.match(app, /X account rewards unavailable/);
assert.match(app, /if \(wallet\) scheduleLaunchCostRefresh\(\);/, 'Tier changes must invalidate and recalculate the connected wallet estimate.');
for (const id of ['review-wallet-intro', 'profile-wallet-hint', 'launch-path-wallet', 'sol-claim-submit']) {
  assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, new RegExp(`#${id}`));
}
const costSummarySource = app.match(/function updateCostSummary\(\)\{[\s\S]*?\n\}(?=\nfunction updatePreviewStatusDrawer)/)?.[0];
assert.ok(costSummarySource, 'Launch cost summary function must remain testable.');
const renderCostSummary = new Function('document', 'getLaunchBurnPolicy', 'formatLaunchBurnAmount', 'formatLaunchCost', 'wallet', 'walletMetricsLoading', 'walletEstimateError', 'estimatedLaunchFeeLamports', `${costSummarySource}\nupdateCostSummary();`);
function costSummaryFor({ connected = false, loading = false, fee = null, error = '' } = {}) {
  const nodes = Object.fromEntries(['cost-launch', 'cost-total-enabled', 'cost-total', 'cost-note', 'preview-launch-cost', 'cost-burn'].map(id => [`#${id}`, { textContent: '' }]));
  renderCostSummary({ querySelector: selector => nodes[selector] || null }, () => ({ requiresBurn: false }), String, lamports => `${(Number(lamports) / 1_000_000_000).toFixed(6)} SOL`, connected ? { publicKey: true } : null, loading, error, fee);
  return nodes;
}
assert.equal(costSummaryFor()['#cost-launch'].textContent, 'Connect wallet to estimate');
assert.equal(costSummaryFor({ connected: true, loading: true })['#cost-launch'].textContent, 'Calculating…');
const connectedWithoutEstimate = costSummaryFor({ connected: true, error: 'RPC unavailable.' });
assert.equal(connectedWithoutEstimate['#cost-launch'].textContent, 'Estimate unavailable');
assert.doesNotMatch(connectedWithoutEstimate['#cost-note'].textContent, /Connect (a |Phantom|your )?wallet/i);
assert.match(connectedWithoutEstimate['#cost-note'].textContent, /RPC unavailable/);
assert.equal(costSummaryFor({ connected: true, fee: 10_000_000 })['#cost-launch'].textContent, '0.010000 SOL');
assert.match(styles, /\.launch-preview \.preview-claim-split small\{[^}]*font-size:12px/, 'Preview split labels must remain readable.');
assert.match(styles, /\.launch-preview \.preview-lock p\{[^}]*font-size:12px/, 'Preview safety copy must remain readable.');
assert.match(styles, /\.launch-preview \.preview-caption\{[^}]*font-size:12px/, 'Preview caption must remain readable.');
assert.match(styles, /dialog\.launch-dialog input:not\(\[type=checkbox\]\):not\(\[type=file\]\)[^}]*font-size:14px/, 'Launch form placeholders must inherit readable input text.');

const removedDeadFeatures = [
  /id="dev-buy"/,
  /id="wallet-qr-button"/,
  /id="devnet-only-image-field"/,
  /id="payment-note"/,
  /id="funded-burn-enable"/,
  /Enhanced page/i,
];

for (const pattern of removedDeadFeatures) assert.doesNotMatch(html, pattern);
assert.doesNotMatch(app, /launchFeeSol/);
assert.doesNotMatch(app, /handleMobileWalletCallback/);
assert.doesNotMatch(app, /mobile signing setup required/i);

console.log('launch wizard checks passed');
