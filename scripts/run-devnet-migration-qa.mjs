import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import BN from 'bn.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  OnlinePumpSdk,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
} from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from '@solana/web3.js';
import { assertTradeConfirmed, buildTradeTransaction, fetchBondingCurveSnapshot, fetchVerifiedPoolSnapshot } from '../pump-trading.js';

const args = process.argv.slice(2);
const mint = new PublicKey(args.find(arg => !arg.startsWith('--')) || '');
const execute = args.includes('--execute');
const verify = args.includes('--verify');
assert(!(execute && (args.includes('--preflight') || verify)), 'Choose only one of --preflight, --verify, or --execute.');
const migrationSignatureArg = args.find(arg => arg.startsWith('--migration-signature='));
const migrationSignatureToVerify = migrationSignatureArg?.slice('--migration-signature='.length);
assert(!verify || migrationSignatureToVerify, '--verify requires --migration-signature=<base58 signature>.');
const maxSolArg = args.find(arg => arg.startsWith('--max-sol='));
assert(!execute || maxSolArg, 'Executing migration requires an explicit --max-sol cap (at most 3.1 Devnet SOL).');
const maxSol = Number(maxSolArg?.slice('--max-sol='.length) || '3.1');
assert(Number.isFinite(maxSol) && maxSol > 0 && maxSol <= 3.1, 'The Devnet migration cap must be above zero and at most 3.1 SOL.');
const maxLamports = BigInt(Math.floor(maxSol * LAMPORTS_PER_SOL));
assert.equal(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER, 'devnet', 'Devnet configuration is required.');
assert.notEqual(process.env.VITE_ALLOW_MAINNET, 'true', 'Mainnet must remain disabled.');
const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
const faucetConnection = new Connection(clusterApiUrl('devnet'), 'finalized');
const officialGenesis = await faucetConnection.getGenesisHash();
assert.equal(await connection.getGenesisHash(), officialGenesis, 'Configured RPC is not Devnet.');

const recoveryWallet = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY));
const qaWallets = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
const expectedCreator = qaWallets.find(item => item.role === 'creator' && item.cluster === 'devnet')?.address;
assert.equal(recoveryWallet.publicKey.toBase58(), expectedCreator, 'Issuer signer differs from the rotated Devnet QA creator manifest.');
// Execution uses the manifest-approved issuer so the test leaves no funded
// disposable wallet or faucet retry path. Preflight can still inspect either mode.
const issuerWalletMode = process.argv.includes('--issuer-wallet');
assert(!execute || issuerWalletMode, 'Execute only with --issuer-wallet; do not fund a disposable migration wallet or request faucet SOL.');
const migrationWallet = issuerWalletMode ? recoveryWallet : Keypair.generate();
const feeOwner = new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER);
const sdk = new OnlinePumpSdk(connection);

async function send(instructions, signer) {
  const latest = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ recentBlockhash: latest.blockhash, feePayer: signer.publicKey }).add(...instructions);
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'finalized');
  assertTradeConfirmed(confirmation);
  return signature;
}

