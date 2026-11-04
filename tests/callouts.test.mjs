import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCallers, createCalloutFeed, recordCallout, createCalloutRoutes, CALLOUT_REPEAT_MS } from '../server/routes/callouts.mjs';
import { readMint } from '../server/callout-market.mjs';
import { formatMultiple, formatCalloutCap, filterCallouts, splitCalloutColumns, calloutRowMarkup, chatCalloutBadge, timeAgo } from '../src/features/callouts/callouts.js';

const memoryStore = (callouts = []) => ({
  callouts,
  async readCallouts(limit) { return this.callouts.slice(-limit); },
  async updateCallouts(mutator) { return mutator(this.callouts); },
  async readMetadata(mint) { return { name: `Coin ${mint}`, symbol: mint.toUpperCase(), image: 'https://example.com/a.png' }; },
});
const at = iso => () => Date.parse(iso);

test('mint supply and decimals are read from the SPL mint layout', () => {
  const data = Buffer.alloc(82);
  data.writeBigUInt64LE(1_000_000_000_000_000n, 36);
  data[44] = 6;
  assert.deepEqual(readMint(data), { supply: 1_000_000_000_000_000n, decimals: 6 });
  assert.equal(readMint(Buffer.alloc(10)), null);
});

test('the feed shows newest calls first with change since the call and the peak', async () => {
  const store = memoryStore([
    { id: 'a', mint: 'm1', author: 'w1', text: 'early', createdAt: '2026-11-03T00:00:00.000Z', marketCapSol: 10, peakMarketCapSol: 50 },
    { id: 'b', mint: 'm2', author: 'w2', text: 'hidden', createdAt: '2026-11-03T00:01:00.000Z', marketCapSol: 10, hidden: true },
    { id: 'c', mint: 'm2', author: 'w2', text: 'late', createdAt: '2026-11-03T00:02:00.000Z', marketCapSol: 20, peakMarketCapSol: 20 },
  ]);
  const readFeed = createCalloutFeed({ store, readMarketCaps: async () => ({ m1: { marketCapSol: 30 }, m2: { marketCapSol: 40, graduated: true } }), now: at('2026-11-03T01:00:00.000Z') });
  const feed = await readFeed();
  assert.deepEqual(feed.callouts.map(row => row.id), ['c', 'a']);
  assert.equal(feed.callouts[0].multiple, 2);
  assert.equal(feed.callouts[0].peakMultiple, 2);
  assert.equal(feed.callouts[0].token.symbol, 'M2');
  assert.equal(feed.callouts[1].multiple, 3);
  assert.equal(feed.callouts[1].peakMultiple, 5);
  // A new high is saved so the peak survives restarts.
  assert.equal(store.callouts.find(row => row.id === 'c').peakMarketCapSol, 40);
  assert.deepEqual(feed.topCallers.map(row => row.author), ['w1', 'w2']);
});

test('callers rank by average peak gain over the last 7 days', () => {
  const nowMs = Date.parse('2026-11-10T00:00:00.000Z');
  const rows = rankCallers([
    { author: 'old', createdAt: '2026-11-01T00:00:00.000Z', peakMultiple: 100 },
    { author: 'steady', createdAt: '2026-11-09T00:00:00.000Z', peakMultiple: 3 },
    { author: 'steady', createdAt: '2026-11-09T01:00:00.000Z', peakMultiple: 1 },
    { author: 'lucky', createdAt: '2026-11-09T00:00:00.000Z', peakMultiple: 1.5 },
  ], nowMs);
  assert.deepEqual(rows.map(row => [row.author, row.calls, row.hitRate]), [['steady', 2, 0.5], ['lucky', 1, 0]]);
});

test('a wallet cannot call the same coin twice within 30 minutes, and a call needs a live market cap', async () => {
  const nowMs = Date.parse('2026-11-03T01:00:00.000Z');
  const store = memoryStore([{ id: 'a', mint: 'm1', author: 'w1', createdAt: new Date(nowMs - CALLOUT_REPEAT_MS + 1000).toISOString(), marketCapSol: 1 }]);
  const caps = async () => ({ m1: { marketCapSol: 2 }, m2: null });
  assert.equal((await recordCallout({ store, readMarketCaps: caps, mint: 'm1', author: 'w1', nowMs })).status, 429);
  assert.equal((await recordCallout({ store, readMarketCaps: caps, mint: 'm2', author: 'w1', nowMs })).status, 503);
  assert.equal((await recordCallout({ store, readMarketCaps: caps, mint: 'm1', author: 'w2', nowMs })).cap.marketCapSol, 2);
});

test('the callouts route filters by coin and by wallet', async () => {
  const feed = { callouts: [{ mint: 'm1', author: 'w1' }, { mint: 'm2', author: 'w2' }], topCallers: [], serverTime: 'now' };
  let sent;
  const handle = createCalloutRoutes({ readFeed: async () => feed, respond: (res, status, body) => { sent = { status, body }; } });
  assert.equal(await handle({ method: 'GET' }, {}, new URL('http://x/api/callouts?mint=m2')), true);
  assert.deepEqual(sent.body.callouts, [{ mint: 'm2', author: 'w2' }]);
  assert.equal(await handle({ method: 'POST' }, {}, new URL('http://x/api/callouts')), false);
});

test('callout figures read as gains, losses and caps', () => {
  assert.equal(formatMultiple(2.345), '2.3x');
  assert.equal(formatMultiple(1.234), '1.23x');
  assert.equal(formatMultiple(0.6), '-40%');
  assert.equal(formatMultiple(null), '—');
  assert.equal(formatCalloutCap(10, 200), '$2.0K');
  assert.equal(formatCalloutCap(0.3, NaN), '0.30 SOL');
  assert.equal(timeAgo('2026-11-03T00:00:00Z', Date.parse('2026-11-03T00:05:00Z')), '5m ago');
});

