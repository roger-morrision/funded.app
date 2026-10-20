import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { createAdminRoutes, publicFeePolicy } from '../server/routes/admin.mjs';
import { activeProtocolFeeSplit, launchProtocolFeeSplit } from '../server/active-protocol-fee.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { deriveCommunityRewardVaultV3, deriveMintPolicyV3, deriveMintVaultsV3, protocolGrossUnits } from '../mint-router-v3.js';
import { rewardReserveAddress } from '../server/automatic-reward-chain.mjs';
import { SOL_ASSET_MINT } from '../reward-merkle.js';

test('admin wallet signature gates policy edits, inventory, and exact finalized withdrawal receipts', async () => {
  const admin = Keypair.generate(), keeper = Keypair.generate(), treasury = Keypair.generate(), operationsWallet = Keypair.generate();
  const address = key => key.publicKey.toBase58();
  const state = { adminSettings:{}, adminAudit:{}, collections:{}, v3Settlements:{}, launches:{} };
  const store = { async read() { return structuredClone(state); },
    async update(mutator) { return mutator(state); } };
  const env = { PUBLIC_APP_URL:'https://funded.vip', FUNDED_ADMIN_WALLETS:address(admin),
    FUNDED_ADMIN_WITHDRAW_DESTINATIONS:address(admin), FUNDED_PUMP_REVENUE_WALLET:address(treasury),
    FUNDED_V3_OPERATIONS_RECIPIENT:address(operationsWallet), FUNDED_V3_LAUNCH_ENABLED:'true' };
  let input, output, cookie = '';
  const respond = (res, status, value) => { output = { status, value, cookie:res.cookie || null }; };
  const blockhash = Keypair.generate().publicKey.toBase58();
  let parsed = null, sourceBalance = 2_000_000_000, networkFee = 5000;
  let policyAddress = null, policyAccount = null, vaultAddress = null, vaultAccount = null;
  let reserveAddress = null, reserveAccount = null;
  const connectionFactory = () => ({
    getGenesisHash:async () => DEVNET_GENESIS_HASH,
    getBalance:async () => sourceBalance,
    getLatestBlockhash:async () => ({ blockhash, lastValidBlockHeight:123 }),
    getFeeForMessage:async () => ({value:networkFee}),
    getParsedTransaction:async () => parsed,
    getAccountInfo:async address => address.equals(policyAddress) ? policyAccount : null,
    getMultipleAccountsInfo:async addresses => addresses.map(address => address.equals(vaultAddress) ? vaultAccount
      : address.equals(reserveAddress) ? reserveAccount : null),
    getMinimumBalanceForRentExemption:async size => size === 81 ? 1_500_000 : 890_880,
  });
  const operations = [];
  const dailyBonusRuntime = { async operate(action, value, actor) {
    operations.push({action,value,actor});
    if (value?.day === 'invalid') throw new Error('Invalid UTC day.');
    return {status:'reviewed',day:value.day};
  } };
  const handle = createAdminRoutes({ store, body:async () => input, respond, solanaCluster:'devnet', dailyBonusRuntime,
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
  assert.equal((await call('GET','/api/admin/x-posts')).status,401);
  assert.equal((await call('POST','/api/admin/x-posts/review',{})).status,401);
  assert.equal((await call('POST','/api/admin/agency-fee-policy',{})).status,401);
  assert.equal((await call('POST','/api/admin/agency-fee-policy',{}, {origin:'https://evil.example'})).status,403);
  assert.equal((await call('POST','/api/admin/daily-bonus/reconcile',{})).status,401);
  assert.equal(operations.length,0);
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
  const review = {day:'2026-10-17',expectedHash:'a'.repeat(64),expectedNewHash:'b'.repeat(64),reason:'Verified missing source evidence.',actor:'forged'};
  assert.equal((await call('POST','/api/admin/daily-bonus/review',review,{origin:'https://evil.example'})).status,403);
  assert.equal(operations.length,0);
  assert.equal((await call('POST','/api/admin/daily-bonus/review',review)).status,200);
  assert.equal(operations[0].actor,address(admin));
  assert.equal((await call('POST','/api/admin/daily-bonus/reconcile',review)).status,200);
  assert.equal(state.adminAudit[`daily-bonus:${review.day}:${review.expectedNewHash}`].wallet,address(admin));
  assert.equal((await call('POST','/api/admin/daily-bonus/review',{day:'invalid'})).status,409);
  const overview = await call('GET', '/api/admin/overview');
  assert.equal(overview.status, 200);
  assert(overview.value.wallets.some(row=>row.role==='V3 Operations & marketing'&&row.address===address(operationsWallet)&&row.balanceStatus==='finalized'));
  assert.equal(overview.value.wallets[0].address, address(keeper));
  assert.equal(overview.value.wallets[0].lamports, '2000000000');
  assert.equal(overview.value.wallets[0].withdrawable, false);
  assert.equal(overview.value.wallets.find(row => row.address === address(treasury)).withdrawable, true);
  const changed = { operationsPercent:40, referralLevelPercents:[15, 5, 5], communityPercent:10, buybackPercent:25 };
  assert.equal((await call('POST', '/api/admin/fee-policy', {split:{...changed,operationsPercent:30,agencyPercent:10},expectedRevision:0})).status,409);
  assert.equal(state.adminSettings?.protocolFeePolicy,undefined);
  assert.equal((await call('POST', '/api/admin/fee-policy', { split:{ ...changed, buybackPercent:26 }, expectedRevision:0 })).status, 400);
  const saved = await call('POST', '/api/admin/fee-policy', { split:changed, expectedRevision:0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.revision, 1);
  assert.deepEqual(await activeProtocolFeeSplit(store), changed);
  assert.deepEqual((await publicFeePolicy(store)).split, changed);
  assert.equal((await call('POST', '/api/admin/fee-policy', { split:changed, expectedRevision:0 })).status, 409);
  const oldLaunch = { pumpFeeRoute:{ protocolSplit:PROTOCOL_FEE_SPLIT } };
  assert.deepEqual(launchProtocolFeeSplit(oldLaunch), PROTOCOL_FEE_SPLIT);
  assert.equal((await call('POST', '/api/admin/withdrawals/prepare', {
    source:address(keeper), destination:address(admin), amountLamports:1_000_000 })).status, 400);
  sourceBalance = 21_004_999;
  assert.equal((await call('POST', '/api/admin/withdrawals/prepare', {
    source:address(treasury), destination:address(admin), amountLamports:1_000_000 })).status,409,
  'The network fee must not reduce the retained reserve below 0.02 SOL.');
  sourceBalance = 21_005_000;
  const boundary = await call('POST', '/api/admin/withdrawals/prepare', {
    source:address(treasury), destination:address(admin), amountLamports:1_000_000 });
  assert.equal(boundary.status,200);assert.equal(boundary.value.estimatedFeeLamports,5000);
  networkFee = null;
  assert.equal((await call('POST', '/api/admin/withdrawals/prepare', {
    source:address(treasury), destination:address(admin), amountLamports:1_000_000 })).status,503);
  networkFee = 5000;sourceBalance = 2_000_000_000;
  const prepared = await call('POST', '/api/admin/withdrawals/prepare', {
    source:address(treasury), destination:address(admin), amountLamports:1_000_000 });
  assert.equal(prepared.status, 200);
  assert.equal((await call('POST', '/api/admin/withdrawals/prepare', {
    source:address(treasury), destination:address(Keypair.generate()), amountLamports:1_000_000 })).status, 400);
  const txSignature = bs58.encode(Uint8Array.from({ length:64 }, (_, index) => index + 1));
  parsed = { slot:55, meta:{ err:null, fee:5000, preBalances:[2_000_000_000, 1_000_000_000],
    postBalances:[1_998_995_000, 1_001_000_000] }, transaction:{ message:{ recentBlockhash:blockhash,
    accountKeys:[{ pubkey:new PublicKey(address(treasury)) }, { pubkey:new PublicKey(address(admin)) }],
    instructions:[{ program:'system', parsed:{ type:'transfer', info:{ source:address(treasury), destination:address(admin), lamports:1_000_000 } } }] } } };
  const verified = await call('POST', '/api/admin/withdrawals/verify', { id:prepared.value.id, signature:txSignature });
  assert.equal(verified.status, 200);
  assert.equal(verified.value.balanceDeltaVerified, true);
  assert.equal(state.adminAudit[`withdraw:${txSignature}`].amountLamports, '1000000');
  assert.equal((await call('POST', '/api/admin/withdrawals/verify', { id:prepared.value.id, signature:txSignature })).status, 409);
  const idempotent = await call('POST', '/api/admin/withdrawals/reconcile', { signature:txSignature });
  assert.equal(idempotent.status, 200);
  assert.equal(idempotent.value.action, 'wallet-withdrawal');
  delete state.adminAudit[`withdraw:${txSignature}`];
  const recovered = await call('POST', '/api/admin/withdrawals/reconcile', { signature:txSignature });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.value.action, 'wallet-withdrawal-reconciled');
  assert.equal(recovered.value.initiatedByAdmin, 'unverified');
  parsed.transaction.message.instructions[0].parsed.info.destination = address(Keypair.generate());
  assert.equal((await call('POST', '/api/admin/withdrawals/reconcile', { signature:txSignature })).status, 409);
  parsed.transaction.message.instructions[0].parsed.info.destination = address(admin);
  parsed.transaction.message.accountKeys[0].pubkey = keeper.publicKey;
  parsed.transaction.message.instructions[0].parsed.info.source = address(keeper);
  assert.equal((await call('POST', '/api/admin/withdrawals/reconcile', { signature:txSignature })).status, 409);

  const mint = Keypair.generate().publicKey.toBase58();
  const programId = Keypair.generate().publicKey.toBase58();
  state.launches[mint] = { mint, symbol:'QA', creatorWallet:address(admin),
    pumpFeeRoute:{ scope:'per-mint-v3', programId, initialAuthority:address(keeper), protocolSplit:PROTOCOL_FEE_SPLIT } };
  policyAddress = deriveMintPolicyV3(programId, mint).address;
  vaultAddress = deriveMintVaultsV3(programId, mint)[0];
  const data = Buffer.alloc(249);
  Buffer.from('25d0c7eca736c38f', 'hex').copy(data, 0);
  new PublicKey(mint).toBuffer().copy(data, 8);
  admin.publicKey.toBuffer().copy(data, 40);
  keeper.publicKey.toBuffer().copy(data, 72);
  protocolGrossUnits(PROTOCOL_FEE_SPLIT).forEach((rate, index) => data.writeUInt32LE(rate, 104 + index * 4));
  data.writeBigUInt64LE(3_000_000n, 128);
  data.writeBigUInt64LE(3_000_000n, 136);
  data.writeBigUInt64LE(1_000_000n, 192);
  data[248] = deriveMintPolicyV3(programId, mint).bump;
  policyAccount = { owner:new PublicKey(programId), data };
  vaultAccount = { owner:SystemProgram.programId, data:Buffer.alloc(0), lamports:2_890_880 };
  const rewardVault = deriveCommunityRewardVaultV3(programId, mint, address(keeper));
  reserveAddress = rewardReserveAddress({ programId, vault:rewardVault, asset:'SOL' });
  const reserveData = Buffer.alloc(81);
  createHash('sha256').update('account:RewardReserve').digest().copy(reserveData, 0, 0, 8);
  rewardVault.toBuffer().copy(reserveData, 8);
  new PublicKey(SOL_ASSET_MINT).toBuffer().copy(reserveData, 40);
  reserveData.writeBigUInt64LE(4_000_000n, 72);
  reserveAccount = { owner:new PublicKey(programId), data:reserveData, lamports:5_500_000 };
  const vaults = await call('GET', '/api/admin/vaults');
  assert.equal(vaults.status, 200);
  assert.equal(vaults.value.vaults[0].categories[0].payableLamports, '2000000');
  assert.equal(vaults.value.vaults[0].categories[0].rentReserveLamports, '890880');
  assert.equal(vaults.value.vaults[0].categories[0].unassignedLamports, '0');
  assert.equal(vaults.value.vaults[0].categories[7].payableLamports, '4000000');
  assert.equal(vaults.value.vaults[0].categories[7].rentReserveLamports, '1500000');
  policyAccount = null;
  const unverified = await call('GET', '/api/admin/vaults');
  assert.equal(unverified.value.vaults[0].categories[0].payableLamports, null);
});
