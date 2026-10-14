import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { deriveFeeRouter, verifyFeeRouterAccount } from '../fee-router.js';
import { buildTradeTransaction } from '../pump-trading.js';
import { createAutomaticRewardChain } from '../server/automatic-reward-chain.mjs';
import { buildRewardManifest, createRewardCycleId } from '../reward-merkle.js';
import { loadFinalizedV3PumpCollection } from '../server/v3-finalized-collection.mjs';
import { quoteV3Buyback } from '../server/v3-buyback-quote.mjs';
import { buildV3BuybackInstruction, v3BuybackId } from '../server/v3-buyback-instruction.mjs';
import { prepareV3BuybackTransaction } from '../server/v3-buyback-transaction.mjs';
import { loadFinalizedV3Buyback } from '../server/v3-buyback-proof.mjs';
import { loadFinalizedV3RewardFunding } from '../server/v3-reward-funding-proof.mjs';
import { buildMintRouterV3InitializeInstruction, buildMintRouterV3SettlementInstruction,
  buildMintRouterV3DisbursementInstruction, deriveMintVaultsV3, protocolGrossUnits,
  verifyMintRouterV3Account, verifyMintPolicyV3Account, verifyMintClaimV3Account,
  verifyMintWithdrawalV3Account } from '../mint-router-v3.js';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PROGRAM_ID = new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const UPGRADEABLE_LOADER_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const QA_AUTHORITY = new PublicKey('7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const CLAIM_LAMPORTS = 10_000_000;
const CREATOR_FUNDING_LAMPORTS = 8_000_000;
const EXPECTED_PROTOCOL_UNITS = [1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000];
const EXPECTED_ALLOCATION = [8_000_000, 1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000];

const [mode, binaryArg] = process.argv.slice(2);
if (!['--preflight', '--execute', '--execute-rewards', '--execute-pump',
  '--execute-pump-buyback', '--execute-referrals'].includes(mode) || !binaryArg) {
  throw new Error('Usage: node scripts/run-v3-qa-devnet.mjs --preflight|--execute|--execute-rewards|--execute-pump|--execute-pump-buyback|--execute-referrals <exact-tested-program.so>');
}
const pumpBuybackMode = mode === '--execute-pump-buyback';
const authoritySecret = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || '').trim();
if (!authoritySecret) throw new Error('The dedicated QA authority secret is required.');
const authority = Keypair.fromSecretKey(bs58.decode(authoritySecret));
if (!authority.publicKey.equals(QA_AUTHORITY)) throw new Error('Refusing a non-QA authority signer.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL
  || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'finalized');
if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new Error('Refusing a non-Devnet cluster.');

const program = await connection.getAccountInfo(PROGRAM_ID, 'finalized');
if (!program?.executable || !program.owner.equals(UPGRADEABLE_LOADER_ID)
  || program.data.length < 36 || program.data.readUInt32LE(0) !== 2) {
  throw new Error('The approved V3 QA program is not executable.');
}
const programDataAddress = new PublicKey(program.data.subarray(4, 36));
const programData = await connection.getAccountInfo(programDataAddress, 'finalized');
const binary = readFileSync(resolve(binaryArg));
if (!programData?.owner.equals(UPGRADEABLE_LOADER_ID)
  || programData.data[12] !== 1
  || !new PublicKey(programData.data.subarray(13, 45)).equals(QA_AUTHORITY)
  || programData.data.length < 45 + binary.length
  || !programData.data.subarray(45, 45 + binary.length).equals(binary)
  || programData.data.subarray(45 + binary.length).some(byte => byte !== 0)) {
  throw new Error('Finalized V3 program bytes or upgrade authority do not match the tested QA artifact.');
}
if ((await connection.getBalance(QA_AUTHORITY, 'finalized')) < 50_000_000) {
  throw new Error('QA authority balance is below the bounded test reserve.');
}
if (protocolGrossUnits().join(',') !== EXPECTED_PROTOCOL_UNITS.join(',')) {
  throw new Error('The configured protocol split differs from this bounded QA fixture.');
}
if (mode === '--preflight') {
  console.log(JSON.stringify({ status: 'ready-for-bounded-qa', cluster: 'devnet',
    program: PROGRAM_ID.toBase58(), authority: QA_AUTHORITY.toBase58(),
    binarySha256: createHash('sha256').update(binary).digest('hex'),
    claimLamports: CLAIM_LAMPORTS, categoryLamports: EXPECTED_ALLOCATION }, null, 2));
  process.exit(0);
}

