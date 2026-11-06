import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTechnicalText, plainWording, isQuietDataGap } from '../src/features/experience/technical-notices.js';

test('technical status lines are grouped for the notice and explanatory copy stays on the page', () => {
  assert.equal(classifyTechnicalText('Solana RPC rate limited · retry shortly'), 'network');
  assert.equal(classifyTechnicalText('Eligible vault or trigger verification unavailable or incomplete'), 'verification');
  assert.equal(classifyTechnicalText('Latest 5 of 18 finalized payments · partial coverage'), 'verification');
  assert.equal(classifyTechnicalText('Trade failed: insufficient SOL balance'), 'error');
  for (const copy of ['Three leaderboards. Top 3 in each. One snapshot every UTC day.',
    'Permanent and irreversible after on-chain confirmation.', 'Finalized payments · SOL', 'Unavailable', ''])
    assert.equal(classifyTechnicalText(copy), null);
});

test('display wording replaces protocol jargon without touching other text', () => {
  assert.equal(plainWording('6 finalized V3 settlements · checked 06:35 UTC'), '6 confirmed settlements · checked 06:35 UTC');
  assert.equal(plainWording('The keeper collects verified fees into the coin’s V3 router.'), 'The automation collects verified fees into the coin’s fee router.');
  assert.equal(plainWording('34/41 finalized payouts indexed'), '34/41 confirmed payouts recorded');
  assert.equal(plainWording('Budgets are timestamped finalized worker snapshots.'), 'Budgets are timestamped confirmed automation snapshots.');
  assert.equal(plainWording('Daily bonus · SOL'), 'Daily bonus · SOL');
});

test('short value cells such as "Unavailable" are treated as status, short copy lines are not', () => {
  assert.equal(classifyTechnicalText('Unavailable', { valueCell:true }), 'verification');
  assert.equal(classifyTechnicalText('Unavailable'), null);
});

test('RPC wording reads as the Solana network', () => {
  assert.equal(plainWording('Checked against Solana RPC'), 'Checked against Solana network');
  assert.equal(plainWording('RPC only'), 'network only');
});

test('devnet wording is removed from page copy', () => {
  assert.equal(plainWording('0.0005 SOL from collected creator fees · finalized on Devnet'), '0.0005 SOL from collected creator fees · confirmed');
  assert.equal(plainWording('Top 3. Every 5 minutes · Devnet QA.'), 'Top 3. Every 5 minutes.');
  assert.equal(plainWording('Pump · Solana Devnet'), 'Pump · Solana');
  assert.equal(plainWording('Devnet preview'), 'preview');
});

test('quiet missing values never erase financial recovery or save outcomes', () => {
  for(const message of ['Unavailable','Price unavailable','Unverified'])assert.equal(isQuietDataGap(message),true,message);
  for(const message of [
    'Further payouts are blocked: verification incomplete. Reconcile the existing receipt.',
    'A recorded transaction is preserved while verification is unavailable.',
    'Your change could not be saved. Please try again.',
    'Payment history is unavailable. Check the existing receipt before retrying.',
    'Claim verification pending. Do not submit another claim.',
    'Your message was posted, but no call was recorded because holdings are unavailable.',
  ])assert.equal(isQuietDataGap(message),false,message);
});