async function finalizedReceipt(signature, { migration = false } = {}) {
  assert.equal(bs58.decode(signature).length, 64, 'Expected a Solana transaction signature.');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const [statuses, transaction] = await Promise.all([
      connection.getSignatureStatuses([signature], { searchTransactionHistory:true }),
      connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
    ]);
    const status = statuses.value[0];
    if (status?.err) throw new Error(`Finalized transaction failed: ${JSON.stringify(status.err)}`);
    if (transaction?.meta?.err) throw new Error(`Finalized transaction failed: ${JSON.stringify(transaction.meta.err)}`);
    if (status?.confirmationStatus === 'finalized' && transaction?.meta && transaction.slot === status.slot) {
      if (migration) {
        const message = transaction.transaction.message;
        const keys = message.accountKeys || message.staticAccountKeys;
        const instructions = message.instructions || message.compiledInstructions;
        assert(keys?.some(key => key.equals(mint)) && keys?.some(key => key.equals(pool)), 'Migration receipt does not reference the expected mint and pool.');
        assert(instructions?.some(ix => keys[ix.programIdIndex]?.equals(PUMP_PROGRAM_ID)), 'Migration receipt does not invoke the Pump migration program.');
      }
      return { signature, slot:transaction.slot, blockTime:transaction.blockTime };
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Finalized receipt was unavailable for ${signature}.`);
}

async function finalizedState() {
  const [curve, poolAccount] = await Promise.all([
    fetchBondingCurveSnapshot({ connection, mint }),
    connection.getAccountInfoAndContext(pool, 'finalized'),
  ]);
  const poolVerified = poolAccount.value?.owner?.equals(PUMP_AMM_PROGRAM_ID) === true;
  const poolSnapshot = poolVerified ? await fetchVerifiedPoolSnapshot({ connection, mint, poolAddress:pool }) : null;
  return { curve, poolAccount, poolVerified, poolSnapshot };
}

async function refundUnusedSol() {
  if (issuerWalletMode) return null;
  const balance = await connection.getBalance(migrationWallet.publicKey, 'confirmed');
  if (balance <= 10_000) return null;
  return send([SystemProgram.transfer({ fromPubkey: migrationWallet.publicKey, toPubkey: recoveryWallet.publicKey, lamports: balance - 5_000 })], migrationWallet);
}

const airdropSignatures = [];
const [global, mintAccount, initialCurve] = await Promise.all([
  sdk.fetchGlobal(),
  connection.getParsedAccountInfo(mint, 'finalized'),
  fetchBondingCurveSnapshot({ connection, mint }),
]);
const tokenProgram = mintAccount.value?.owner;
assert.ok(tokenProgram?.equals(TOKEN_PROGRAM_ID) || tokenProgram?.equals(TOKEN_2022_PROGRAM_ID), 'Mint token program is unavailable.');
const pool = canonicalPumpPoolPda(mint, NATIVE_MINT);
let poolAccount = await connection.getAccountInfo(pool, 'finalized');
const poolAlreadyMigrated = poolAccount?.owner?.equals(PUMP_AMM_PROGRAM_ID) === true;
const qaFundingLamports = poolAlreadyMigrated ? 0 : initialCurve.complete ? 150_000_000 : 3_050_000_000;
assert(BigInt(qaFundingLamports) <= maxLamports, 'The required migration funding exceeds the explicit Devnet SOL cap.');
const recoveryBalance = await connection.getBalance(recoveryWallet.publicKey, 'finalized');
console.log(JSON.stringify({ stage:'preflight', execute, cluster:'devnet', mint:mint.toBase58(), issuer:recoveryWallet.publicKey.toBase58(),
  issuerManifestVerified:true, payerRole:issuerWalletMode?'devnet-issuer':'disposable-read-only',
  curveComplete:initialCurve.complete, poolAlreadyMigrated, issuerBalanceSol:recoveryBalance/LAMPORTS_PER_SOL,
  requiredFundingSol:qaFundingLamports/LAMPORTS_PER_SOL, maxSol }));
if (verify) {
  const receipt = await finalizedReceipt(migrationSignatureToVerify, { migration:true });
  const state = await finalizedState();
  assert.equal(state.curve.complete, true, 'Finalized bonding curve is not complete.');
  assert.equal(state.poolVerified, true, 'Finalized PumpSwap pool is unavailable.');
  assert(state.poolAccount.context.slot >= receipt.slot, 'Finalized pool observation predates the migration receipt.');
  assert(state.poolSnapshot.baseTokenReserves > 0 && state.poolSnapshot.quoteReservesSol > 0, 'Verified pool reserves are empty.');
  console.log(JSON.stringify({ stage:'postmigration-verified', cluster:'devnet', mint:mint.toBase58(), migrationReceipt:receipt,
    curveComplete:state.curve.complete, curveRealTokenReserves:state.curve.realTokenReserves,
    pumpSwapPool:pool.toBase58(), poolObservationSlot:state.poolAccount.context.slot,
    poolBaseTokenReserves:state.poolSnapshot.baseTokenReserves, poolQuoteReservesSol:state.poolSnapshot.quoteReservesSol }, null, 2));
  process.exit(0);
}
if (!execute) process.exit(0);
assert(!poolAlreadyMigrated, 'This is not a fresh migration: a finalized PumpSwap pool already exists. No transaction sent.');
let qaFundSignature = null;
if (issuerWalletMode && qaFundingLamports > 0) {
  assert(recoveryBalance > qaFundingLamports + 10_000, 'Issuer wallet lacks the bounded Devnet migration budget.');
} else if (qaFundingLamports > 0 && recoveryBalance > qaFundingLamports + 10_000) {
  qaFundSignature = await send([
    SystemProgram.transfer({ fromPubkey: recoveryWallet.publicKey, toPubkey: migrationWallet.publicKey, lamports: qaFundingLamports }),
  ], recoveryWallet);
} else if (qaFundingLamports > 0) {
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const signature = await faucetConnection.requestAirdrop(migrationWallet.publicKey, 2 * LAMPORTS_PER_SOL);
      const latest = await faucetConnection.getLatestBlockhash('confirmed');
      const confirmation = await faucetConnection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
      assertTradeConfirmed(confirmation);
      airdropSignatures.push(signature);
    }
  } catch (error) {
    const fundedBalance = await connection.getBalance(migrationWallet.publicKey, 'confirmed');
    const refundSignature = await refundUnusedSol().catch(() => null);
    throw new Error(`Migration blocked: QA wallet ${recoveryWallet.publicKey.toBase58()} has ${(recoveryBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL; Devnet faucet funded ${(fundedBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL before refusing the bounded request. Refund: ${refundSignature || 'unavailable'}. ${error.message}`);
  }
}

let requiredLamports = 0n;
let buySol = 0;
let buySignature = null;
let completed = initialCurve;
let migrateSignature = null;
let buyReceipt = null;
let migrateReceipt = null;
let finalState = null;
let refundSignature = null;
try {
  if (!completed.complete) {
    const buyState = await sdk.fetchBuyState(mint, migrationWallet.publicKey);
    const remainingTokens = BigInt(buyState.bondingCurve.realTokenReserves.toString());
    let low = 0n;
    let high = 4_000_000_000n;
    while (low < high) {
      const midpoint = (low + high) >> 1n;
      const output = BigInt(getBuyTokenAmountFromSolAmount({ global, bondingCurve: buyState.bondingCurve, amount: new BN(midpoint.toString()) }).toString());
      if (output >= remainingTokens) high = midpoint;
      else low = midpoint + 1n;
    }
    requiredLamports = low;
    buySol = Number(requiredLamports + 2_000_000n) / LAMPORTS_PER_SOL;
    assert(requiredLamports + 2_000_000n <= maxLamports, 'The finishing buy exceeds the explicit Devnet SOL cap. No buy was sent.');
    const prepared = await buildTradeTransaction({ connection, side: 'buy', mint, user: migrationWallet.publicKey, amount: buySol, slippagePercent: 3, feeOwner });
    // Reserve 3% for Pump slippage and 0.01 SOL for account/transaction costs.
    const reviewedMaxLamports = BigInt(prepared.quoteAmount.toString()) * 10_300n / 10_000n + BigInt(prepared.feeLamports) + 10_000_000n;
    assert(reviewedMaxLamports <= maxLamports, 'The reviewed maximum buy cost, including slippage, app fee, and reserve, exceeds the Devnet SOL cap. No buy was sent.');
    buySignature = await send(prepared.instructions, migrationWallet);
    buyReceipt = await finalizedReceipt(buySignature);
    completed = (await finalizedState()).curve;
    assert.equal(completed.complete, true, 'Curve did not complete after the finishing buy.');
    assert(completed.realTokenReserves < initialCurve.realTokenReserves, 'Finalized curve token reserves did not decrease after the finishing buy.');
  }

  if (!poolAccount?.owner?.equals(PUMP_AMM_PROGRAM_ID)) {
    const instruction = await PUMP_SDK.migrateV2Instruction({
      withdrawAuthority: global.withdrawAuthority,
      mint,
      user: migrationWallet.publicKey,
      quoteMint: NATIVE_MINT,
      baseTokenProgram: tokenProgram,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    });
    migrateSignature = await send([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      instruction,
    ], migrationWallet);
    migrateReceipt = await finalizedReceipt(migrateSignature, { migration:true });
  }
  finalState = await finalizedState();
  assert.equal(finalState.curve.complete, true, 'Finalized curve completion was not retained.');
  assert.equal(finalState.poolVerified, true, 'Finalized PumpSwap pool was not created after migration.');
  assert(finalState.poolAccount.context.slot >= migrateReceipt.slot, 'Pool observation predates finalized migration receipt.');
  assert(finalState.poolSnapshot.baseTokenReserves > 0 && finalState.poolSnapshot.quoteReservesSol > 0, 'Finalized PumpSwap pool reserves are empty.');
} finally {
  refundSignature = await refundUnusedSol().catch(() => null);
}

console.log(JSON.stringify({
  cluster: 'devnet',
  mint: mint.toBase58(),
  migrationWallet: migrationWallet.publicKey.toBase58(),
  payerRole: issuerWalletMode ? 'devnet-issuer' : 'disposable',
  qaFundSignature,
  airdropSignatures,
  requiredSol: Number(requiredLamports) / LAMPORTS_PER_SOL,
  buySol,
  buySignature,
  buyFinalizedSlot: buyReceipt?.slot || null,
  curveRealTokenReservesBefore:initialCurve.realTokenReserves,
  curveRealTokenReservesAfter:finalState.curve.realTokenReserves,
  curveComplete: completed.complete,
  migrateSignature,
  migrateFinalizedSlot:migrateReceipt.slot,
  pumpSwapPool: pool.toBase58(),
  pumpSwapOwnerVerified: finalState.poolVerified,
  pumpSwapObservationSlot:finalState.poolAccount.context.slot,
  pumpSwapBaseTokenReserves:finalState.poolSnapshot.baseTokenReserves,
  pumpSwapQuoteReservesSol:finalState.poolSnapshot.quoteReservesSol,
  refundSignature,
}, null, 2));
