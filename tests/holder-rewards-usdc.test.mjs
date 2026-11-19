import test from 'node:test';
import assert from 'node:assert/strict';
import { holderRewardsSummary, holderRewardsMarkup } from '../src/features/coin/holder-rewards-card.js';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const token = extra => ({ holderSharePercent:80, symbol:'Q', totals:{ holder:'0' }, holderPaidLamports:'0', holderPaidWallets:0,
  holderPayoutCount:0, holderRewardPolicy:{ cadence:'five-minutes', periodSeconds:300, minimumPoolUsd:0.001 }, ...extra });

test('USDC holder payouts show as USDC and the rule says USDC when no SOL was paid', () => {
  const html = holderRewardsMarkup(holderRewardsSummary(token({ holderTokenPayouts:[{ asset:USDC, amountBaseUnits:'2045', payments:1, wallets:1 }] })));
  assert.match(html, /\+ 0\.002045 USDC in 1 payment to 1 wallet/);
  assert.match(html, /Paid in USDC every 5 minutes/);
});

test('unknown token assets are not shown; SOL coins keep SOL wording', () => {
  const html = holderRewardsMarkup(holderRewardsSummary(token({ holderPaidLamports:'5000', holderPayoutCount:1, holderPaidWallets:1,
    holderTokenPayouts:[{ asset:'Unknown1111111111111111111111111111111111111', amountBaseUnits:'9', payments:1, wallets:1 }] })));
  assert.doesNotMatch(html, /USDC/); assert.match(html, /Paid in SOL every 5 minutes/);
});

test('the waiting line follows the real cadence and pool minimum instead of a fixed hourly $20', () => {
  const html = holderRewardsMarkup(holderRewardsSummary(token({})));
  assert.doesNotMatch(html, /hourly once the holder pool reaches \$20/);
  assert.match(html, /Paid every 5 minutes once the holder pool reaches \$0\.001/);
});
