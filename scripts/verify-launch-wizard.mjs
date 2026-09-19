import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
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
assert.match(app, /X fee forwarding is blocked until the isolated per-coin router/);

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