test('feed filters and row markup escape user text', () => {
  const rows = [{ id: '1', mint: 'm1', author: 'w1', peakMultiple: 2.5 }, { id: '2', mint: 'm2', author: 'w2', peakMultiple: 1.1 }];
  assert.deepEqual(filterCallouts(rows, { filter: 'hot' }).map(row => row.id), ['1']);
  assert.deepEqual(filterCallouts(rows, { filter: 'mine', wallet: 'w2' }).map(row => row.id), ['2']);
  assert.deepEqual(filterCallouts(rows, { filter: 'mine' }), []);
  const markup = calloutRowMarkup({ id: 'x', mint: 'Mint1', author: 'Wallet1111111111', text: '<img onerror=1>', createdAt: '2026-11-03T00:00:00Z', calledMarketCapSol: 1, currentMarketCapSol: 3, peakMultiple: 4, multiple: 3, token: { symbol: 'ABC', name: 'Abc', image: 'javascript:alert(1)' } }, { solUsd: NaN, wallet: 'Wallet1111111111' });
  assert.doesNotMatch(markup, /<img onerror/);
  assert.doesNotMatch(markup, /javascript:/);
  assert.match(markup, /data-trend="up"/);
  assert.match(markup, /<em>you<\/em>/);
  assert.match(chatCalloutBadge({ marketCapSol: 2 }, 1, NaN), /Called at 2\.00 SOL · now <b class="callout-multiple" data-trend="down">-50%/);
  assert.equal(chatCalloutBadge({}, 1, 1), '');
  assert.match(chatCalloutBadge({ marketCapSol: 2, holdingPercent: 1.5 }, 4, NaN), /holds 1\.5%/);
  assert.match(calloutRowMarkup({ id: 'y', mint: 'm', author: 'w', text: '', createdAt: '2026-11-03T00:00:00Z', holdingPercent: 0.5 }), /is-conviction[\s\S]*Holds 0\.50%/);
  const columns = splitCalloutColumns([{ id: 'a', author: 'top', holdingPercent: null }, { id: 'b', author: 'new', holdingPercent: 2 }], [{ author: 'top' }]);
  assert.deepEqual(Object.fromEntries(Object.entries(columns).map(([name, list]) => [name, list.map(row => row.id)])), { latest: ['a', 'b'], top: ['a'], conviction: ['b'] });
});

test('the feed serves the last known market cap at once while a slow read refreshes it', async () => {
  const { createCalloutMarketReader } = await import('../server/callout-market.mjs');
  const { PUMP_PROGRAM_ID } = await import('@pump-fun/pump-sdk');
  const mintData = Buffer.alloc(82); mintData.writeBigUInt64LE(1_000_000_000n, 36); mintData[44] = 0;
  let clock = 0; let reserves = 10n; let release = () => {};
  const connection = { getMultipleAccountsInfo: async keys => {
    if (clock > 0) await new Promise(resolve => { release = resolve; });
    return [{ data: mintData }, { owner: PUMP_PROGRAM_ID, data: Buffer.alloc(8) }].slice(0, keys.length);
  } };
  const read = createCalloutMarketReader({ getConnection: () => connection, now: () => clock,
    decodeCurve: () => ({ complete: false, virtualTokenReserves: 1_000_000_000n, virtualQuoteReserves: reserves * 1_000_000_000n, realTokenReserves: 0n, realQuoteReserves: 0n }) });
  const mint = '11111111111111111111111111111112';
  assert.equal((await read([mint]))[mint].marketCapSol, 10);
  clock = 60_000; reserves = 20n;
  const started = Date.now();
  assert.equal((await read([mint]))[mint].marketCapSol, 10);
  assert.ok(Date.now() - started < 500);
  const fresh = read([mint], { fresh: true, maxAgeMs: 5_000 });
  release();
  assert.equal((await fresh)[mint].marketCapSol, 20);
});

test('a chat post marked as a call saves the server-read market cap and joins the feed; deleting removes it', async () => {
  const { createTokenChatRoutes } = await import('../server/routes/token-chat.mjs');
  const { PublicKey } = await import('@solana/web3.js');
  const mint = '11111111111111111111111111111112';
  const author = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
  const chats = [];
  const store = { ...memoryStore(), chargeRpcRate: async () => true, updateCoinChat: async (_mint, mutator) => mutator(chats), readCoinChat: async () => chats };
  let input; let sent;
  const handle = createTokenChatRoutes({
    body: async () => input, walletKey: value => new PublicKey(value).toBase58(), store, clientKey: () => 'client',
    tokenChatSessions: {}, referralSession: async () => ({ wallet: author }), requireAuthorized: () => false,
    respond: (res, status, body) => { sent = { status, body }; }, readMarketCaps: async () => ({ [mint]: { marketCapSol: 12.5, observedAt: 'now' } }), readHolderShare: async () => 1.25,
  });
  const req = { method: 'POST', headers: { origin: 'http://app', host: 'app', 'x-token-chat-session': 'wallet' } };
  input = { author, text: 'early on this one', callout: true, marketCapSol: 0.0001 };
  await handle(req, {}, new URL(`http://app/api/tokens/${mint}/chat`));
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.body.message.callout, { marketCapSol: 12.5, holdingPercent: 1.25 });
  assert.equal(store.callouts.length, 1);
  assert.equal(store.callouts[0].marketCapSol, 12.5);
  assert.equal(store.callouts[0].holdingPercent, 1.25);
  input = { author, messageId: sent.body.message.id };
  await handle(req, {}, new URL(`http://app/api/tokens/${mint}/chat/delete`));
  assert.equal(sent.status, 200);
  assert.equal(store.callouts.length, 0);
});
