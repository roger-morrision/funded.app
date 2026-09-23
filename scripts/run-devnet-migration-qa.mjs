import assert from 'node:assert/strict';
import bs58 from 'bs58';
import BN from 'bn.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  OnlinePumpSdk,
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
import { assertTradeConfirmed, buildTradeTransaction, fetchBondingCurveSnapshot } from '../pump-trading.js';

const mint = new PublicKey(process.argv[2] || '');
assert.equal(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER, 'devnet', 'Devnet configuration is required.');
const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'confirmed');
const faucetConnection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const officialGenesis = await faucetConnection.getGenesisHash();
assert.equal(await connection.getGenesisHash(), officialGenesis, 'Configured RPC is not Devnet.');

const migrationWallet = Keypair.generate();
const recoveryWallet = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY));
const feeOwner = new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER);
const sdk = new OnlinePumpSdk(connection);

async function send(instructions, signer) {
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ recentBlockhash: latest.blockhash, feePayer: signer.publicKey }).add(...instructions);
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  assertTradeConfirmed(confirmation);
  return signature;
}

async function refundUnusedSol() {
  const balance = await connection.getBalance(migrationWallet.publicKey, 'confirmed');
  if (balance <= 10_000) return null;
  return send([SystemProgram.transfer({ fromPubkey: migrationWallet.publicKey, toPubkey: recoveryWallet.publicKey, lamports: balance - 5_000 })], migrationWallet);
}

const airdropSignatures = [];
const [global, mintAccount, initialCurve] = await Promise.all([
  sdk.fetchGlobal(),
  connection.getParsedAccountInfo(mint, 'confirmed'),
  fetchBondingCurveSnapshot({ connection, mint }),
]);
const tokenProgram = mintAccount.value?.owner;
assert.ok(tokenProgram?.equals(TOKEN_PROGRAM_ID) || tokenProgram?.equals(TOKEN_2022_PROGRAM_ID), 'Mint token program is unavailable.');
const pool = canonicalPumpPoolPda(mint, NATIVE_MINT);
let poolAccount = await connection.getAccountInfo(pool, 'confirmed');
const poolAlreadyMigrated = poolAccount?.owner?.equals(PUMP_AMM_PROGRAM_ID) === true;
const qaFundingLamports = poolAlreadyMigrated ? 0 : initialCurve.complete ? 150_000_000 : 3_050_000_000;
const recoveryBalance = await connection.getBalance(recoveryWallet.publicKey, 'confirmed');
let qaFundSignature = null;
if (qaFundingLamports > 0 && recoveryBalance > qaFundingLamports + 10_000) {
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
    const prepared = await buildTradeTransaction({ connection, side: 'buy', mint, user: migrationWallet.publicKey, amount: buySol, slippagePercent: 3, feeOwner });
    buySignature = await send(prepared.instructions, migrationWallet);
    completed = await fetchBondingCurveSnapshot({ connection, mint });
    assert.equal(completed.complete, true, 'Curve did not complete after the finishing buy.');
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
    poolAccount = await connection.getAccountInfo(pool, 'confirmed');
  }
  assert.ok(poolAccount?.owner?.equals(PUMP_AMM_PROGRAM_ID), 'PumpSwap pool was not created after migration.');
} finally {
  refundSignature = await refundUnusedSol().catch(() => null);
}

console.log(JSON.stringify({
  cluster: 'devnet',
  mint: mint.toBase58(),
  ephemeralMigrationWallet: migrationWallet.publicKey.toBase58(),
  qaFundSignature,
  airdropSignatures,
  requiredSol: Number(requiredLamports) / LAMPORTS_PER_SOL,
  buySol,
  buySignature,
  curveComplete: completed.complete,
  migrateSignature,
  pumpSwapPool: pool.toBase58(),
  pumpSwapOwnerVerified: poolAccount.owner.equals(PUMP_AMM_PROGRAM_ID),
  refundSignature,
}, null, 2));
