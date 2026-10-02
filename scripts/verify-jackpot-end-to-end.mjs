import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair, SystemInstruction, SystemProgram, Transaction } from '@solana/web3.js';
import { jackpotWindow, jackpotContribution } from '../server/jackpot-model.mjs';
import { prepareJackpotRound, settleJackpotRound,
  verifyJackpotPayoutOnchain } from '../server/jackpot-round.mjs';

// Public, deterministic test fixtures. Never fund these keys: the ledger,
// entropy, transfer, and finalized RPC response are all mocked in this process.
const hash = value => createHash('sha256').update(`funded-jackpot-fixture:${value}`).digest();
const fixtureKeypair = label => Keypair.fromSeed(hash(`key:${label}`));
let signatureNumber = 0;
const sig = () => {
  signatureNumber += 1;
  return bs58.encode(Buffer.concat([hash(`signature:${signatureNumber}:a`),
    hash(`signature:${signatureNumber}:b`)]));
};
const epoch = 1_728_000_000;
const window = jackpotWindow(epoch);
const vault = fixtureKeypair('vault');
const creatorA = fixtureKeypair('creator-a');
const creatorB = fixtureKeypair('creator-b');
const traderA = fixtureKeypair('trader-a');
const traderB = fixtureKeypair('trader-b');
const wallets = [creatorA, creatorB, traderA, traderB];
const balances = new Map([[vault.publicKey.toBase58(), 0n],
  ...wallets.map(key => [key.publicKey.toBase58(), 0n])]);
const paid = [];

function receipt(kind, sourceFeeLamports, blockTime) {
  const transferLamports = jackpotContribution(sourceFeeLamports, kind === 'creator' ? 100 : 500);
  const row = { kind, cluster:'devnet', signature:sig(), finalized:true,
    onchainVerified:true, feeSourceVerified:true, vault:vault.publicKey.toBase58(),
    sourceSignatures:[sig()], sourceFeeLamports, transferLamports, blockTime };
  balances.set(row.vault, balances.get(row.vault) + BigInt(transferLamports));
  return row;
}

async function payout(round) {
  const winner = round.winner;
  const amount = BigInt(round.prizeLamports);
  const beforeVault = balances.get(round.vault);
  const beforeWinner = balances.get(winner);
  assert.ok(beforeVault >= amount);
  const tx = new Transaction({ recentBlockhash:fixtureKeypair('blockhash').publicKey.toBase58(),
    feePayer:vault.publicKey }).add(SystemProgram.transfer({ fromPubkey:vault.publicKey,
    toPubkey:winner, lamports:Number(amount) }));
  tx.sign(vault);
  const parsed = Transaction.from(tx.serialize());
  assert.equal(parsed.verifySignatures(), true);
  assert.equal(parsed.instructions.length, 1);
  const decoded = SystemInstruction.decodeTransfer(parsed.instructions[0]);
  assert.equal(decoded.fromPubkey.toBase58(), round.vault);
  assert.equal(decoded.toPubkey.toBase58(), winner);
  assert.equal(BigInt(decoded.lamports), amount);
  balances.set(round.vault, beforeVault - amount);
  balances.set(winner, beforeWinner + amount);
  const proof = { signature:bs58.encode(parsed.signature), cluster:'devnet',
    commitment:'finalized', transactionSucceeded:true,
    balanceDeltaVerified:balances.get(winner) - beforeWinner === amount
      && beforeVault - balances.get(round.vault) === amount,
    from:round.vault, to:winner, amountLamports:amount.toString(),
    blockTime:window.end + 20 };
  const accountKeys = parsed.compileMessage().accountKeys.map((pubkey, index) =>
    ({ pubkey, signer:index === 0 }));
  const keyStrings = accountKeys.map(row => row.pubkey.toBase58());
  const fromIndex = keyStrings.indexOf(round.vault);
  const toIndex = keyStrings.indexOf(winner);
  const preBalances = accountKeys.map(() => 0);
  const postBalances = accountKeys.map(() => 0);
  preBalances[fromIndex] = Number(beforeVault);
  postBalances[fromIndex] = Number(beforeVault - amount);
  preBalances[toIndex] = Number(beforeWinner);
  postBalances[toIndex] = Number(beforeWinner + amount);
  const parsedTx = { blockTime:proof.blockTime, meta:{ err:null, fee:0,
    preBalances, postBalances }, transaction:{ message:{ accountKeys,
    instructions:[{ program:'system', parsed:{ type:'transfer', info:{
      source:round.vault, destination:winner, lamports:Number(amount) } } }] } } };
  const rpc = { getGenesisHash:async () => 'mock-devnet-genesis',
    getParsedTransaction:async () => parsedTx };
  const check = { connection:rpc, expectedGenesisHash:'mock-devnet-genesis',
    round, signature:proof.signature, existingReceipts:paid };
  assert.throws(() => settleJackpotRound(round,
    { ...proof, balanceDeltaVerified:false }, []), /matching finalized/);
  await assert.rejects(verifyJackpotPayoutOnchain({ ...check,
    expectedGenesisHash:'wrong-genesis' }), /wrong Solana cluster/);
  await assert.rejects(verifyJackpotPayoutOnchain({ ...check,
    connection:{ ...rpc, getParsedTransaction:async () => ({ ...parsedTx,
      meta:{ ...parsedTx.meta, postBalances:[...postBalances].map((value, index) =>
        index === toIndex ? value - 1 : value) } }) } }), /balance changes/);
  const result = await verifyJackpotPayoutOnchain(check);
  paid.push(result);
  return { result, proof };
}

