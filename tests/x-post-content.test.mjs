import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { buildXPost, formatXSol, sanitizeXLabel, xWeightedLength } from '../server/x-post-content.mjs';

const mint = new PublicKey(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toBase58();
const recipient = new PublicKey(Uint8Array.from({ length: 32 }, (_, index) => index + 2)).toBase58();
const sig = value => bs58.encode(Uint8Array.from({ length: 64 }, (_, index) => (index + value) % 256));
const proof = (value = 1, cluster = 'devnet') => ({ signature: sig(value), slot: 100 + value, cluster, verified: true, commitment: 'finalized' });
const options = { cluster: 'devnet', publicOrigin: 'https://funded.vip' };
const base = () => ({ mint, name: 'Example token', marketingTier: 'pro', proofs: [proof()] });
const window = { windowStart: '2026-10-03T00:00:00.000Z', windowEnd: '2026-10-04T00:00:00.000Z', coverage: 'complete' };
const payment = (overrides = {}) => ({ id: 'payout-1', recipient, signature: sig(1), asset: 'SOL', amountLamports: '1000000001', status: 'paid', finalized: true, balanceDeltaVerified: true, ...overrides });

test('launch and paid listing copy remain distinct and explicitly label Devnet', () => {
  const launch = buildXPost('launch', base(), options);
  const listing = buildXPost('listing', { ...base(), listingType: 'paid' }, options);
  assert.match(launch.text, /^\[Devnet test\] Pro launch:/);
  assert.match(listing.text, /^\[Devnet test\] Paid listing added:/);
  assert.doesNotMatch(listing.text, /launch/);
  assert.match(launch.text, new RegExp(`https://funded.vip/token/${mint}$`));
  assert.equal(launch.kind, 'launch'); assert.equal(launch.cluster, 'devnet');
  assert.equal(launch.weightedLength, xWeightedLength(launch.text));
  assert.throws(() => buildXPost('listing', base(), options), /paid listing/);
});

test('Standard, Pro, and Premier launch copy have distinct packages', () => {
  const standard = buildXPost('launch', { ...base(), marketingTier: 'standard' }, options);
  const pro = buildXPost('launch', base(), options);
  const premier = buildXPost('launch', { ...base(), marketingTier: 'premier' }, options);
  const followup = buildXPost('launch_followup', { ...base(), marketingTier: 'premier' }, options);
  assert.match(standard.text, /New project on funded\.vip:/);
  assert.doesNotMatch(standard.text, /\$FUNDED tier burn/);
  assert.match(pro.text, /Pro launch:/);
  assert.match(premier.text, /Premier launch:/);
  assert.match(followup.text, /Premier project follow-up:/);
  assert.notEqual(premier.text, followup.text);
  assert.throws(() => buildXPost('launch_followup', base(), options), /Premier/);
  assert.throws(() => buildXPost('launch', { ...base(), marketingTier: 'boost' }, options), /verified marketing tier/);
});

test('project labels cannot inject mentions, hashtags, URLs, newlines or directional controls', () => {
  const malicious = '@johntrand83\n#BuyNow\u202e https://evil.example/path\u0000ＦＵＬＬ＃＠';
  const post = buildXPost('launch', { ...base(), name: malicious }, options);
  assert.doesNotMatch(post.text, /@|#|evil\.example|\u202e|\u0000/);
  assert.equal(post.text.split('\n').length, 2);
  assert.equal((post.text.match(/https:\/\//g) || []).length, 1);
  assert.equal(sanitizeXLabel('全'.repeat(200), 16), '全'.repeat(8));
});

test('Unicode-heavy labels and long trusted URLs stay within conservative X weight', () => {
  assert.equal(xWeightedLength('abc界😀'), 7);
  assert.equal(xWeightedLength('https://funded.vip/token/' + 'a'.repeat(100)), 23);
  const projects = [1, 2, 3].map(value => ({ mint: new PublicKey(Uint8Array.from({ length: 32 }, (_, index) => index + value)).toBase58(), name: '界'.repeat(1000), amountLamports: String(value * 1e9) }));
  const post = buildXPost('daily_projects', { ...window, proofs: [proof()], metric: 'volume_lamports', projects }, options);
  assert(post.weightedLength <= 280);
  assert(Buffer.byteLength(post.text) <= 280);
  assert.match(post.text, /finalized trading volume \(SOL\)/);
  assert.match(post.text, /2026-10-03 00:00 to 2026-10-04 00:00 UTC/);
  assert.doesNotMatch(post.text, /best|buy|investment|guaranteed/i);
});

test('missing, unverified, unfinalized, wrong-cluster and malformed proofs fail closed', () => {
  for (const proofs of [[], [{ ...proof(), verified: false }], [{ ...proof(), commitment: 'confirmed' }], [proof(1, 'mainnet-beta')], [{ ...proof(), slot: 0 }], [{ ...proof(), signature: 'x'.repeat(88) }]]) {
    assert.throws(() => buildXPost('launch', { ...base(), proofs }, options), /proof/i);
  }
  assert.throws(() => buildXPost('launch', { ...base(), proofs: [proof(), { ...proof(), slot: 200 }] }, options), /Conflicting/);
});

test('public URLs come only from a configured HTTPS origin and a valid mint', () => {
  for (const publicOrigin of ['http://funded.vip', 'javascript:alert(1)', 'https://funded.vip/path', 'https://user:password@funded.vip', 'https://funded.vip?next=evil']) {
    assert.throws(() => buildXPost('launch', base(), { ...options, publicOrigin }), /origin/i);
  }
  assert.throws(() => buildXPost('launch', { ...base(), mint: '../redirect' }, options), /valid Solana/);
  const post = buildXPost('launch', { ...base(), url: 'https://evil.example' }, options);
  assert.doesNotMatch(post.text, /evil/);
});

test('profit is exact realized net SOL after all fees with a default one-SOL minimum', () => {
  const payload = { ...base(), proofs: [proof(1), proof(2)], positionClosed: true, completeCostBasis: true, publicConsent: true,
    buyCostLamports: '9007199254740993', sellProceedsLamports: '9007200254740994', feesLamports: '1' };
  const post = buildXPost('trade_profit', payload, options);
  assert.match(post.text, /Realized net profit: 1 SOL after fees/);
  assert.doesNotMatch(post.text, /%|will|potential|unrealized|guaranteed/);
  for (const changes of [{ positionClosed: false }, { completeCostBasis: false }, { publicConsent: false }, { proofs: [proof()] },
    { sellProceedsLamports: '9007200254740993' }, { feesLamports: 0.1 }, { buyCostLamports: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => buildXPost('trade_profit', { ...payload, ...changes }, options));
  }
  assert.equal(formatXSol('9007199254740993'), '9007199.254740993');
  assert.equal(formatXSol('1'), '0.000000001');
  assert.equal(formatXSol('1000000000'), '1');
});

test('daily project ranking uses exact descending base units and an explicit metric', () => {
  const payload = { ...window, proofs: [proof()], metric: 'creator_fees_collected_lamports', projects: [
    { mint, name: 'Small', amountLamports: '9007199254740992' },
    { mint: recipient, name: 'Large', amountLamports: '9007199254740993' },
  ] };
  const post = buildXPost('daily_projects', payload, options);
  assert.match(post.text, /creator fees collected/);
  assert.match(post.text, /1\. Large: 9007199\.254740993/);
  assert.match(post.text, /2\. Small: 9007199\.254740992/);
  for (const changes of [{ metric: 'price_percent' }, { coverage: 'partial' }, { windowEnd: '2026-10-05T00:00:00Z' }, { projects: [payload.projects[0], payload.projects[0]] }]) {
    assert.throws(() => buildXPost('daily_projects', { ...payload, ...changes }, options));
  }
});

test('daily reward totals count only verified paid transfers with exact precision', () => {
  const payload = { ...window, proofs: [proof()], payments: [payment()] };
  const post = buildXPost('daily_rewards', payload, options);
  assert.match(post.text, /Rewards paid: 1\.000000001 SOL across 1 verified payment/);
  for (const changes of [{ status: 'allocated' }, { finalized: false }, { balanceDeltaVerified: false }, { signature: sig(2) }, { asset: mint }, { amountLamports: '1.01' }]) {
    assert.throws(() => buildXPost('daily_rewards', { ...payload, payments: [payment(changes)] }, options));
  }
  assert.throws(() => buildXPost('daily_rewards', { ...payload, coverage: 'partial' }, options), /complete/);
  assert.throws(() => buildXPost('daily_rewards', { ...payload, payments: [payment(), payment({ id: 'another-id' })] }, options), /counted twice/);
});

test('large finalized proof sets retain a deterministic complete-set commitment under outbox limits', () => {
  const proofs = Array.from({ length: 100 }, (_, index) => proof(index + 1));
  const post = buildXPost('launch', { ...base(), proofs }, options);
  const reversed = buildXPost('launch', { ...base(), proofs: [...proofs].reverse() }, options);
  assert.equal(post.proofs[0].kind, 'finalized-proof-set');
  assert.equal(post.proofs[0].count, 100);
  assert.equal(post.proofs[0].sha256, reversed.proofs[0].sha256);
  assert(Buffer.byteLength(JSON.stringify(post.proofs)) <= 16_384);
});

test('mainnet text is separately labeled and unknown networks/kinds are rejected', () => {
  assert.match(buildXPost('launch', { ...base(), proofs: [proof(1, 'mainnet-beta')] }, { ...options, cluster: 'mainnet-beta' }).text, /^\[Mainnet\]/);
  assert.throws(() => buildXPost('launch', base(), { ...options, cluster: 'testnet' }), /cluster/);
  assert.throws(() => buildXPost('advice', base(), options), /kind/);
});


test('paid reward rankings state the exact metric and obey publisher byte limits', () => {
  const post = buildXPost('daily_projects', { ...window, proofs: [proof()], metric: 'paid_rewards_lamports', projects: [
    { mint, name: '🔴'.repeat(50) + '漢'.repeat(50), amountLamports: '123456789123456' },
    { mint: recipient, name: 'é'.repeat(100), amountLamports: '23456789123456' },
  ] }, { ...options, publicOrigin: 'https://public-funded-development.example.com' });
  assert.match(post.text, /verified rewards paid/);
  assert.equal(post.byteLength, Buffer.byteLength(post.text));
  assert(post.byteLength <= 280 && post.weightedLength <= 280);
  assert.throws(() => buildXPost('launch', base(), { ...options, publicOrigin: `https://${'a'.repeat(250)}.example` }), /length limit/);
});


test('daily paid-reward summary includes the largest exact verified payment', () => {
  const post = buildXPost('daily_rewards', { ...window, scope: 'recorded-verified-payouts', proofs: [proof(1), proof(2)], payments: [
    payment(), payment({ id: 'payout-2', signature: sig(2), amountLamports: '9007199254740993' }),
  ] }, options);
  assert.match(post.text, /Recorded rewards paid: 9007200\.254740994 SOL/);
  assert.match(post.text, /Largest payment: 9007199\.254740993 SOL/);
  assert(post.byteLength <= 280);
});


test('daily window validation rejects ambiguous or normalized invalid dates', () => {
  for (const bad of ['2026-02-30T00:00:00Z', '2026-10-03', '2026-10-03T00:00:00', '2026-10-03T00:00:01Z']) {
    assert.throws(() => buildXPost('daily_rewards', { ...window, windowStart: bad, proofs: [proof()], payments: [payment()] }, options));
  }
});
