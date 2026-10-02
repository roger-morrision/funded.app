import assert from 'node:assert/strict';
import test from 'node:test';
import { channelShareUrl, drawEarningsCard, drawRoundTripCard, drawTradeCard, taggedShareUrl } from '../share-tools.js';
import { tokenPageHtml } from '../server/token-social.mjs';

const coinUrl = 'https://funded.vip/token/9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w?ref=FND-12345678';

test('channel tagging preserves token and referral attribution', () => {
  const tagged = new URL(taggedShareUrl(coinUrl, 'telegram'));
  assert.equal(tagged.pathname, '/token/9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w');
  assert.equal(tagged.searchParams.get('ref'), 'FND-12345678');
  assert.equal(tagged.searchParams.get('src'), 'telegram');
  assert.equal(new URL(taggedShareUrl(tagged.toString(), 'x')).searchParams.getAll('src').length, 1);
  assert.throws(() => taggedShareUrl('javascript:alert(1)'), /web link/);
});

test('channel composer URLs encode user copy and tagged destination', () => {
  const message = 'New coin & community';
  for (const channel of ['x', 'telegram', 'whatsapp', 'facebook', 'linkedin', 'reddit']) {
    const tagged = taggedShareUrl(coinUrl, channel);
    const destination = new URL(channelShareUrl(channel, tagged, message));
    assert.equal(destination.protocol, 'https:');
    assert.ok(decodeURIComponent(destination.toString()).includes('src='), channel);
  }
  assert.throws(() => channelShareUrl('unknown', coinUrl, message), /Unsupported/);
});

test('earnings card refuses unverified or unpaid numbers', () => {
  const canvas = { getContext: () => { throw new Error('Should not draw'); } };
  assert.throws(() => drawEarningsCard(canvas, { verified: false, amount: 5, receipt: 'sig' }), /verified paid receipt/);
  assert.throws(() => drawEarningsCard(canvas, { verified: true, amount: 5 }), /verified paid receipt/);
  assert.throws(() => drawEarningsCard(canvas, { verified: true, amount: 0, receipt: 'sig' }), /verified paid receipt/);
});

test('trade card refuses an unverified receipt or unsupported trade direction', () => {
  const canvas = { getContext: () => { throw new Error('Should not draw'); } };
  assert.throws(() => drawTradeCard(canvas, { verified:false, side:'buy', receipt:'sig', mint:'mint' }), /verified trade receipt/);
  assert.throws(() => drawTradeCard(canvas, { verified:true, side:'hold', receipt:'sig', mint:'mint' }), /verified trade receipt/);
});

test('closed-trade card requires positive amount and complete account history', () => {
  const canvas = { getContext: () => { throw new Error('Should not draw'); } };
  const proof = { verified:true, accountHistoryVerified:true, buyReceipt:'buy', receipt:'sell', mint:'mint', netLamports:'1' };
  assert.throws(() => drawRoundTripCard(canvas, { ...proof, accountHistoryVerified:false }), /closed-position proof/);
  assert.throws(() => drawRoundTripCard(canvas, { ...proof, netLamports:'0' }), /closed-position proof/);
  assert.throws(() => drawRoundTripCard(canvas, { ...proof, buyReceipt:'' }), /closed-position proof/);
});

test('verified token preview replaces generic invite preview', () => {
  const shell = '<head><meta name="description" content="generic" />\n<meta property="og:type" content="website" />\n<meta property="og:title" content="generic" />\n<meta property="og:description" content="generic" />\n<meta name="twitter:card" content="summary" />\n<title>generic</title></head>';
  const mint = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';
  const output = tokenPageHtml(shell, { mint, cluster:'devnet', onchainVerified:true, policySignature:'sig', name:'Audit Coin', symbol:'AUDIT' }, null, mint, 'devnet', 'https://funded.vip');
  assert.equal((output.match(/property="og:title"/g) || []).length, 1);
  assert.match(output, /og:title" content="Audit Coin/);
  assert.doesNotMatch(output, /og:title" content="generic"/);
});

test('social preview keeps safe receipt and referral parameters in the share URL', () => {
  const shell = '<head><meta name="description" content="generic" /><title>generic</title></head>';
  const mint = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';
  const launch = { mint, cluster:'devnet', onchainVerified:true, policySignature:'sig', name:'Audit Coin', symbol:'AUDIT' };
  const receipt = '1'.repeat(64);
  const html = tokenPageHtml(shell, launch, null, mint, 'devnet', 'https://funded.vip', `?ref=FND-12345678&src=x&buy=${receipt}&sell=${receipt}&evil=<script>`);
  assert.match(html, /property="og:url" content="[^"]*buy=1111/);
  assert.match(html, /property="og:url" content="[^"]*ref=FND-12345678/);
  assert.doesNotMatch(html, /evil=/);
  assert.match(html, /rel="canonical" href="https:\/\/funded.vip\/token\//);
});
