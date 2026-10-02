import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

const destination = new PublicKey(process.argv[2]);
const amountLamports = 4_000_000;
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
assert.equal(process.env.DEVNET_TEST_MODE, 'true');
const source = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY || ''));
const manifest = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
assert.equal(source.publicKey.toBase58(), manifest.find(row =>
  row.role === 'referrer' && row.cluster === 'devnet')?.address,
'Funding source must be the rotated Devnet QA referrer wallet.');
assert(!source.publicKey.equals(destination), 'Test source and destination must differ.');
const connection = new Connection('https://api.devnet.solana.com', 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const [sourceBefore, destinationBefore, latest] = await Promise.all([
  connection.getBalance(source.publicKey, 'finalized'),
  connection.getBalance(destination, 'finalized'),
  connection.getLatestBlockhash('finalized'),
]);
assert(sourceBefore > amountLamports + 100_000_000, 'Keep at least 0.1 Devnet SOL in the QA referrer wallet.');
assert.equal(destinationBefore, 0, 'The destination must be a fresh empty temporary test wallet.');
const transaction = new Transaction({ recentBlockhash:latest.blockhash,
  feePayer:source.publicKey }).add(SystemProgram.transfer({
  fromPubkey:source.publicKey, toPubkey:destination, lamports:amountLamports }));
transaction.sign(source);
const signature = bs58.encode(transaction.signature);
try { await connection.sendRawTransaction(transaction.serialize()); }
catch (error) { console.error(`Submission outcome uncertain for ${signature}: ${error.message}. Reconciling without resending.`); }
let finalized;
for (;;) {
  let status; let height;
  try {
    [finalized, status, height] = await Promise.all([
      connection.getParsedTransaction(signature,
        { commitment:'finalized', maxSupportedTransactionVersion:0 }),
      connection.getSignatureStatuses([signature], { searchTransactionHistory:true })
        .then(result => result.value[0]),
      connection.getBlockHeight('finalized'),
    ]);
  } catch (error) {
    console.error(`RPC reconciliation pending for ${signature}: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 2_000));
    continue;
  }
  if (finalized?.meta?.err || status?.err) throw new Error(`Funding transaction ${signature} failed on Devnet.`);
  if (finalized) break;
  if (height > latest.lastValidBlockHeight && !status)
    throw new Error(`Funding transaction ${signature} expired without finalization.`);
  await new Promise(resolve => setTimeout(resolve, 2_000));
}
const keys = finalized.transaction.message.accountKeys;
const key = row => typeof row.pubkey === 'string' ? row.pubkey : row.pubkey?.toBase58?.();
const sourceIndex = keys.findIndex(row => key(row) === source.publicKey.toBase58());
const destinationIndex = keys.findIndex(row => key(row) === destination.toBase58());
const instruction = finalized.transaction.message.instructions[0];
assert(keys[sourceIndex]?.signer === true && destinationIndex >= 0
  && finalized.transaction.message.instructions.length === 1
  && instruction.program === 'system' && instruction.parsed?.type === 'transfer'
  && instruction.parsed.info.source === source.publicKey.toBase58()
  && instruction.parsed.info.destination === destination.toBase58()
  && String(instruction.parsed.info.lamports) === String(amountLamports)
  && finalized.meta.postBalances[destinationIndex] - finalized.meta.preBalances[destinationIndex] === amountLamports
  && finalized.meta.preBalances[sourceIndex] - finalized.meta.postBalances[sourceIndex]
    === amountLamports + finalized.meta.fee,
'Finalized funding transfer and balance changes must match.');
const destinationAfter = await connection.getBalance(destination, 'finalized');
assert.equal(destinationAfter - destinationBefore, amountLamports, 'Temporary test wallet balance did not increase as expected.');
console.log(JSON.stringify({ status:'finalized-devnet-test-funding',
  signature, source:source.publicKey.toBase58(), destination:destination.toBase58(),
  amountLamports, destinationBefore, destinationAfter }));
