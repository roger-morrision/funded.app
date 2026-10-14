import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createAdminRoutes, publicFeePolicy } from '../server/routes/admin.mjs';
import { activeProtocolFeeSplit, launchProtocolFeeSplit } from '../server/active-protocol-fee.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';

test('admin wallet signature gates policy edits, inventory, and exact finalized withdrawal receipts', async () => {
  const admin = Keypair.generate(), keeper = Keypair.generate();
  const address = key => key.publicKey.toBase58();
  const state = { adminSettings:{}, adminAudit:{}, collections:{}, v3Settlements:{}, launches:{} };
  const store = { async read() { return structuredClone(state); },
    async update(mutator) { return mutator(state); } };
  const env = { PUBLIC_APP_URL:'https://funded.vip', FUNDED_ADMIN_WALLETS:address(admin),
    FUNDED_ADMIN_WITHDRAW_DESTINATIONS:address(admin), FUNDED_V3_LAUNCH_ENABLED:'true' };
  let input, output, cookie = '';
  const respond = (res, status, value) => { output = { status, value, cookie:res.cookie || null }; };
  const blockhash = Keypair.generate().publicKey.toBase58();
  let parsed = null;
  const connectionFactory = () => ({
    getGenesisHash:async () => DEVNET_GENESIS_HASH,
    getBalance:async () => 2_000_000_000,
    getLatestBlockhash:async () => ({ blockhash, lastValidBlockHeight:123 }),
    getParsedTransaction:async () => parsed,
  });
  const handle = createAdminRoutes({ store, body:async () => input, respond, solanaCluster:'devnet',
    solanaRpcUrl:'https://api.devnet.solana.com', keeperKeypair:() => keeper,
    referralPayoutKeypair:() => null, v3AuthorityKeypair:() => null,
    env, connectionFactory });
  const call = async (method, path, value, headers = {}) => {
    input = value; output = null;
    const req = { method, headers:{ origin:'https://funded.vip', cookie, ...headers }, socket:{ remoteAddress:'127.0.0.1' } };
    const res = { setHeader(name, value) { if (name === 'set-cookie') this.cookie = value; } };
    await handle(req, res, new URL(path, 'https://funded.vip'));
    return output;
  };
  assert.equal((await call('GET', '/api/admin/overview')).status, 401);
  assert.equal((await call('POST', '/api/admin/challenge', { wallet:address(admin) }, { origin:'https://evil.example' })).status, 403);
  const challenge = await call('POST', '/api/admin/challenge', { wallet:address(admin) });
  assert.equal(challenge.status, 200);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.value.message), admin.secretKey));
  assert.equal((await call('POST', '/api/admin/session', { wallet:address(admin), nonce:challenge.value.nonce, signature:'bad' })).status, 401);
  const fresh = await call('POST', '/api/admin/challenge', { wallet:address(admin) });
  const signed = bs58.encode(nacl.sign.detached(new TextEncoder().encode(fresh.value.message), admin.secretKey));
  const signedIn = await call('POST', '/api/admin/session', { wallet:address(admin), nonce:fresh.value.nonce, signature:signed });
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.cookie, /HttpOnly; SameSite=Strict/);
  cookie = signedIn.cookie.split(';')[0];
  const overview = await call('GET', '/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.value.wallets[0].address, address(keeper));
  assert.equal(overview.value.wallets[0].lamports, '2000000000');
  const changed = { operationsPercent:40, referralLevelPercents:[15, 5, 5], communityPercent:10, buybackPercent:25 };
  assert.equal((await call('POST', '/api/admin/fee-policy', { split:{ ...changed, buybackPercent:26 }, expectedRevision:0 })).status, 400);
  const saved = await call('POST', '/api/admin/fee-policy', { split:changed, expectedRevision:0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.revision, 1);
  assert.deepEqual(await activeProtocolFeeSplit(store), changed);
  assert.deepEqual((await publicFeePolicy(store)).split, changed);
  assert.equal((await call('POST', '/api/admin/fee-policy', { split:changed, expectedRevision:0 })).status, 409);
  const oldLaunch = { pumpFeeRoute:{ protocolSplit:PROTOCOL_FEE_SPLIT } };
  assert.deepEqual(launchProtocolFeeSplit(oldLaunch), PROTOCOL_FEE_SPLIT);
  const prepared = await call('POST', '/api/admin/withdrawals/prepare', {
    source:address(keeper), destination:address(admin), amountLamports:1_000_000 });
  assert.equal(prepared.status, 200);
  assert.equal((await call('POST', '/api/admin/withdrawals/prepare', {
    source:address(keeper), destination:address(Keypair.generate()), amountLamports:1_000_000 })).status, 400);
  const txSignature = bs58.encode(Uint8Array.from({ length:64 }, (_, index) => index + 1));
  parsed = { slot:55, meta:{ err:null, fee:5000, preBalances:[2_000_000_000, 1_000_000_000],
    postBalances:[1_998_995_000, 1_001_000_000] }, transaction:{ message:{ recentBlockhash:blockhash,
    accountKeys:[{ pubkey:new PublicKey(address(keeper)) }, { pubkey:new PublicKey(address(admin)) }],
    instructions:[{ program:'system', parsed:{ type:'transfer', info:{ source:address(keeper), destination:address(admin), lamports:1_000_000 } } }] } } };
  const verified = await call('POST', '/api/admin/withdrawals/verify', { id:prepared.value.id, signature:txSignature });
  assert.equal(verified.status, 200);
  assert.equal(verified.value.balanceDeltaVerified, true);
  assert.equal(state.adminAudit[`withdraw:${txSignature}`].amountLamports, '1000000');
  assert.equal((await call('POST', '/api/admin/withdrawals/verify', { id:prepared.value.id, signature:txSignature })).status, 409);
});
