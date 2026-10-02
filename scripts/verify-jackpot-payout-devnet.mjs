import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import bs58 from 'bs58';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { jackpotWindow } from '../server/jackpot-model.mjs';
import { verifyJackpotPayoutOnchain } from '../server/jackpot-round.mjs';
import { refundEphemeralDevnetBalances } from '../server/jackpot-test-refund.mjs';

// Explicitly opt in. One faucet request, fresh in-memory keys, no app wallets.
if (process.env.RUN_DEVNET_JACKPOT_PAYOUT !== '1'
  && process.env.JACKPOT_MANUAL_FUNDING !== '1') {
  throw new Error('Set RUN_DEVNET_JACKPOT_PAYOUT=1 or JACKPOT_MANUAL_FUNDING=1 for the isolated Devnet payout check.');
}
const refundAddress = String(process.env.JACKPOT_DEVNET_REFUND_ADDRESS || '');
if (!refundAddress) {
  throw new Error('JACKPOT_DEVNET_REFUND_ADDRESS is required before creating any funded test wallet.');
}
if (!process.stdin.isTTY) {
  throw new Error('An interactive terminal is required so a failed refund can be retried.');
}
const refund = new PublicKey(refundAddress);
const genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const connection = new Connection('https://api.devnet.solana.com', 'finalized');
assert.equal(await connection.getGenesisHash(), genesis, 'RPC must be Devnet');
const accountKey = row => typeof row?.pubkey === 'string' ? row.pubkey : row?.pubkey?.toBase58?.();
async function finalizedTransaction(signature) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tx = await connection.getParsedTransaction(signature,
      { commitment:'finalized', maxSupportedTransactionVersion:0 });
    if (tx) return tx;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Finalized transaction ${signature} was not indexed after five reads.`);
}
async function sendFinalizedTransfer(source, destination, amountLamports, label) {
  const latest = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ recentBlockhash:latest.blockhash,
    feePayer:source.publicKey }).add(SystemProgram.transfer({
    fromPubkey:source.publicKey, toPubkey:destination, lamports:amountLamports }));
  transaction.sign(source);
  const signature = bs58.encode(transaction.signature);
  try { await connection.sendRawTransaction(transaction.serialize()); }
  catch (error) {
    console.error(`${label} submission outcome uncertain for ${signature}: ${error.message}. Reconciling before cleanup.`);
  }
  let lastNotice = 0;
  for (;;) {
    let tx; let status; let height;
    try {
      [tx, status, height] = await Promise.all([
        connection.getParsedTransaction(signature,
          { commitment:'finalized', maxSupportedTransactionVersion:0 }),
        connection.getSignatureStatuses([signature], { searchTransactionHistory:true })
          .then(result => result.value[0]),
        connection.getBlockHeight('finalized'),
      ]);
    } catch (error) {
      if (Date.now() - lastNotice > 10_000) {
        console.error(`${label} RPC reconciliation pending for ${signature}: ${error.message}`);
        lastNotice = Date.now();
      }
      await new Promise(resolve => setTimeout(resolve, 2_000));
      continue;
    }
    if (tx?.meta?.err || status?.err)
      throw new Error(`${label} transaction ${signature} failed on Devnet.`);
    if (tx) return signature;
    if (height > latest.lastValidBlockHeight && !status)
      throw new Error(`${label} transaction ${signature} expired without a confirmed signature.`);
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
}
async function verifyFinalizedTransfer(signature, source, destination, amountLamports, label) {
  const tx = await finalizedTransaction(signature);
  const keys = tx?.transaction?.message?.accountKeys || [];
  const sourceAddress = source.toBase58();
  const destinationAddress = destination.toBase58();
  const sourceIndex = keys.findIndex(row => accountKey(row) === sourceAddress);
  const destinationIndex = keys.findIndex(row => accountKey(row) === destinationAddress);
  const instruction = tx?.transaction?.message?.instructions?.[0];
  assert.ok(tx && !tx.meta?.err && keys.length >= 2
    && tx.transaction.message.instructions.length === 1
    && instruction.program === 'system'
    && instruction.parsed?.type === 'transfer'
    && instruction.parsed.info.source === sourceAddress
    && instruction.parsed.info.destination === destinationAddress
    && String(instruction.parsed.info.lamports) === String(amountLamports)
    && sourceIndex >= 0 && destinationIndex >= 0
    && keys[sourceIndex].signer === true
    && Number.isSafeInteger(tx.meta.fee)
    && tx.meta.postBalances[destinationIndex] - tx.meta.preBalances[destinationIndex]
      === amountLamports
    && tx.meta.preBalances[sourceIndex] - tx.meta.postBalances[sourceIndex]
      === amountLamports + tx.meta.fee,
  `${label} must have a matching finalized transfer and balance delta`);
  return tx;
}
async function quotedTransferFee(source, destination, amountLamports) {
  const latest = await connection.getLatestBlockhash('finalized');
  const probe = new Transaction({ recentBlockhash:latest.blockhash,
    feePayer:source }).add(SystemProgram.transfer({
    fromPubkey:source, toPubkey:destination, lamports:amountLamports }));
  const fee = (await connection.getFeeForMessage(probe.compileMessage(), 'finalized'))?.value;
  if (!Number.isSafeInteger(fee) || fee <= 0)
    throw new Error('A finalized payout transaction-fee quote is required.');
  return fee;
}
const testFeeSource = Keypair.generate();
const creatorVault = Keypair.generate();
const traderVault = Keypair.generate();
const creator = process.env.JACKPOT_DEVNET_CREATOR_TEST_RECIPIENT
  ? new PublicKey(process.env.JACKPOT_DEVNET_CREATOR_TEST_RECIPIENT) : Keypair.generate();
const trader = process.env.JACKPOT_DEVNET_TRADER_TEST_RECIPIENT
  ? new PublicKey(process.env.JACKPOT_DEVNET_TRADER_TEST_RECIPIENT) : Keypair.generate();
const recipientKey = wallet => wallet instanceof Keypair ? wallet.publicKey : wallet;
const testKeys = [creator, trader].filter(wallet => wallet instanceof Keypair)
  .concat(creatorVault, traderVault, testFeeSource);
if (testKeys.some(key => key.publicKey.equals(refund)))
  throw new Error('The refund address must be an external Devnet wallet.');
if (recipientKey(creator).equals(refund) || recipientKey(trader).equals(refund)
  || recipientKey(creator).equals(recipientKey(trader))
  || [creatorVault, traderVault, testFeeSource].some(wallet =>
    wallet.publicKey.equals(recipientKey(creator)) || wallet.publicKey.equals(recipientKey(trader))))
  throw new Error('Test payout recipients, vaults, fee source, and refund wallet must be distinct.');
async function refundTestBalances() {
  await refundEphemeralDevnetBalances({ connection, signers:testKeys,
    refundAddress, onReceipt:row => console.log(JSON.stringify({ refund:row })),
    waitForRetry:async ({ source, error }) => {
      console.error(`Refund pending for ${source}: ${error.message}`);
      const input = createInterface({ input:process.stdin, output:process.stdout });
      try { await input.question('Keep this process open. Press Enter to recheck and retry the refund. '); }
      finally { input.close(); }
    } });
}

let payoutError;
try {
  if (process.env.JACKPOT_MANUAL_FUNDING === '1') {
    console.log(`DEVNET_TEST_FEE_SOURCE=${testFeeSource.publicKey.toBase58()}`);
    console.log(`Send at least 0.004 Devnet SOL. The test source will fund separate creator and trader vaults, including their transaction-fee reserves, while retaining enough SOL to remain rent exempt. Unspent test SOL, less transaction fees, will be returned to ${refundAddress}. Do not fund any prior test address.`);
    const input = createInterface({ input:process.stdin, output:process.stdout });
    try { await input.question('Press Enter after the Devnet transfer is finalized. '); }
    finally { input.close(); }
  } else {
    let airdropSignature;
    try {
      airdropSignature = await connection.requestAirdrop(testFeeSource.publicKey,
        Math.round(0.01 * LAMPORTS_PER_SOL));
    } catch (error) {
      throw new Error(`Devnet faucet unavailable after one request: ${error.message}`);
    }
    const confirmation = await connection.confirmTransaction(airdropSignature, 'finalized');
    assert.equal(confirmation.value.err, null, 'Devnet faucet funding must finalize');
    console.log(JSON.stringify({ fundingSignature:airdropSignature, status:'finalized-devnet-airdrop' }));
  }
  const fundedBalance = await connection.getBalance(testFeeSource.publicKey, 'finalized');
  const rentMinimum = await connection.getMinimumBalanceForRentExemption(0, 'finalized');
  const sourceFee = await quotedTransferFee(testFeeSource.publicKey, refund, 10_000);
  const creatorPayoutFee = await quotedTransferFee(creatorVault.publicKey,
    recipientKey(creator), 1_000_000);
  const traderPayoutFee = await quotedTransferFee(traderVault.publicKey,
    recipientKey(trader), 2_000_000);
  const minimumFunding = 3_000_000 + creatorPayoutFee + traderPayoutFee
    + 10_000 + 3 * sourceFee + rentMinimum + 50_000;
  if (fundedBalance < minimumFunding)
    throw new Error(`Test fee source had ${fundedBalance} finalized lamports; at least ${minimumFunding} are needed to keep it rent exempt through both vault transfers.`);
  console.log(JSON.stringify({ testFeeSource:testFeeSource.publicKey.toBase58(),
    fundedLamports:fundedBalance, status:'finalized-devnet-balance' }));
  const refundCanaryLamports = 10_000;
  const refundCanarySignature = await sendFinalizedTransfer(testFeeSource,
    refund, refundCanaryLamports, 'Refund canary');
  await verifyFinalizedTransfer(refundCanarySignature,
    testFeeSource.publicKey, refund, refundCanaryLamports, 'Refund canary');
  console.log(JSON.stringify({ refundCanarySignature,
    refundAddress, amountLamports:refundCanaryLamports,
    status:'finalized-devnet-refund-canary' }));
  const roundWindow = jackpotWindow(Math.floor(Date.now() / 1000) - 86_400);
  const receipts = [];
  for (const [kind, vault, winner, amountLamports] of [
    ['creator', creatorVault, creator, 1_000_000],
    ['trader', traderVault, trader, 2_000_000],
  ]) {
    // Fund exactly the payout plus its quoted transaction fee so the
    // temporary system vault closes to zero without violating rent rules.
    const feeReserveLamports = await quotedTransferFee(vault.publicKey,
      recipientKey(winner), amountLamports);
    const fundingTransferLamports = amountLamports + feeReserveLamports;
    const fundingSignature = await sendFinalizedTransfer(testFeeSource,
      vault.publicKey, fundingTransferLamports, `${kind} vault funding`);
    await verifyFinalizedTransfer(fundingSignature,
      testFeeSource.publicKey, vault.publicKey, fundingTransferLamports, `${kind} vault funding`);
    console.log(JSON.stringify({ kind, fundingSignature,
      vault:vault.publicKey.toBase58(), prizeLamports:amountLamports,
      feeReserveLamports, fundingTransferLamports,
      status:'finalized-devnet-test-funding', feeBacked:false }));
    const round = { id:`${kind}:${roundWindow.start}`, cluster:'devnet',
      status:'drawn', windowEnd:roundWindow.end,
      vault:vault.publicKey.toBase58(), winner:recipientKey(winner).toBase58(),
      prizeLamports:String(amountLamports) };
    const signature = await sendFinalizedTransfer(vault,
      recipientKey(winner), amountLamports, `${kind} test payout`);
    await finalizedTransaction(signature);
    const receipt = await verifyJackpotPayoutOnchain({ connection,
      expectedGenesisHash:genesis, round, signature, existingReceipts:receipts });
    assert.equal(receipt.status, 'paid');
    receipts.push(receipt);
    console.log(JSON.stringify({ kind, signature, winner:receipt.winner,
      amountLamports:receipt.amountLamports, status:receipt.status }));
  }
  assert.equal(receipts.length, 2);
} catch (error) { payoutError = error; }
finally { await refundTestBalances(); }
if (payoutError) throw payoutError;
console.log('Real Devnet test funding and payout legs passed with separate ephemeral vaults. Funding was faucet or manual test SOL, not verified app fees; no launch or trade entries were indexed.');
