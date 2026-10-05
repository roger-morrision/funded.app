import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchReviewStillCurrent } from '../launch-review-gate.js';

const [html, app, styles, pageStyles, workspaceStyles] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../page-experience.css', import.meta.url), 'utf8'),
  readFile(new URL('../workspace-ui.css', import.meta.url), 'utf8'),
]);

for (const step of [1, 2, 3]) {
  assert.match(html, new RegExp(`data-launch-step="${step}"`));
  assert.match(html, new RegExp(`data-launch-step-target="${step}"`));
}

assert.match(html, /id="launch-mode-quick"/);
assert.match(html, /id="launch-mode-custom"/);
function launchSection(source) {
  // The launch workspace contains nested sections. Match its ID regardless of
  // attribute order, then stop at its own closing tag, not a later dialog.
  const tags = /<!--[\s\S]*?-->|<section\b(?:"[^"]*"|'[^']*'|[^'">])*>|<\/section\s*>/gi;
  let start = -1, depth = 0;
  for (const match of source.matchAll(tags)) {
    if (match[0].startsWith('<!--')) continue;
    const closing = /^<\//.test(match[0]);
    if (start < 0) {
      if (closing || !/\sid\s*=\s*(["'])launch-dialog\1(?=\s|>)/i.test(match[0])) continue;
      start = match.index;
    }
    depth += closing ? -1 : 1;
    if (depth === 0) return source.slice(start, match.index + match[0].length);
  }
  return '';
}
for (const opening of ['<section id="launch-dialog" class="launch-page" inert>', "<section inert class='launch-page' id='launch-dialog'>"]) {
  const section = `${opening}<section>Nested</section><p>After nested section</p></section>`;
  assert.equal(launchSection(`<section data-id="launch-dialog">Outside</section><!-- <section id="launch-dialog"> -->${section}<section>Following</section><dialog>Outside dialog</dialog>`), section, 'Section extraction must preserve nested content and exclude adjacent markup.');
}
assert.equal(launchSection('<section id="launch-dialog"><section>Incomplete</section>'), '', 'An unclosed launch workspace must not absorb unrelated markup.');
const launchPage = launchSection(html);
assert.ok(launchPage, 'Dedicated launch page must exist');
assert.doesNotMatch(html, /<dialog[^>]+id="launch-dialog"/, 'Launch workspace must not be a modal dialog.');
assert.match(html, /class="launch-dialog launch-page launch-page-flat"/, 'Launch workspace must show one form and a cost preview.');
assert.match(app, /function mountLaunchPage\(\)/, 'Launch workspace must mount into its route shell.');
assert.match(app, /shell\.append\(page\)/, 'Launch workspace must render inside the dedicated route.');
assert.match(pageStyles, /\.launch-page-flat \.launch-step-panel,\s*\.launch-page-flat \.launch-step-panel\[hidden\][\s\S]*?display: block !important/, 'Coin details and launch settings must share one page.');
assert.match(pageStyles, /\.launch-page-flat \.launch-review-step,\s*\.launch-page-flat \.launch-review-step\[hidden\] \{ display: none !important; \}/, 'The old review panel must stay hidden.');
assert.match(app, /for \(let previous = 1; previous < target; previous\+\+\)[\s\S]*?getLaunchStepState\(previous\)[\s\S]*?if \(!state.valid\)/, 'Forward jumps must validate every preceding step.');
assert.doesNotMatch(launchPage, /class="launch-platform-grid"|Solana Devnet bonding curve|Fixed supply · 6 decimals/, 'The redundant launch platform and token supply cards must stay removed.');
assert.match(launchPage, /id="launch-preview-title">Launch summary[\s\S]*?id="preview-community"[\s\S]*?id="preview-creator-buy"[\s\S]*?id="preview-launch-cost"/, 'The sticky summary must expose the live community reserve, developer buy, and total.');
assert.match(launchPage, /<aside class="launch-preview"[^>]*><div class="launch-preview-sticky">/, 'The summary must use an inner sticky card so the launch action remains available through the full form.');
assert.match(launchPage, /data-launch-step="1"[\s\S]*?data-launch-step="2"[\s\S]*?data-launch-step="3"/, 'Details, settings, and review must follow a logical order.');
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
assert.match(app, /'#preview-community': Number\.isFinite\(allocation\) \? formatVerifiedPercent\(allocation\) : '—'/, 'The launch summary must format fractional reserve percentages without floating-point scientific notation.');
assert.match(app, /initialBuySol: getCreatorBuySol\(\)/, 'The developer SOL amount must feed the live Pump quote.');
assert.match(app, /estimatedInitialBuyTokens=Number\(developerBuy\.amountTokens\);\s*updateLaunchPreview\(\);/, 'The live Pump quote must refresh the visible developer-buy token estimate.');
assert.match(app, /creatorBuy\.sol > 0 \? wallet \? 'Calculating…' : 'Connect wallet to estimate' : 'None'/, 'An unconnected developer buy must ask for a wallet instead of remaining stuck on Calculating.');
assert.match(app, /wallet \? ' · quote pending' : ' · connect wallet to quote'/, 'The launch cost summary must label an unconnected developer-buy quote truthfully.');
assert.match(app, /!feeDistribution\.valid \? 'Fix fee distribution'/, 'Invalid fee shares must be explained before the disconnected-wallet prompt.');
assert.match(launchPage, /id="preview-promotion-badge"/, 'The launch preview must show the selected promotion badge.');
assert.match(launchPage, /class="cost-summary launch-pay-summary free-launch"[\s\S]*?id="cost-tier-label">Platform launch fee: 0[\s\S]*?id="cost-burn-row" hidden[\s\S]*?id="cost-burn"/, 'Zero platform fee must remain distinct from paid promotion burns and network costs.');
assert.match(launchPage, /class="community-airdrop-highlight"[\s\S]*?30,000,000[\s\S]*?3\.00% of supply[\s\S]*?bought and locked in the reward vault when launch finalizes/, 'The You pay panel must describe atomic reserve funding.');
assert.doesNotMatch(launchPage, /delivery requires vault funding and a verified active distribution cycle/, 'The removed delivery sentence must not return to the launch panel.');
assert.doesNotMatch(launchPage, /claimable at migration/, 'Migration alone must not promise a claimable payout.');
assert.match(launchPage, /class="enhanced-token-page"[\s\S]*?id="token-tagline"[\s\S]*?id="token-roadmap"/, 'The project story editor must retain thesis and roadmap fields.');
assert.doesNotMatch(launchPage, /Enhanced token page[\s\S]*?Tell the full story[\s\S]*?INCLUDED/, 'The redundant story promotion must not return inside the form.');
assert.doesNotMatch(launchPage, /launch-route-badge|Pump launch<\/strong>|Solana · Devnet preview/, 'The removed launch-route banner must not return.');
assert.doesNotMatch(launchPage, /HTTPS links are published with the signed Devnet metadata|must use their official domains/, 'The removed social-link helper sentence must not return.');
assert.match(launchPage, /placeholder="https:\/\/yourproject\.com"/);
assert.match(launchPage, /placeholder="https:\/\/x\.com\/yourproject"/);
assert.match(launchPage, /placeholder="https:\/\/t\.me\/yourproject"/);
assert.match(launchPage, /placeholder="https:\/\/discord\.gg\/yourproject"/);
for (const label of ['Project website URL', 'Project X profile URL', 'Project Telegram URL', 'Project Discord URL']) assert.match(launchPage, new RegExp(`aria-label="${label}"`));
assert.match(app, /canonicalLaunchSocialUrl\(preview\.x, 'x'\)/, 'The X link must meet metadata API rules before wallet message signing.');
assert.match(app, /function invalidLaunchSocial\(\)[\s\S]*?updateLaunchSocialValidity\(field\)[\s\S]*?validPublicUrl\(launchSocialValue\(field\), field\.id\)/, 'Optional social links must meet the API rules before review.');
assert.match(app, /function openLaunchReview\(\)[\s\S]*?normalizeLaunchSocialField\(document\.querySelector\('#token-x'\)\)/, 'The X profile link must be normalized before review state is captured.');
assert.match(app, /const identityValid = getLaunchStepState\(1\)\.valid/, 'Invalid social links must disable launch review.');
assert.match(app, /!identityValid \? 'Fix coin details'/, 'The primary launch action must surface invalid coin details before asking for a wallet.');
assert.match(launchPage, /class="launch-submit-row launch-preview-submit"[\s\S]*?id="launch-button"/, 'The essential launch action must sit directly below the You pay panel.');
assert.doesNotMatch(launchPage, /launch-button-review/, 'The review step must not duplicate the signing action.');
assert.match(launchPage, /id="launch-review-summary"/, 'The review step must summarize selected details.');
assert.match(launchPage, /id="preview-launchpad">Pump\.fun<\/strong>/, 'Launchpad summary should always have a visible fallback.');
assert.match(launchPage, /id="preview-network">Solana Devnet<\/strong>/, 'Network summary should always have a visible fallback.');
assert.match(launchPage, /id="preview-supply">1 billion<\/strong>/, 'Supply summary should always have a visible fallback.');
assert.match(pageStyles, /\.launch-summary-specs > div \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(90px, auto\)/s, 'Launch summary rows should contain long values instead of clipping them.');
assert.match(pageStyles, /\.launch-pay-summary \.cost-row > b \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere/s, 'Launch cost values should wrap instead of widening the preview card.');
assert.doesNotMatch(launchPage, /id="wallet-status"|id="dialog-connect"/, 'The duplicated connected-wallet card must not return to You pay.');
assert.doesNotMatch(launchPage, /id="wallet-metrics"|id="wallet-balance"|id="launch-fee"|id="refresh-wallet"|id="fee-note"/, 'The duplicated wallet-balance and launch-estimate card must not return to You pay.');
assert.match(launchPage, /class="cost-summary launch-pay-summary[\s\S]*?class="launch-pay-approval"[\s\S]*?id="fee-route-agree"[\s\S]*?id="terms-agree"[\s\S]*?id="airdrop-button"/, 'Consent and test-fund controls must remain inside You pay after wallet-metrics removal.');
assert.match(app, /const estimateRefreshReady = launchEstimateRefreshAvailable\([\s\S]*?estimateUnavailable: balanceUnknown,[\s\S]*?button\.disabled = !\(ready \|\| estimateRefreshReady \|\| connectReady\)/, 'A valid disconnected form and expired connected estimate must keep the action available.');
assert.match(app, /button\.dataset\.launchAction = connectReady \? 'connect-wallet' : estimateRefreshReady \? 'refresh-estimate' : 'launch'/, 'The launch action must distinguish wallet connection, refresh, and signing.');
assert.match(app, /function handleLaunchAction\(event\)[\s\S]*?dataset\.launchAction === 'connect-wallet'[\s\S]*?connectWallet\(\)[\s\S]*?dataset\.launchAction === 'refresh-estimate'[\s\S]*?refreshWalletInfo\(\)[\s\S]*?openLaunchReview\(\)/, 'A valid disconnected form must connect a wallet, while an expired quote refreshes and a ready launch opens review.');
assert.match(app, /#launch-button'\)\.addEventListener\('click', handleLaunchAction\)/, 'The single visible launch action must use the refresh-aware handler.');
assert.doesNotMatch(app, /launch-button-review|reviewButton|#review-(?:coin|community|creator-share|holder-share|x-share|burn-tier|burn-amount|creator-buy|wallet-intro)/, 'Removed final-review controls must have no stale script references.');
const refreshAvailabilitySource = app.match(/function launchEstimateRefreshAvailable\([^)]*\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(refreshAvailabilitySource, 'Launch estimate refresh eligibility must remain independently testable.');
const launchEstimateRefreshAvailable = new Function(`${refreshAvailabilitySource}\nreturn launchEstimateRefreshAvailable;`)();
const refreshableEstimate = { policyValid: true, hasWallet: true, signingReady: true, loading: false, developerBuyBlocked: false, estimateUnavailable: true };
assert.equal(launchEstimateRefreshAvailable(refreshableEstimate), true, 'An expired connected-wallet estimate must expose an enabled refresh action.');
assert.equal(launchEstimateRefreshAvailable({ ...refreshableEstimate, loading: true }), false, 'Refresh must stay disabled while estimation is already running.');
assert.equal(launchEstimateRefreshAvailable({ ...refreshableEstimate, policyValid: false }), false, 'Invalid launch inputs must be fixed before requesting an estimate.');
const launchActionSource = app.match(/function handleLaunchAction\(event\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(launchActionSource, 'The refresh-aware launch click handler must remain independently testable.');
const launchActionCalls = [];
const handleLaunchAction = new Function('connectWallet', 'refreshWalletInfo', 'openLaunchReview', `${launchActionSource}\nreturn handleLaunchAction;`)(() => launchActionCalls.push('connect'), () => launchActionCalls.push('refresh'), () => launchActionCalls.push('review'));
handleLaunchAction({ currentTarget: { dataset: { launchAction: 'connect-wallet' } } });
handleLaunchAction({ currentTarget: { dataset: { launchAction: 'refresh-estimate' } } });
handleLaunchAction({ currentTarget: { dataset: { launchAction: 'launch' } } });
assert.deepEqual(launchActionCalls, ['connect', 'refresh', 'review'], 'The one-page action must connect, refresh, or open review at the appropriate stage.');
assert.match(app, /function renderPendingLaunchReview\(\)[\s\S]*?launchReviewStillCurrent\(pending, currentLaunchReviewState\(\)\)/);
assert.match(app, /function confirmLaunchReview\(\)[\s\S]*?launchReviewStillCurrent\(pending, currentLaunchReviewState\(\)\)/);
const reviewedCost = { quotedAt: 100, expiresAt: 200 };
const image = {};
const pendingReview = { reviewedCost, wallet: 'test-wallet', router: 'test-router', form: '{"name":"QA"}', image };
const currentReview = { ...pendingReview, feeConsent: true, termsConsent: true };
assert.equal(launchReviewStillCurrent(pendingReview, currentReview, 150), true, 'A current review must allow the wallet handoff.');
assert.equal(launchReviewStillCurrent(pendingReview, currentReview, 200), false, 'An expired review must disable the wallet handoff.');
assert.equal(launchReviewStillCurrent(pendingReview, { ...currentReview, reviewedCost: { ...reviewedCost } }, 150), false, 'A changed estimate must require a new review.');
assert.equal(launchReviewStillCurrent(pendingReview, { ...currentReview, form: '{"name":"Changed"}' }, 150), false, 'A changed token or fee policy must require a new review.');
assert.equal(launchReviewStillCurrent(pendingReview, { ...currentReview, termsConsent: false }, 150), false, 'Consent withdrawal must block the wallet handoff.');
assert.equal(launchReviewStillCurrent(pendingReview, { ...currentReview, image: {} }, 150), false, 'Changing the image must require a new review.');
assert.doesNotMatch(launchPage, /review-referrer|<span>Inviter<\/span>|Gross fees across three app levels|<small>Referrals<\/small>/);
assert.match(launchPage, /APP PROTOCOL<\/span><strong>20%/);
assert.match(launchPage, /app-level referrals, \$FUNDED buyback and burn, community programs, and operations\/marketing/);
assert.doesNotMatch(launchPage, /automated funding and settlement are not live yet/, 'The removed Devnet policy paragraph must not return to the launch form.');
assert.match(launchPage, /Paid tiers burn \$FUNDED in the launch transaction/);
assert.doesNotMatch(launchPage, /claim-example-receipt|Example for 1 SOL claimed|Illustration only; this is not a revenue forecast or a live claim/, 'The removed after-launch example card must not return.');
assert.match(html, /data-burn-tier="standard"/);
assert.doesNotMatch(launchPage, /class="creator-burn-card boost"|data-burn-tier="boost"/, 'Boost must not appear as a new launch tier.');
assert.match(html, /data-burn-tier="pro"/);
assert.match(html, /data-burn-tier="premier"/);
assert.match(html, /id="fee-route-agree"/);
assert.doesNotMatch(launchPage, /Creator-fee route|Your wallet pays and signs, but it never receives Pump creator-fee authority/, 'The redundant creator-fee route card must remain removed from the launch form.');
assert.match(app, /function setLaunchStep\(/);
assert.match(app, /function setLaunchMode\(/);
assert.match(app, /function getLaunchStepState\(/);
assert.match(app, /function openBurnPageAfterLaunch\(launchPolicy\)[\s\S]*?projectSelect\.value = mint[\s\S]*?location\.hash = '#buybacks'/, 'A confirmed launch must open the Burn page with the new project selected.');
assert.match(app, /showToast\(persistedLaunch\.available[\s\S]*?openBurnPageAfterLaunch\(launchPolicy\)/, 'The Burn-page transition must run only from the confirmed launch success path.');
assert.match(app, /const needsRecovery=Boolean\(saved&&\(saved\.signature\|\|saved\.events\?\.some/, 'Launch recovery guidance must depend on a receipt or an on-chain-progress state.');
assert.match(app, /No transaction was sent; correct the issue and retry\./, 'Pre-broadcast launch failures must clearly say that no transaction was sent.');
assert.match(app, /const infoDialogRoutes = new Set\(\['terms', 'disclosures', 'opt-out'\]\)/, 'Legal deep links must resolve to their information dialogs.');
assert.match(app, /openInfoDialog\(infoRoute, \{ routeDriven: true \}\)/, 'Direct legal hashes must open a route-driven dialog.');
assert.match(app, /history\.replaceState\(\{\}, '', `\$\{location\.pathname\}\$\{location\.search\}#overview`\)/, 'Closing a direct legal dialog must clear the stale legal hash.');
assert.match(app, /fee-route-agree/);
assert.match(app, /function setLaunchBurnTier\(/);
assert.match(app, /launchBurnReadiness/);
assert.match(app, /buildPumpLaunchPlan\(\{ payer, mint, blockhash: latest\.blockhash, launchInstructions, burnInstruction: burnPlan\?\.instruction,\s*mintRouterInstruction: mintRouter\?\.instruction, reserveInstructions:reserve\.instructions,\s*lookupTable \}\)/, 'Estimate must use the same reserve-funded transaction plan as launch.');
assert.match(app, /for \(let blockhashAttempt = 0; blockhashAttempt < 2; blockhashAttempt \+= 1\)[\s\S]*?getLatestBlockhash\('finalized'\)/, 'Launch estimation must use a finalized blockhash and one bounded retry.');
assert.match(app, /BlockhashNotFound\|blockhash not found[\s\S]*?if \(!blockhashMissing \|\| blockhashAttempt > 0\) throw error/, 'Only BlockhashNotFound may retry, and only once.');
assert.match(app, /blockhashAttempt > 0\) await new Promise\(resolve => setTimeout\(resolve, 1100\)\)/, 'The blockhash retry must outwait the one-second RPC proxy cache.');
assert.match(app, /burnReceipt && !burnReceipt\.atomicWithPumpLaunch[\s\S]*?Verify separate \$FUNDED burn on Explorer/);
assert.doesNotMatch(app, /if \(DEV_MODE && !getProvider\(\)\)/, 'Devnet test wallets must reach the launch fee estimator.');
assert.match(app, /connection\.simulateTransaction\(transaction, undefined, \[payer\]\)/, 'Launch estimate must simulate every planned transaction.');
assert.match(app, /estimatedSpend = balance - simulatedPayerBalance/, 'Launch estimate must include rent, not only the signature fee.');
assert.doesNotMatch(app.split('const fee = estimates.reduce')[1]?.split('if (request !== metricsRequest')[0] || '', /simulatedPayerBalance/, 'The aggregate launch estimate must not reference a per-transaction simulation variable.');
assert.match(app, /function formatLaunchCost\(lamports\).*toFixed\(6\)/, 'Launch cost must show enough SOL precision for rent and transaction fees.');
assert.match(app, /if \(wallet\) refreshWalletInfo\(\);/, 'Switching back to Standard must refresh the estimate.');
assert.match(app, /if \(input\.matches\('#token-name, #token-symbol, #creator-buy-sol'\)\) scheduleLaunchCostRefresh\(\)/, 'Editing launch metadata or the developer buy must invalidate and refresh the estimate.');
assert.match(app, /launchPageActive&&!document\.hidden&&!walletMetricsLoading&&launchReviewNeedsRefresh\(launchCostReview\)[\s\S]*?scheduleLaunchCostRefresh\(\)/, 'A visible connected launch page must refresh its estimate before expiry without user action.');
assert.doesNotMatch(app, /Launch estimate unavailable: \$\{walletEstimateError\} Refresh the estimate before launching\./, 'The removed launch-estimate sentence must not return.');
assert.match(html, /X account reward %/);
assert.doesNotMatch(html, /An X handle cannot receive SOL directly/);
assert.doesNotMatch(app, /Creator-directed policy totals 80%\. This coin gets its own automatic-reward route\./);
assert.match(app, /if \(feeDistributionInput\.solClaimPercent > 0 && !xFeeStatus\.ready\)/);
assert.match(app, /X account rewards unavailable/);
assert.match(app, /if \(wallet\) scheduleLaunchCostRefresh\(\);/, 'Tier changes must invalidate and recalculate the connected wallet estimate.');
for (const id of ['profile-wallet-address', 'launch-path-wallet', 'sol-claim-submit']) {
  assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, new RegExp(`#${id}`));
}
assert.doesNotMatch(app, /#dialog-connect|['"]dialog-connect['"]|#wallet-status/, 'Removed launch wallet-card controls must have no stale script references.');
assert.doesNotMatch(app, /#wallet-metrics|#wallet-balance|#launch-fee|#refresh-wallet|#fee-note/, 'Removed wallet-metrics controls must have no stale script references.');
assert.match(app, /'connect-button', 'profile-connect'[^\]]*?'sol-claim-submit'/, 'The generic connect-wallet handler must not duplicate profile connections or override SOL-claim prerequisite validation.');
const costSummarySource = app.match(/function updateCostSummary\(\)\{[\s\S]*?\r?\n\}(?=\r?\nfunction renderLaunchCostDetails)/)?.[0];
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
assert.match(app, /ready \? \(launchBurn\.requiresBurn \? `Review launch · \$\{launchBurn\.label\}` : 'Review launch'\)/, 'The ready action must explicitly lead to transaction review.');
assert.match(pageStyles, /\.launch-token-preview-image \{[^}]*aspect-ratio: 1 \/ 1/, 'The token preview must retain a square image area.');
assert.match(pageStyles, /\.preview-promotion-badge\.premier/, 'The preview badge must support the Premier promotion tier.');
assert.match(pageStyles, /\.launch-enhanced-preview/, 'The enhanced token-page preview must remain styled.');
assert.match(workspaceStyles, /launch-page-wizard/, 'The launch layout must have dedicated responsive styles.');
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

const xFeeFailureDetailSource = app.match(/function xFeeFailureDetail\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(xFeeFailureDetailSource, 'X fee unavailability needs a reusable sentence-safe reason formatter.');
const xFeeFailureDetail = new Function('xFeeStatus', `${xFeeFailureDetailSource}\nreturn xFeeFailureDetail;`)({
  reasons: ['API service unavailable. Check the local API and database services, then retry.'],
});
assert.equal(xFeeFailureDetail(), 'API service unavailable. Check the local API and database services, then retry');
assert.match(app, /`Unavailable: \$\{xFeeFailureDetail\(\)\}\.`/, 'The X reward gate should add one final sentence period.');

console.log('launch wizard checks passed');
