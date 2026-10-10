import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirdropsRoutes } from '../server/routes/airdrops.mjs';
import { createBoostRoutes } from '../server/routes/boost.mjs';
import { createReferralIdentityRoutes } from '../server/routes/referral-identity.mjs';
import { createTokenChatRoutes } from '../server/routes/token-chat.mjs';

const url = path => new URL(path, 'https://funded.vip');
const airdropHandler = options => createAirdropsRoutes(options).handle;

test('route modules leave unmatched requests for the shared router', async () => {
  for (const create of [airdropHandler, createBoostRoutes, createReferralIdentityRoutes, createTokenChatRoutes]) {
    const handle = create({ respond() { assert.fail('Unmatched request wrote a response'); } });
    assert.equal(await handle({ method: 'GET' }, {}, url('/api/health')), false);
    assert.equal(await handle({ method: 'OPTIONS' }, {}, url('/api/airdrops/claims/status')), false);
  }
});

test('authorization denial stops dispatch without calling protected services or responding twice', async () => {
  for (const [create, method, path] of [
    [airdropHandler, 'GET', '/api/airdrops/claims/status?mint=some-mint'],
    [createTokenChatRoutes, 'GET', '/api/ops/token-chat'],
    [createTokenChatRoutes, 'POST', '/api/ops/token-chat/moderate'],
  ]) {
    const responses = [];
    const respond = (_res, status, payload) => responses.push({ status, payload });
    const forbidden = () => assert.fail('Denied request reached a protected service');
    const handle = create({ respond, store: { read: forbidden, updateCoinChat: forbidden },
      body: forbidden, communityClaimService: forbidden,
      requireAuthorized(req, res) { respond(res, 401, { error: 'Unauthorized' }); return false; } });
    assert.equal(await handle({ method }, {}, url(path)), true);
    assert.deepEqual(responses, [{ status: 401, payload: { error: 'Unauthorized' } }]);
  }
});

test('airdrop proof rate limits reject before requesting chain evidence', async () => {
  const responses = [];
  const handle = airdropHandler({
    respond: (_res, status) => responses.push(status), clientKey: () => 'test-client',
    store: { chargeRpcRate: async () => false },
    communityClaimService() { assert.fail('Rate-limited proof reached the chain service'); },
  });
  assert.equal(await handle({ method: 'GET' }, {}, url('/api/airdrops/claims/proof?mint=mint&wallet=wallet')), true);
  assert.deepEqual(responses, [429]);
});

test('boost input validation handles bad mints without RPC access', async () => {
  const responses = [];
  const handle = createBoostRoutes({ store: { read: async () => ({ boostReceipts: {} }) },
    respond: (_res, status) => responses.push(status) });
  assert.equal(await handle({ method: 'GET' }, {}, url('/api/boosts?mint=invalid')), true);
  assert.deepEqual(responses, [400]);
});

test('referral session response keeps its no-store header and authentication state', async () => {
  const headers = {}, responses = [];
  const handle = createReferralIdentityRoutes({ referralSession: async () => ({ wallet: 'test-wallet' }),
    respond: (_res, status, payload) => responses.push({ status, payload }) });
  assert.equal(await handle({ method: 'GET' }, { setHeader: (key, value) => { headers[key] = value; } }, url('/api/referrals/session')), true);
  assert.equal(headers['cache-control'], 'no-store');
  assert.deepEqual(responses, [{ status: 200, payload: { authenticated: true, wallet: 'test-wallet' } }]);
});

test('registration reuses only a same-origin session for the challenge wallet', async () => {
  const wallet = '11111111111111111111111111111111';
  const state = { referrals: { challenges: {}, wallets: {}, codes: {} } };
  const responses = [];
  let sessionWallet = null;
  const handle = createReferralIdentityRoutes({
    body: async req => req.payload,
    walletKey: value => value,
    referralSession: async () => sessionWallet && { wallet: sessionWallet },
    referralChallengeStatement: () => 'fixture challenge',
    referralCodeFromBytes: () => 'ABCDEF',
    id: () => 'challenge-1',
    store: { read: async () => state, update: async mutate => mutate(state) },
    respond: (_res, status, payload) => responses.push({ status, payload }),
  });
  const request = (pathname, payload, origin = 'https://funded.vip') => handle({
    method: 'POST', payload, headers: { host: 'funded.vip', origin }, socket: { encrypted: true },
  }, {}, url(pathname));
  await request('/api/referrals/registration/prepare', { wallet });
  const proof = { challengeId: 'challenge-1', wallet, useWalletSession: true };
  await request('/api/referrals/registration/verify', proof);
  assert.equal(responses.at(-1).status, 401);
  sessionWallet = wallet;
  await request('/api/referrals/registration/verify', proof, 'https://other.example');
  assert.equal(responses.at(-1).status, 403);
  await request('/api/referrals/registration/verify', proof);
  assert.equal(responses.at(-1).status, 200);
  assert.equal(state.referrals.wallets[wallet].code, 'ABCDEF');
  assert.equal(state.referrals.challenges['challenge-1'].status, 'verified');
});

test('chat accepts the shared wallet session only for its author and app origin', async () => {
  const wallet = '11111111111111111111111111111111';
  const mint = 'So11111111111111111111111111111111111111112';
  const messages = [], responses = [];
  let sessionWallet = null;
  const handle = createTokenChatRoutes({
    body: async req => req.payload,
    walletKey: value => value,
    referralSession: async () => sessionWallet && { wallet: sessionWallet },
    tokenChatSessions: { address: async () => assert.fail('Legacy session lookup must not run') },
    store: {
      chargeRpcRate: async () => true,
      updateCoinChat: async (_mint, mutate) => mutate(messages),
    },
    respond: (_res, status, payload) => responses.push({ status, payload }),
  });
  const request = (origin, author = wallet) => handle({ method: 'POST',
    headers: { host: 'funded.vip', origin, 'x-token-chat-session': 'wallet' },
    socket: { encrypted: true }, payload: { author, text: 'A test discussion message' },
  }, {}, url(`/api/tokens/${mint}/chat`));
  await request('https://funded.vip');
  assert.equal(responses.at(-1).status, 401);
  sessionWallet = wallet;
  await request('https://other.example');
  assert.equal(responses.at(-1).status, 403);
  await request('https://funded.vip', mint);
  assert.equal(responses.at(-1).status, 401);
  await request('https://funded.vip');
  assert.equal(responses.at(-1).status, 201);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].author, wallet);
});
