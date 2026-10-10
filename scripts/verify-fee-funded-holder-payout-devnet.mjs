import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { DEVNET_GENESIS_HASH, rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from '../server/mint-router-payout.mjs';
import { deriveMintFeeRouter, verifyMintFeeRouterAccount } from '../fee-router.js';

const [ledgerPath, mint, periodText, vaultBeforeText] = process.argv.slice(2);
if (!ledgerPath || !mint || !/^\d+$/.test(periodText || '') || !/^\d+$/.test(vaultBeforeText || '')) {
  throw new Error('Use: node verify-fee-funded-holder-payout-devnet.mjs LEDGER MINT PERIOD_START VAULT_BALANCE_BEFORE');
}
const state = JSON.parse(await readFile(ledgerPath, 'utf8'));
const schedule = Object.values(state.schedules || {}).find(row => row.mint === mint && row.kind === 'holder' && row.periodStart === Number(periodText));
assert.equal(schedule?.status, 'paid', 'The selected holder schedule is not paid.');
assert(schedule.poolIds?.length > 0, 'At least one traceable fee-funded pool is required.');
const sources = schedule.poolIds.map(id => {
  const pool = state.rewardPools?.[id];
  const request = state.fundingRequests?.[id];
  assert(pool && request, 'Fee-backed pool and its source request must both exist.');
  assert.equal(pool.status, 'assigned');
  assert.equal(pool.scheduleId, schedule.id);
  assert.equal(pool.balanceDeltaVerified, true);
  assert.equal(request.status, 'funded');
  assert.equal(request.sourceSignature + ':holders', request.id);
  assert.equal(request.fundingSignature, pool.fundingSignature);
  assert.equal(request.amount, pool.amount);
  assert.equal(request.mint, mint);
  return { pool, request };
});

const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH, 'The configured RPC is not Devnet.');
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
const authority = new PublicKey(process.env.FUNDED_REWARD_AUTHORITY);
const vault = rewardAddresses({programId,authority,mint}).vault;
for (const { request } of sources) {
  const claim = buildMintRouterSettlementInstruction({programId,mint,authority,recipient:vault,
    amountLamports:request.amount,obligationId:`automatic-reward:${request.id}`});
  assert.equal(claim.claim.toBase58(), request.fundingClaim, 'The funding claim PDA does not match the request.');
  const claimAccount = await connection.getAccountInfo(claim.claim, 'finalized');
  assert(readMintClaimRecord(claimAccount, {programId,mint,recipient:vault,amountLamports:request.amount,claimId:claim.claimId}),
    'The on-chain claim does not prove the exact reward-vault transfer.');
}

const receiptResponse = await fetch('https://funded.vip/api/evidence/receipts', {signal:AbortSignal.timeout(10_000)});
assert.equal(receiptResponse.status, 200, 'Public verified collection evidence is unavailable.');
const evidence = await receiptResponse.json();
assert.equal(evidence.cluster, 'devnet');
const mintRouter = deriveMintFeeRouter(programId, mint).address;
assert.equal((await verifyMintFeeRouterAccount({ connection, programId, mint })).verified, true,
  'The source mint router is not a verified per-mint account.');
