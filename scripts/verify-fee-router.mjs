import assert from 'node:assert/strict';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { buildExpectedFeeRouterAccountPrefix, buildFeeRouterPolicy, deriveFeeRouter, FEE_ROUTER_POLICY_HASH_HEX, FEE_ROUTER_SEED, verifyFeeRouterAccount } from '../fee-router.js';
import { verifyPermanentPumpCreatorRoute } from '../launch-flow.js';

const program = Keypair.generate().publicKey;
const router = deriveFeeRouter(program);
assert.ok(router.address instanceof PublicKey);
assert.equal(router.programId.toBase58(), program.toBase58());
assert.equal(FEE_ROUTER_SEED, 'funded-fee-router-v1');

const verified = await verifyFeeRouterAccount({
  connection: { getAccountInfo: async () => ({ owner: program, data: buildExpectedFeeRouterAccountPrefix() }) },
  programId: program,
});
assert.equal(verified.verified, true);
assert.equal(FEE_ROUTER_POLICY_HASH_HEX.length, 64);
const wrongPolicy = await verifyFeeRouterAccount({ connection: { getAccountInfo: async () => ({ owner: program, data: new Uint8Array(41) }) }, programId: program });
assert.equal(wrongPolicy.verified, false);
assert.equal(wrongPolicy.reason, 'router-policy-layout-mismatch');

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
