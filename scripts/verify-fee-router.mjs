import assert from 'node:assert/strict';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { buildExpectedFeeRouterAccountPrefix, buildFeeRouterPolicy, deriveFeeRouter, deriveMintFeeRouter, FEE_ROUTER_POLICY_HASH_HEX, FEE_ROUTER_SEED, MINT_FEE_ROUTER_MAGIC, verifyFeeRouterAccount } from '../fee-router.js';
import { verifyLaunchRouterReadiness } from '../server/launch-router-readiness.mjs';
import { verifyPermanentPumpCreatorRoute } from '../launch-flow.js';

const program = Keypair.generate().publicKey;
const router = deriveFeeRouter(program);
assert.ok(router.address instanceof PublicKey);
assert.equal(router.programId.toBase58(), program.toBase58());
assert.equal(FEE_ROUTER_SEED, 'funded-fee-router-v1');

const authority = Keypair.generate().publicKey;
const header = Buffer.alloc(74);
Buffer.from(buildExpectedFeeRouterAccountPrefix()).copy(header);
authority.toBuffer().copy(header, 41);
header[73] = router.bump;
const verified = await verifyFeeRouterAccount({
  connection: { getAccountInfo: async () => ({ owner: program, data: header }) },
  programId: program,
});
assert.equal(verified.verified, true);
assert.equal(verified.authority.toBase58(), authority.toBase58());
assert.equal(FEE_ROUTER_POLICY_HASH_HEX.length, 64);
const shortHeader = await verifyFeeRouterAccount({ connection: { getAccountInfo: async () => ({ owner: program, data: buildExpectedFeeRouterAccountPrefix() }) }, programId: program });
assert.equal(shortHeader.verified, false);
const wrongBumpHeader = Buffer.from(header); wrongBumpHeader[73] ^= 1;
assert.equal((await verifyFeeRouterAccount({ connection: { getAccountInfo: async () => ({ owner: program, data: wrongBumpHeader }) }, programId: program })).verified, false);
assert.equal((await verifyFeeRouterAccount({ connection: { getAccountInfo: async () => null }, programId: program })).verified, false);
const wrongPolicy = await verifyFeeRouterAccount({ connection: { getAccountInfo: async () => ({ owner: program, data: new Uint8Array(41) }) }, programId: program });
assert.equal(wrongPolicy.verified, false);
assert.equal(wrongPolicy.reason, 'router-policy-layout-mismatch');

const mintForRouter = Keypair.generate().publicKey;
const mintRouter = deriveMintFeeRouter(program, mintForRouter);
const mintHeader = Buffer.alloc(106);
mintHeader.write(MINT_FEE_ROUTER_MAGIC, 0, 'ascii');
mintHeader[8] = 2;
Buffer.from(FEE_ROUTER_POLICY_HASH_HEX, 'hex').copy(mintHeader, 9);
authority.toBuffer().copy(mintHeader, 41);
mintForRouter.toBuffer().copy(mintHeader, 73);
mintHeader[105] = mintRouter.bump;
const routerConfig = { programId: program, address: router.address };
const accounts = new Map([[router.address.toBase58(), header], [mintRouter.address.toBase58(), mintHeader]]);
const connection = { getAccountInfo: async address => {
  const data = accounts.get(address.toBase58());
  return data ? { owner: program, data } : null;
} };
assert.equal((await verifyLaunchRouterReadiness({ connection, routerConfig, mint: mintForRouter, perMint: true })).ready, true);
assert.equal((await verifyLaunchRouterReadiness({ connection, routerConfig: null, mint: mintForRouter, perMint: true })).status, 503);
accounts.set(router.address.toBase58(), buildExpectedFeeRouterAccountPrefix());
assert.match((await verifyLaunchRouterReadiness({ connection, routerConfig, mint: mintForRouter, perMint: true })).error, /legacy fee-router policy/);
accounts.set(router.address.toBase58(), header);
accounts.delete(mintRouter.address.toBase58());
assert.match((await verifyLaunchRouterReadiness({ connection, routerConfig, mint: mintForRouter, perMint: true })).error, /mint-specific fee router/);
assert.equal((await verifyLaunchRouterReadiness({ connection: { getAccountInfo: async () => { throw new Error('RPC unavailable'); } }, routerConfig, mint: mintForRouter, perMint: true })).status, 503);

const policy = buildFeeRouterPolicy(router);
assert.equal(policy.ingress.shareBps, 10_000);
assert.equal(policy.lock.pumpCreatorAtCreation, 'funded-app-fee-router-pda');
assert.equal(policy.lock.userHasCreatorFeeAuthority, false);

const creator = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const createCoin = await PUMP_SDK.createV2Instruction({
  mint,
  name: 'Router Test',
  symbol: 'ROUTE',
  uri: 'https://funded.app/router-test.json',
  creator: router.address,
  user: creator,
  mayhemMode: false,
  holderReward: false,
});
const transaction = new Transaction().add(createCoin);
transaction.feePayer = creator;
transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
const size = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
assert.ok(size <= 1232, `Pump launch transaction is too large: ${size}`);

const route = verifyPermanentPumpCreatorRoute({
  bondingCurve: { creator: router.address },
  feeRouter: router.address,
  payer: creator,
});
assert.equal(route.verified, true);
assert.equal(route.userHasCreatorFeeAuthority, false);
assert.equal(verifyPermanentPumpCreatorRoute({ bondingCurve: { creator }, feeRouter: router.address, payer: creator }).verified, false);
console.log(`fee router checks passed (${size} byte atomic Pump launch)`);
