import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Keypair, Transaction } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { buildLaunchBurnPolicy, createLaunchBurnTiers, tokensToBaseUnits, validateLaunchBurnPolicy } from '../launch-burn-policy.js';
import { buildPumpLaunchPlan } from '../mint-router-launch.js';

const tiers = createLaunchBurnTiers({ boostAmount: 25_000, proAmount: 100_000, premierAmount: 250_000 });
assert.deepEqual(tiers.map(tier => tier.id), ['standard', 'boost', 'pro', 'premier']);
assert.deepEqual(tiers.map(tier => tier.amountTokens), [0, 25_000, 100_000, 250_000]);
assert.throws(() => createLaunchBurnTiers({ boostAmount: 100_000, proAmount: 25_000 }), /greater than/);
assert.throws(() => createLaunchBurnTiers({ boostAmount: 25_000, proAmount: 100_000, premierAmount: 50_000 }), /Premier burn amount/);

const standard = buildLaunchBurnPolicy({ tierId: 'standard', tiers });
assert.equal(validateLaunchBurnPolicy(standard).valid, true);
assert.equal(standard.separateFromRevenueBuyback, true);
assert.equal(standard.featuredPlacementGuaranteed, false);

const blockedBoost = buildLaunchBurnPolicy({ tierId: 'boost', tiers });
assert.equal(validateLaunchBurnPolicy(blockedBoost).valid, false);
assert.equal(blockedBoost.status, 'blocked-mint-not-configured');

const boost = buildLaunchBurnPolicy({ tierId: 'boost', fundedMint: 'ConfiguredMint', tiers });
assert.equal(validateLaunchBurnPolicy(boost).valid, true);
assert.equal(boost.atomicWithPumpLaunch, true);
assert.equal(boost.instruction, 'BurnChecked');
assert.equal(tokensToBaseUnits(boost.amountTokens, 6), 25_000_000_000n);
const premier = buildLaunchBurnPolicy({ tierId: 'premier', fundedMint: 'ConfiguredMint', tiers });
assert.equal(validateLaunchBurnPolicy(premier).valid, true);
assert.equal(premier.amountTokens, 250_000);

const launchFlow = await readFile(new URL('../launch-flow.js', import.meta.url), 'utf8');
assert.match(launchFlow, /createBurnCheckedInstruction/);
assert.match(launchFlow, /buildPumpLaunchPlan\(/);
assert.match(launchFlow, /burnInstruction: burnPlan\?\.instruction/);
assert.match(launchFlow, /atomicWithPumpLaunch: true/);
assert.match(launchFlow, /supplyAfter/);

const payer = Keypair.generate();
const coinMint = Keypair.generate();
const fundedMint = Keypair.generate().publicKey;
const fundedAta = getAssociatedTokenAddressSync(fundedMint, payer.publicKey);
const router = Keypair.generate().publicKey;
const burnInstruction = createBurnCheckedInstruction(fundedAta, fundedMint, payer.publicKey, 25_000_000_000n, 6);
const createInstruction = await PUMP_SDK.createV2Instruction({
  mint: coinMint.publicKey,
  name: 'Atomic Burn Coin',
  symbol: 'ATOMIC',
  uri: 'https://funded.vip/devnet-metadata/atomic-burn-test',
  creator: router,
  user: payer.publicKey,
  mayhemMode: false,
  holderReward: false,
});
const transaction = new Transaction().add(burnInstruction, createInstruction);
transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
transaction.feePayer = payer.publicKey;
transaction.partialSign(coinMint, payer);
const transactionBytes = transaction.serialize().length;
assert.ok(transactionBytes <= 1232, `Atomic launch is too large: ${transactionBytes} bytes`);
const plan = buildPumpLaunchPlan({ payer: payer.publicKey, mint: coinMint, blockhash: transaction.recentBlockhash, launchInstructions: [createInstruction], burnInstruction });
assert.equal(plan.steps.length, 1);
assert.equal(plan.steps[0].bytes, transactionBytes);

console.log(`launch burn policy verification passed (${transactionBytes} byte atomic transaction)`);