async function send(instructions, signers) {
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers,
    { commitment: 'finalized', skipPreflight: false });
}
async function finalizedBalance(address) {
  return connection.getBalance(address, 'finalized');
}
async function finalizedBalances(addresses) {
  const accounts = await connection.getMultipleAccountsInfo(addresses, 'finalized');
  if (accounts.length !== addresses.length) throw new Error('Incomplete finalized vault account batch.');
  return accounts.map(account => account?.lamports || 0);
}
function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}.`);
}

let globalSignature = null;
let global = await verifyFeeRouterAccount({ connection, programId: PROGRAM_ID });
if (!global.verified) {
  const discriminator = createHash('sha256').update('global:initialize').digest().subarray(0, 8);
  const router = deriveFeeRouter(PROGRAM_ID);
  globalSignature = await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: QA_AUTHORITY, isSigner: true, isWritable: true },
      { pubkey: QA_AUTHORITY, isSigner: true, isWritable: false },
      { pubkey: router.address, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: programDataAddress, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  })], [authority]);
  global = await verifyFeeRouterAccount({ connection, programId: PROGRAM_ID });
}
if (!global.verified || !global.authority.equals(QA_AUTHORITY)) {
  throw new Error('The finalized global router is not owned by the dedicated QA authority.');
}

const qaCreatorSecret = String(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || '').trim();
if (pumpBuybackMode && !qaCreatorSecret) throw new Error('The disposable Devnet creator signer is required.');
const creator = pumpBuybackMode
  ? Keypair.fromSecretKey(bs58.decode(qaCreatorSecret))
  : Keypair.generate();
if (pumpBuybackMode && creator.publicKey.toBase58()
  !== '8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk')
  throw new Error('Pump buyback QA requires the disposable Devnet creator signer.');
const mint = Keypair.generate();
console.error(JSON.stringify({ qaMint: mint.publicKey.toBase58(), qaCreator: creator.publicKey.toBase58() }));
const operationsRecipient = Keypair.generate().publicKey;
const fundCreatorSignature = pumpBuybackMode ? null : await send([SystemProgram.transfer({
  fromPubkey: QA_AUTHORITY, toPubkey: creator.publicKey,
  lamports: mode === '--execute-pump' ? 50_000_000 : CREATOR_FUNDING_LAMPORTS,
})], [authority]);
const initialized = buildMintRouterV3InitializeInstruction({
  programId: PROGRAM_ID, mint: mint.publicKey, authority: QA_AUTHORITY, creator: creator.publicKey,
});
if (initialized.protocolUnits.join(',') !== EXPECTED_PROTOCOL_UNITS.join(','))
  throw new Error('The launch split does not match the bounded QA fixture.');
const initializeSignature = await send([initialized.instruction], [authority, creator, mint]);
console.error(JSON.stringify({ step: 'initialize-finalized', signature: initializeSignature,
  router: initialized.router.address.toBase58(), policy: initialized.policy.address.toBase58() }));
const routerProof = await verifyMintRouterV3Account({ connection, programId: PROGRAM_ID,
  mint: mint.publicKey, initialAuthority: QA_AUTHORITY });
const policyProof = await verifyMintPolicyV3Account({ connection, programId: PROGRAM_ID,
  mint: mint.publicKey, creator: creator.publicKey, initialAuthority: QA_AUTHORITY });
if (!routerProof.verified || !policyProof.verified) throw new Error('Finalized V3 mint router or policy failed verification.');

if (mode === '--execute-pump' || pumpBuybackMode) {
  const sdk = new OnlinePumpSdk(connection);
  const router = initialized.router.address;
  const before = await finalizedBalance(router);
  const launchInstruction = await PUMP_SDK.createV2Instruction({
    mint:mint.publicKey, name:`Funded V3 QA ${Date.now().toString(36)}`,
    symbol:'FV3QA', uri:`https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`,
    creator:router, user:creator.publicKey, mayhemMode:false, holderReward:false,
  });
  const launchSignature = await send([launchInstruction], [creator, mint]);
  console.error(JSON.stringify({ step:'pump-launch-finalized', mint:mint.publicKey.toBase58(), signature:launchSignature }));
  const curve = await sdk.fetchBondingCurve(mint.publicKey);
  if (!curve.creator.equals(router)) throw new Error('Pump bonding curve creator is not the verified V3 router.');
  const tradeSol = Number(process.env.FUNDED_V3_QA_TRADE_SOL || (pumpBuybackMode ? '0.2' : '0.1'));
  if (!Number.isFinite(tradeSol) || tradeSol < 0.01 || tradeSol > 0.2) {
    throw new Error('The V3 QA trade must be between 0.01 and 0.2 Devnet SOL.');
  }
  const tradeCount = pumpBuybackMode ? 4 : 1;
  if (tradeSol * tradeCount > 0.8) throw new Error('Pump buyback QA trades exceed the 0.8 Devnet SOL cap.');
  const tradeSignatures = [];
  for (let index = 0; index < tradeCount; index++) {
    const trade = await buildTradeTransaction({ connection, side:'buy', mint:mint.publicKey,
      user:QA_AUTHORITY, amount:tradeSol, slippagePercent:2,
      feeOwner:creator.publicKey });
    const tradeSignature = await send(trade.instructions, [authority]);
    tradeSignatures.push(tradeSignature);
    console.error(JSON.stringify({ step:'pump-buy-finalized', index:index + 1,
      signature:tradeSignature, sol:tradeSol }));
  }
  const collectionInstructions = await sdk.collectCoinCreatorFeeV2Instructions(
    router, NATIVE_MINT, TOKEN_PROGRAM_ID, QA_AUTHORITY);
  if (!collectionInstructions.length) throw new Error('Pump returned no mint-specific creator-fee collection instruction.');
  const collectionSignature = await send(collectionInstructions, [authority]);
  console.error(JSON.stringify({ step:'pump-collection-finalized', signature:collectionSignature }));
  const proof = await loadFinalizedV3PumpCollection({ connection,
    signature:collectionSignature, programId:PROGRAM_ID, mint:mint.publicKey,
    launch:{ onchainVerified:true, cluster:'devnet', mint:mint.publicKey.toBase58(),
      creator:router.toBase58(), creatorWallet:creator.publicKey.toBase58(),
      pumpFeeRoute:{ scope:'per-mint-v3', router:router.toBase58(),
        programId:PROGRAM_ID.toBase58(), transaction:launchSignature,
        initialAuthority:QA_AUTHORITY.toBase58(), protocolSplit:PROTOCOL_FEE_SPLIT } } });
  if (!proof || proof.router !== router.toBase58()
    || BigInt((await finalizedBalance(router)) - before) !== proof.expectedLamports) {
    throw new Error('Finalized Pump collection lacks an exact V3 router balance and instruction proof.');
  }
  const claim = buildMintRouterV3SettlementInstruction({ programId:PROGRAM_ID,
    mint:mint.publicKey, authority:QA_AUTHORITY, creator:creator.publicKey,
    claimId:proof.claimId, expectedLamports:proof.expectedLamports });
  const vaults = deriveMintVaultsV3(PROGRAM_ID, mint.publicKey);
  const vaultBefore = await finalizedBalances(vaults);
  const settlementSignature = await send([claim.instruction], [authority, creator]);
  console.error(JSON.stringify({ step:'v3-pump-settlement-finalized', signature:settlementSignature }));
  const claimProof = await verifyMintClaimV3Account({ connection, programId:PROGRAM_ID,
    mint:mint.publicKey, claimId:proof.claimId, expectedLamports:proof.expectedLamports });
  const finalPolicy = await verifyMintPolicyV3Account({ connection, programId:PROGRAM_ID,
    mint:mint.publicKey, creator:creator.publicKey, initialAuthority:QA_AUTHORITY });
  if (!claimProof.verified || !finalPolicy.verified
    || finalPolicy.settledLamports !== proof.expectedLamports) {
    throw new Error('Finalized V3 Pump settlement lacks claim and policy state evidence.');
  }
  let cumulative = 8_000_000n;
  let previous = proof.expectedLamports * cumulative / 10_000_000n;
  const expectedAllocations = [previous];
  for (const units of EXPECTED_PROTOCOL_UNITS) {
    cumulative += BigInt(units);
    const boundary = proof.expectedLamports * cumulative / 10_000_000n;
    expectedAllocations.push(boundary - previous);
    previous = boundary;
  }
  if (cumulative !== 10_000_000n || expectedAllocations.some((amount, index) =>
    amount !== claimProof.categoryLamports[index])) {
    throw new Error('Finalized Pump fees were not allocated by the configured 80/20 policy.');
  }
  const vaultAfter = await finalizedBalances(vaults);
  const rentReserve = await connection.getMinimumBalanceForRentExemption(0, 'finalized');
  for (let index = 0; index < vaults.length; index++) {
    const expected = claimProof.categoryLamports[index]
      + BigInt(vaultBefore[index] < rentReserve ? rentReserve - vaultBefore[index] : 0);
    if (BigInt(vaultAfter[index] - vaultBefore[index]) !== expected) {
      throw new Error(`V3 Pump settlement category ${index} lacks its exact vault delta.`);
    }
  }
  let buyback = null;
  if (pumpBuybackMode) {
    const budget = claimProof.categoryLamports[6];
    if (budget < 100_000n) throw new Error('Pump-funded buyback allocation is below the protected 100,000-lamport minimum.');
    const quote = await quoteV3Buyback({ connection, vault:vaults[6],
      budgetLamports:String(budget) });
    const buybackId = v3BuybackId([collectionSignature]);
    const built = buildV3BuybackInstruction({ programId:PROGRAM_ID,
      sourceMint:mint.publicKey, creator:creator.publicKey, authority:QA_AUTHORITY,
      buybackId, ...quote });
    const lookupAddress = new PublicKey('FDx4KpYEkjkfBg7nefPCeNY3tL5kJT4mFTFtsfej58U4');
    const lookup = await connection.getAddressLookupTable(lookupAddress, { commitment:'finalized' });
    if (!lookup.value) throw new Error('Approved Devnet buyback lookup table is missing.');
    const latest = await connection.getLatestBlockhash('finalized');
    const prepared = prepareV3BuybackTransaction({ instruction:built.instruction,
      authority:QA_AUTHORITY, blockhash:latest.blockhash, lookupTable:lookup.value });
    const transaction = VersionedTransaction.deserialize(Buffer.from(prepared, 'base64'));
    transaction.sign([authority]);
    const simulation = await connection.simulateTransaction(transaction, { commitment:'confirmed' });
    if (simulation.value.err) throw new Error(`Pump-funded V3 buyback simulation failed: ${JSON.stringify(simulation.value.err)}; ${simulation.value.logs?.slice(-8).join(' | ')}`);
    const signature = await connection.sendRawTransaction(transaction.serialize(),
      { skipPreflight:false, preflightCommitment:'confirmed', maxRetries:2 });
    const finality = await connection.confirmTransaction({ signature,
      blockhash:latest.blockhash, lastValidBlockHeight:latest.lastValidBlockHeight }, 'finalized');
    if (finality.value.err) throw new Error('Pump-funded V3 buyback failed on-chain.');
    buyback = await loadFinalizedV3Buyback({ connection, signature,
      programId:PROGRAM_ID, sourceMint:mint.publicKey, creator:creator.publicKey,
      initialAuthority:QA_AUTHORITY, authority:QA_AUTHORITY,
      baseTokenProgram:quote.baseTokenProgram, buybackId,
      spendableQuoteIn:quote.spendableQuoteIn,
      minBaseAmountOut:quote.minBaseAmountOut,
      maxTotalDebit:quote.maxTotalDebit,
      pumpBuyInstruction:quote.pumpBuyInstruction, split:PROTOCOL_FEE_SPLIT });
    if (!buyback?.finalized || buyback.spentLamports !== String(budget))
      throw new Error('Pump-funded V3 buyback lacks finalized vault, purchase, and burn proof.');
  }
  console.log(JSON.stringify({ status:'finalized-pump-funded-v3-settlement',
    program:PROGRAM_ID.toBase58(), binarySha256:createHash('sha256').update(binary).digest('hex'),
    mint:mint.publicKey.toBase58(), router:router.toBase58(), creator:creator.publicKey.toBase58(),
    collectedLamports:String(proof.expectedLamports),
    categoryLamports:claimProof.categoryLamports.map(String),
    signatures:{ fundCreatorSignature, initializeSignature, launchSignature, tradeSignatures,
      collectionSignature, settlementSignature }, buyback,
    limits:{ holderEligibilityVerified:false, xIdentityVerified:false,
      buybackBurnVerified:buyback?.finalized === true, appPayoutVerified:false } }, null, 2));
  process.exit(0);
}

const vaults = deriveMintVaultsV3(PROGRAM_ID, mint.publicKey);
const before = await finalizedBalances(vaults);
const vaultReserve = await connection.getMinimumBalanceForRentExemption(0, 'finalized');
const creditSignature = await send([SystemProgram.transfer({
  fromPubkey: QA_AUTHORITY, toPubkey: initialized.router.address, lamports: CLAIM_LAMPORTS,
})], [authority]);
console.error(JSON.stringify({ step: 'synthetic-credit-finalized', signature: creditSignature,
  lamports: CLAIM_LAMPORTS }));
const claimId = randomBytes(32);
const settlement = buildMintRouterV3SettlementInstruction({
  programId: PROGRAM_ID, mint: mint.publicKey, authority: QA_AUTHORITY, creator: creator.publicKey,
  claimId, expectedLamports: CLAIM_LAMPORTS,
});
const settlementSignature = await send([settlement.instruction], [authority, creator]);
console.error(JSON.stringify({ step: 'settlement-finalized', signature: settlementSignature,
  claim: settlement.claim.toBase58() }));
const claimProof = await verifyMintClaimV3Account({ connection, programId: PROGRAM_ID,
  mint: mint.publicKey, claimId, expectedLamports: CLAIM_LAMPORTS });
if (!claimProof.verified) throw new Error('Finalized V3 settlement claim failed verification.');
const after = await finalizedBalances(vaults);
const deltas = after.map((balance, index) => balance - before[index]);
for (let index = 0; index < deltas.length; index++) {
  requireEqual(deltas[index], EXPECTED_ALLOCATION[index] + (before[index] < vaultReserve ? vaultReserve - before[index] : 0),
    `category ${index} vault delta including rent reserve`);
  requireEqual(Number(claimProof.categoryLamports[index]), EXPECTED_ALLOCATION[index],
    `category ${index} claim allocation`);
}
const rewardsMode = mode === '--execute-rewards';
const rewardChain = rewardsMode ? createAutomaticRewardChain({ connection, programId:PROGRAM_ID,
  authority, expectedProgramDataSha256:createHash('sha256').update(programData.data).digest('hex') }) : null;
const rewardVault = rewardsMode ? await rewardChain.ensureVault(mint.publicKey) : null;
const rewardVaultBefore = rewardVault ? await finalizedBalance(rewardVault) : null;
const creatorAmount = rewardsMode ? 5_000_000 : EXPECTED_ALLOCATION[0];
const creatorBefore = await finalizedBalance(creator.publicKey);
const operationsBefore = await finalizedBalance(operationsRecipient);
const creatorWithdrawalId = randomBytes(32);
const creatorWithdrawal = buildMintRouterV3DisbursementInstruction({ programId: PROGRAM_ID,
  mint: mint.publicKey, authority: QA_AUTHORITY, creator: creator.publicKey,
  withdrawalId: creatorWithdrawalId, category: 0, amount: creatorAmount,
  recipient: creator.publicKey });
const creatorPayoutSignature = await send([creatorWithdrawal.instruction], [authority, creator]);
let rewardFundingId = null, rewardFundingSignature = null, rewardCycle = null, rewardPayments = [];
if (rewardsMode) {
  rewardFundingId = randomBytes(32);
  const funding = buildMintRouterV3DisbursementInstruction({ programId:PROGRAM_ID,
    mint:mint.publicKey, authority:QA_AUTHORITY, creator:creator.publicKey,
    withdrawalId:rewardFundingId, category:0, amount:3_000_000, recipient:rewardVault });
  rewardFundingSignature = await send([funding.instruction], [authority, creator]);
  requireEqual((await finalizedBalance(rewardVault)) - rewardVaultBefore, 3_000_000,
    'V3 creator category reward-vault funding delta');
  const fundingProof = await verifyMintWithdrawalV3Account({ connection, programId:PROGRAM_ID,
    mint:mint.publicKey, withdrawalId:rewardFundingId, category:0,
    amount:3_000_000, recipient:rewardVault });
  if (!fundingProof.verified) throw new Error('V3 reward-vault funding lacks a finalized withdrawal receipt.');
  const holder = Keypair.generate().publicKey;
  const xRecipient = Keypair.generate().publicKey;
  const now = Math.floor(Date.now() / 1000);
  const cycleId = createRewardCycleId({ mint:mint.publicKey.toBase58(),
    kind:'synthetic-v3-holder-x-qa', asset:'SOL', periodStart:now - 60, periodEnd:now });
  const manifest = buildRewardManifest({ cycleId, allocations:[
    { recipient:holder.toBase58(), amount:'2000000' },
    { recipient:xRecipient.toBase58(), amount:'1000000' },
  ] });
  const plan = { mint:mint.publicKey.toBase58(), manifest, cutoffAt:now, payoutAt:now };
  rewardCycle = await rewardChain.ensureCycle(plan);
  for (const leaf of manifest.leaves) {
    const result = await rewardChain.submitLeaf(plan, leaf);
    if (!result.finalized || !result.balanceDeltaVerified || result.amountReceived !== leaf.amount) {
      throw new Error('Synthetic V3 reward payment lacks finalized receipt and exact balance proof.');
    }
    rewardPayments.push({ recipient:leaf.recipient, amount:leaf.amount,
      signature:result.signature, payment:result.payment });
  }
}
const operationsWithdrawalId = randomBytes(32);
const operationsWithdrawal = buildMintRouterV3DisbursementInstruction({ programId: PROGRAM_ID,
  mint: mint.publicKey, authority: QA_AUTHORITY, creator: creator.publicKey,
  withdrawalId: operationsWithdrawalId, category: 1, amount: EXPECTED_ALLOCATION[1],
  recipient: operationsRecipient });
const operationsPayoutSignature = await send([operationsWithdrawal.instruction], [authority, creator]);
const referralPayments = [];
if (mode === '--execute-referrals') {
  for (let level = 1; level <= 3; level++) {
    const category = level + 1;
    const recipient = Keypair.generate().publicKey;
    const amount = EXPECTED_ALLOCATION[category];
    const withdrawalId = randomBytes(32);
    const minimum = await connection.getMinimumBalanceForRentExemption(0, 'finalized');
    const activationLamports = minimum + 10_000;
    const activationSignature = await send([SystemProgram.transfer({
      fromPubkey:QA_AUTHORITY, toPubkey:recipient, lamports:activationLamports,
    })], [authority]);
    const beforeRecipient = await finalizedBalance(recipient);
    const payout = buildMintRouterV3DisbursementInstruction({ programId:PROGRAM_ID,
      mint:mint.publicKey, authority:QA_AUTHORITY, creator:creator.publicKey,
      withdrawalId, category, amount, recipient });
    const signature = await send([payout.instruction], [authority, creator]);
    const proof = await loadFinalizedV3RewardFunding({ connection, signature,
      programId:PROGRAM_ID, mint:mint.publicKey, authority:QA_AUTHORITY,
      creator:creator.publicKey, initialAuthority:QA_AUTHORITY,
      withdrawalId, category, amount, recipient, split:PROTOCOL_FEE_SPLIT });
    requireEqual((await finalizedBalance(recipient)) - beforeRecipient, amount,
      `referral level ${level} recipient delta`);
    if (!proof?.balanceDeltaVerified || proof.amount !== String(amount))
      throw new Error(`Referral level ${level} lacks exact finalized V3 withdrawal proof.`);
    referralPayments.push({ level, recipient:recipient.toBase58(),
      amountLamports:String(amount), activationSignature, signature, withdrawal:proof.withdrawal });
  }
}
requireEqual((await finalizedBalance(creator.publicKey)) - creatorBefore,
  creatorAmount, 'creator recipient delta');
requireEqual((await finalizedBalance(operationsRecipient)) - operationsBefore,
  EXPECTED_ALLOCATION[1], 'operations recipient delta');
for (const [id, category, amount, recipient] of [
  [creatorWithdrawalId, 0, creatorAmount, creator.publicKey],
  [operationsWithdrawalId, 1, EXPECTED_ALLOCATION[1], operationsRecipient],
]) {
  const proof = await verifyMintWithdrawalV3Account({ connection, programId: PROGRAM_ID,
    mint: mint.publicKey, withdrawalId: id, category, amount, recipient });
  if (!proof.verified) throw new Error(`Finalized V3 withdrawal receipt ${category} failed verification.`);
}
requireEqual(await finalizedBalance(vaults[6]), EXPECTED_ALLOCATION[6] + vaultReserve, 'locked buyback vault');
const finalPolicy = await verifyMintPolicyV3Account({ connection, programId: PROGRAM_ID,
  mint: mint.publicKey, creator: creator.publicKey, initialAuthority: QA_AUTHORITY });
if (!finalPolicy.verified || finalPolicy.withdrawnLamports[0] !== BigInt(EXPECTED_ALLOCATION[0])
  || finalPolicy.withdrawnLamports[1] !== BigInt(EXPECTED_ALLOCATION[1])
  || referralPayments.some(row => finalPolicy.withdrawnLamports[row.level + 1]
    !== BigInt(row.amountLamports))) {
  throw new Error('Finalized V3 policy withdrawal ledger does not match payouts.');
}
console.log(JSON.stringify({ status: 'finalized-synthetic-v3-qa', program: PROGRAM_ID.toBase58(),
  binarySha256: createHash('sha256').update(binary).digest('hex'),
  mint: mint.publicKey.toBase58(), creator: creator.publicKey.toBase58(),
  router: initialized.router.address.toBase58(), policy: initialized.policy.address.toBase58(),
  claim: settlement.claim.toBase58(), operationsRecipient: operationsRecipient.toBase58(),
  categoryLamports: EXPECTED_ALLOCATION, vaultRentReserveLamports: vaultReserve,
  vaultLamportDeltas: deltas, signatures: { globalSignature, fundCreatorSignature,
    initializeSignature, creditSignature, settlementSignature, creatorPayoutSignature,
    operationsPayoutSignature, rewardFundingSignature },
  syntheticRewards:rewardsMode ? { vault:rewardVault.toBase58(),
    cycle:rewardCycle.address, cycleSignature:rewardCycle.signature, payments:rewardPayments } : null,
  referralPayments,
  limits: { syntheticFunding: true, pumpCollectionVerified: false, buybackBurnVerified: false,
    holderEligibilityVerified:false, xIdentityVerified:false,
    operationsEntitlementVerified: false } }, null, 2));
process.exit(0);
