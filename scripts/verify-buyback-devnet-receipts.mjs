import assert from 'node:assert/strict';
import { Connection, PublicKey } from '@solana/web3.js';
import { buybackClaimId, readMintClaimRecord } from '../server/mint-router-payout.mjs';

const api = process.env.BUYBACK_STATUS_URL || 'http://127.0.0.1:8788/api/buyback/status';
const response = await fetch(api, { signal:AbortSignal.timeout(10_000) });
assert.equal(response.ok, true, 'Devnet buyback receipt index must be available');
const status = await response.json();
assert.equal(status.cluster, 'devnet');
const receipts = status.receipts || [];
assert.ok(receipts.length > 0, 'At least one finalized fee-funded buyback receipt is required');
const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
const fundedMint = process.env.FUNDED_TOKEN_MINT;
const pool = process.env.FUNDED_SWAP_POOL;

for (const receipt of receipts) {
  assert.equal(receipt.status, 'finalized');
  assert.equal(receipt.refundVerified, true);
  const [transaction, parsed, claim, refund] = await Promise.all([
    connection.getTransaction(receipt.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
    connection.getParsedTransaction(receipt.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
    connection.getAccountInfo(new PublicKey(receipt.claim), 'finalized'),
    connection.getTransaction(receipt.refundSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
  ]);
  assert.ok(transaction && parsed && refund, 'Buy, burn, and refund must all be finalized');
  assert.equal(transaction.meta.err, null);
  assert.equal(refund.meta.err, null);
  const burn = parsed.transaction.message.instructions.find(instruction => instruction.program === 'spl-token' && instruction.parsed?.type === 'burnChecked' && instruction.parsed.info.mint === fundedMint);
  assert.ok(burn, 'Transaction must contain an SPL BurnChecked for the configured $FUNDED mint');
  assert.equal(burn.parsed.info.tokenAmount.amount, receipt.boughtAndBurnedBaseUnits);
  assert.equal(BigInt(receipt.supplyBefore) - BigInt(receipt.supplyAfter), BigInt(receipt.boughtAndBurnedBaseUnits));
  assert.ok(readMintClaimRecord(claim, { programId:process.env.FUNDED_FEE_ROUTER_PROGRAM_ID, mint:receipt.mint, recipient:burn.parsed.info.authority, amountLamports:receipt.settledLamports, claimId:buybackClaimId(receipt.id) }), 'Onchain claim must bind the source mint, operator, and exact fee payout');
  const keys = transaction.transaction.message.getAccountKeys({ accountKeysFromLookups:transaction.meta.loadedAddresses });
  const keyAt = key => Array.from({length:keys.length},(_,index)=>keys.get(index)).findIndex(item=>item.toBase58()===key);
  const routerIndex = keyAt(receipt.router);
  assert.ok(routerIndex >= 0);
  assert.equal(BigInt(transaction.meta.preBalances[routerIndex] - transaction.meta.postBalances[routerIndex]), BigInt(receipt.settledLamports));
  const tokenRows = parsed.meta.preTokenBalances.filter(row => row.mint === fundedMint);
  const operatorToken = tokenRows.find(row => row.owner === burn.parsed.info.authority);
  const poolToken = tokenRows.find(row => row.owner === pool);
  assert.ok(operatorToken && poolToken, 'Verified pool and operator token accounts must be present');
  const delta = row => BigInt(parsed.meta.postTokenBalances.find(after => after.accountIndex === row.accountIndex).uiTokenAmount.amount) - BigInt(row.uiTokenAmount.amount);
  assert.equal(delta(operatorToken), 0n, 'Operator must retain no purchased tokens after the atomic burn');
  assert.equal(delta(poolToken), -BigInt(receipt.boughtAndBurnedBaseUnits), 'Pool must supply exactly the burned tokens');
  const refundKeys = refund.transaction.message.getAccountKeys().staticAccountKeys;
  const refundRouterIndex = refundKeys.findIndex(key => key.toBase58() === receipt.router);
  assert.ok(refundRouterIndex >= 0);
  assert.equal(BigInt(refund.meta.postBalances[refundRouterIndex] - refund.meta.preBalances[refundRouterIndex]), BigInt(receipt.returnedLamports));
  console.log(JSON.stringify({ mint:receipt.mint, buyAndBurn:receipt.signature, refund:receipt.refundSignature, netFeeFundedLamports:String(BigInt(receipt.settledLamports)-BigInt(receipt.returnedLamports)), burnedBaseUnits:receipt.boughtAndBurnedBaseUnits, verified:true }));
}