function entries(kind, owners) {
  return owners.map((owner, index) => ({ cluster:'devnet', finalized:true,
    onchainVerified:true, blockTime:window.start + 10 + index,
    ...(kind === 'creator' ? { creatorWallet:owner.publicKey.toBase58(),
      mint:fixtureKeypair(`${kind}-mint-${index}`).publicKey.toBase58() } : {
      traderWallet:owner.publicKey.toBase58(), signature:sig(),
      feeTransferVerified:true, feeLamports:'10000' }) }));
}

for (const [kind, owners, sourceFees] of [
  ['creator', [creatorA, creatorA, creatorB], ['1000000000', '2000000000']],
  ['trader', [traderA, traderB, traderA, traderA], ['100000000', '200000000']],
]) {
  const entryReceipts = entries(kind, owners);
  const contributionReceipts = sourceFees.map((amount, index) =>
    receipt(kind, amount, window.start + 30 + index));
  const entropyProof = { cluster:'devnet', finalized:true, independent:true,
    sourceSignature:sig(), blockTime:window.end + 1,
    entropyHex:hash(`entropy:${kind}`).toString('hex') };
  const input = { kind, window, nowSeconds:window.end + 2, entryReceipts,
    contributionReceipts, entropyProof, vault:vault.publicKey.toBase58() };
  assert.throws(() => prepareJackpotRound({ ...input, nowSeconds:window.end - 1 }), /not closed/);
  assert.throws(() => prepareJackpotRound({ ...input, entropyProof:{ ...entropyProof,
    blockTime:window.end - 1 } }), /entropy/);
  assert.throws(() => prepareJackpotRound({ ...input,
    contributionReceipts:[...contributionReceipts, contributionReceipts[0]] }), /duplicate/);
  assert.throws(() => prepareJackpotRound({ ...input,
    contributionReceipts:[...contributionReceipts, { ...contributionReceipts[0],
      signature:sig() }] }), /duplicate/);
  assert.throws(() => prepareJackpotRound({ ...input,
    contributionReceipts:[{ ...contributionReceipts[0], transferLamports:'1' }] }), /funding/);
  if (kind === 'creator') {
    const aggregated = { ...contributionReceipts[0], sourceFeeLamports:'199',
      transferLamports:'1', sourceSignatures:[sig(), sig()] };
    assert.equal(prepareJackpotRound({ ...input,
      contributionReceipts:[aggregated] }).prizeLamports, '1');
  }
  const round = prepareJackpotRound(input);
  assert.equal(round.entryCount, owners.length);
  const selectedReceipt = entryReceipts.find(row =>
    (kind === 'creator' ? row.mint : row.signature) === round.selectedEntry);
  assert.ok(selectedReceipt, 'Draw must select an eligible receipt');
  assert.equal(round.winner, kind === 'creator'
    ? selectedReceipt.creatorWallet : selectedReceipt.traderWallet);
  assert.equal(round.prizeLamports, contributionReceipts.reduce((sum, row) =>
    sum + BigInt(row.transferLamports), 0n).toString());
  assert.deepEqual(prepareJackpotRound({ ...input, entryReceipts:[...entryReceipts].reverse(),
    contributionReceipts:[...contributionReceipts].reverse() }), round);
  const { result, proof } = await payout(round);
  assert.equal(result.winner, round.winner);
  assert.equal(result.amountLamports, round.prizeLamports);
  assert.throws(() => settleJackpotRound(round, proof, paid), /already recorded/);
  assert.throws(() => settleJackpotRound(round,
    { ...proof, amountLamports:'1' }, []), /matching finalized/);
  console.log(JSON.stringify({ mode:'mocked-local', kind, roundId:round.id,
    entries:round.entryCount, prizeLamports:round.prizeLamports,
    winner:round.winner, selectedEntry:round.selectedEntry,
    entrySnapshot:round.entrySnapshot, fundingSnapshot:round.fundingSnapshot,
    entropyHex:round.entropyHex, entropySource:round.entropySource,
    drawHash:round.drawHash, payoutSignature:result.signature,
    payoutStatus:'finalized-mock-receipt' }));
}
assert.equal(paid.length, 2);
assert.equal(balances.get(vault.publicKey.toBase58()), 0n);
console.log('Jackpot end-to-end: both isolated mocked Devnet flows passed; no RPC or real SOL used.');
