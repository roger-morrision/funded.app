import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { DEVNET_GENESIS_HASH, rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from '../server/mint-router-payout.mjs';

const [ledgerPath, mint, periodText, vaultBeforeText] = process.argv.slice(2);
if (!ledgerPath || !mint || !/^\d+$/.test(periodText || '') || !/^\d+$/.test(vaultBeforeText || '')) {
  throw new Error('Use: node verify-fee-funded-holder-payout-devnet.mjs LEDGER MINT PERIOD_START VAULT_BALANCE_BEFORE');
}
const state = JSON.parse(await readFile(ledgerPath, 'utf8'));
const schedule = Object.values(state.schedules || {}).find(row => row.mint === mint && row.kind === 'holder' && row.periodStart === Number(periodText));
assert.equal(schedule?.status, 'paid', 'The selected holder schedule is not paid.');
assert.equal(schedule.poolIds?.length, 1, 'This proof requires one traceable fee-funded pool.');
const pool = state.rewardPools?.[schedule.poolIds[0]];
const request = state.fundingRequests?.[pool?.id];
assert(pool && request, 'Fee-backed pool and its source request must both exist.');
assert.equal(pool.status, 'assigned');
assert.equal(pool.scheduleId, schedule.id);
assert.equal(pool.balanceDeltaVerified, true);
assert.equal(request.status, 'funded');
assert.equal(request.sourceSignature + ':holders', request.id);
assert.equal(request.fundingSignature, pool.fundingSignature);
assert.equal(request.amount, pool.amount);

const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH, 'The configured RPC is not Devnet.');
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
const authority = new PublicKey(process.env.FUNDED_REWARD_AUTHORITY);
const vault = rewardAddresses({programId,authority,mint}).vault;
const claim = buildMintRouterSettlementInstruction({programId,mint,authority,recipient:vault,
  amountLamports:request.amount,obligationId:`automatic-reward:${request.id}`});
assert.equal(claim.claim.toBase58(), request.fundingClaim, 'The funding claim PDA does not match the request.');
const claimAccount = await connection.getAccountInfo(claim.claim, 'finalized');
assert(readMintClaimRecord(claimAccount, {programId,mint,recipient:vault,amountLamports:request.amount,claimId:claim.claimId}),
  'The on-chain claim does not prove the exact reward-vault transfer.');

const receiptResponse = await fetch('https://funded.vip/api/evidence/receipts', {signal:AbortSignal.timeout(10_000)});
assert.equal(receiptResponse.status, 200, 'Public verified collection evidence is unavailable.');
const evidence = await receiptResponse.json();
assert.equal(evidence.cluster, 'devnet');
assert.equal(evidence.status, 'onchain-indexed');
const collection = evidence.verifiedCollections?.find(row => row.signature === request.sourceSignature && row.mint === mint);
assert(collection && BigInt(collection.collectedLamports) >= BigInt(request.amount), 'The source Pump collection is not verified.');

const payments = Object.entries(schedule.payments || {});
assert(payments.length > 0 && payments.length === schedule.manifest?.leaves?.length, 'The payment manifest is incomplete.');
const poolWallet = canonicalPumpPoolPda(new PublicKey(mint), NATIVE_MINT).toBase58();
assert(!payments.some(([wallet]) => wallet === poolWallet), 'The PumpSwap pool received a holder payout.');
const signatures = [request.sourceSignature, request.fundingSignature, schedule.cycleSignature, ...payments.map(([,row]) => row.signature)];
const statuses = await connection.getSignatureStatuses(signatures, {searchTransactionHistory:true});
assert(statuses.value.every(row => row?.confirmationStatus === 'finalized' && row.err === null), 'A source, funding, cycle, or payout transaction is not finalized.');

const cycle = await connection.getAccountInfo(new PublicKey(schedule.cycle), 'finalized');
assert(cycle?.owner.equals(programId) && cycle.data.length >= 173, 'The reward cycle account is missing.');
const total = payments.reduce((sum,[,row]) => sum + BigInt(row.amount), 0n);
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
const vaultAfter = await connection.getBalance(vault, 'finalized');
assert.equal(BigInt(vaultBeforeText) - BigInt(vaultAfter), total, 'Reward vault debit does not equal finalized holder payments.');
console.log(JSON.stringify({verified:true,cluster:'devnet',mint,sourceCollection:request.sourceSignature,
  fundingSignature:request.fundingSignature,fundingClaim:request.fundingClaim,
  periodStart:schedule.periodStart,cycle:schedule.cycle,recipientCount:payments.length,
  amountPaidLamports:String(total),vaultBeforeLamports:vaultBeforeText,vaultAfterLamports:vaultAfter,
  poolExcluded:true,paymentSignatures:payments.map(([,row]) => row.signature)}));