let archivedCollectionsVerifiedOnChain = 0;
for (const { request } of sources) {
  const collection = evidence.verifiedCollections?.find(row => row.signature === request.sourceSignature && row.mint === mint);
  if (collection) {
    assert(BigInt(collection.collectedLamports) >= BigInt(request.amount), 'The public collection is smaller than its holder allocation.');
    continue;
  }
  // The public evidence index can be rotated; the finalized transfer into the
  // verified mint router remains independently checkable on-chain.
  const source = await connection.getTransaction(request.sourceSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  assert(source?.meta?.err === null, 'The archived Pump collection is unavailable or failed on-chain.');
  const keys = [
    ...(source.transaction.message.staticAccountKeys || source.transaction.message.accountKeys),
    ...(source.meta.loadedAddresses?.writable || []),
    ...(source.meta.loadedAddresses?.readonly || []),
  ];
  const routerIndex = keys.findIndex(key => new PublicKey(key).equals(mintRouter));
  assert(routerIndex >= 0, 'The archived collection did not involve the verified mint router.');
  const routerCredit = BigInt(source.meta.postBalances[routerIndex]) - BigInt(source.meta.preBalances[routerIndex]);
  assert(routerCredit >= BigInt(request.amount), 'The archived collection did not fund the holder allocation.');
  archivedCollectionsVerifiedOnChain++;
}

const payments = Object.entries(schedule.payments || {});
assert(payments.length > 0 && payments.length === schedule.manifest?.leaves?.length, 'The payment manifest is incomplete.');
const poolWallet = canonicalPumpPoolPda(new PublicKey(mint), NATIVE_MINT).toBase58();
assert(!payments.some(([wallet]) => wallet === poolWallet), 'The PumpSwap pool received a holder payout.');
const signatures = [...sources.flatMap(({ request }) => [request.sourceSignature, request.fundingSignature]),
  schedule.cycleSignature, ...payments.map(([,row]) => row.signature)];
const statuses = await connection.getSignatureStatuses(signatures, {searchTransactionHistory:true});
assert(statuses.value.every(row => row?.confirmationStatus === 'finalized' && row.err === null), 'A source, funding, cycle, or payout transaction is not finalized.');

const cycle = await connection.getAccountInfo(new PublicKey(schedule.cycle), 'finalized');
assert(cycle?.owner.equals(programId) && cycle.data.length >= 173, 'The reward cycle account is missing.');
const total = payments.reduce((sum,[,row]) => sum + BigInt(row.amount), 0n);
const funded = sources.reduce((sum, { pool }) => sum + BigInt(pool.amount), 0n);
assert(total <= funded && funded - total < BigInt(payments.length), 'Payout total exceeds verified pools or has excessive dust.');
assert.equal(total, BigInt(schedule.manifest.totalAmount));
assert.equal(cycle.data.readBigUInt64LE(144), total, 'The cycle distributed amount differs from the manifest.');
const paymentAccounts = await connection.getMultipleAccountsInfo(payments.map(([,row]) => new PublicKey(row.payment)), 'finalized');
for (const [index,[wallet,row]] of payments.entries()) {
  const account = paymentAccounts[index];
  assert(account?.owner.equals(programId) && account.data.length >= 92, `Payment account missing for ${wallet}.`);
  assert.equal(new PublicKey(account.data.subarray(8,40)).toBase58(), schedule.cycle);
  assert.equal(new PublicKey(account.data.subarray(40,72)).toBase58(), wallet);
  assert.equal(account.data.readBigUInt64LE(72), BigInt(row.amount));
  assert.equal(row.finalized, true);
  assert.equal(row.balanceDeltaVerified, true);
}
const historicalDebits = [];
for (const [, row] of payments) {
  const paymentTx = await connection.getTransaction(row.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  assert(paymentTx?.meta?.err === null, 'A holder payment transaction is unavailable or failed on-chain.');
  const keys = [
    ...(paymentTx.transaction.message.staticAccountKeys || paymentTx.transaction.message.accountKeys),
    ...(paymentTx.meta.loadedAddresses?.writable || []),
    ...(paymentTx.meta.loadedAddresses?.readonly || []),
  ];
  const vaultIndex = keys.findIndex(key => new PublicKey(key).equals(vault));
  assert(vaultIndex >= 0, 'A holder payment did not debit the reward vault.');
  const before = BigInt(paymentTx.meta.preBalances[vaultIndex]);
  const after = BigInt(paymentTx.meta.postBalances[vaultIndex]);
  assert.equal(before - after, BigInt(row.amount), 'A holder payment vault debit differs from its verified payment amount.');
  historicalDebits.push({ slot:paymentTx.slot, before, after });
}
historicalDebits.sort((left, right) => left.slot - right.slot);
const vaultAfter = historicalDebits.at(-1).after;
assert.equal(historicalDebits[0].before, BigInt(vaultBeforeText), 'The first payout vault balance differs from the recorded baseline.');
assert.equal(BigInt(vaultBeforeText) - vaultAfter, total, 'Historical reward vault debits do not equal finalized holder payments.');
console.log(JSON.stringify({verified:true,cluster:'devnet',mint,sources:sources.map(({ request }) => ({
  collection:request.sourceSignature,fundingSignature:request.fundingSignature,fundingClaim:request.fundingClaim,
  amountLamports:request.amount })),
  periodStart:schedule.periodStart,cycle:schedule.cycle,recipientCount:payments.length,
  amountPaidLamports:String(total),roundingDustLamports:String(funded-total),vaultBeforeLamports:vaultBeforeText,vaultAfterLamports:String(vaultAfter),
  poolExcluded:true,archivedCollectionsVerifiedOnChain,paymentSignatures:payments.map(([,row]) => row.signature)}));
