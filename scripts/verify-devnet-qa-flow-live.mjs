import assert from 'node:assert/strict';
import { Connection, PublicKey } from '@solana/web3.js';
import { verifyMintFeeRouterAccount } from '../fee-router.js';

const mint = new PublicKey(String(process.argv[2] || '')).toBase58();
const programId = new PublicKey(String(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || ''));
const rpcUrl = String(process.env.SOLANA_RPC_URL || '').trim();
const origin = String(process.env.FUNDED_VERIFY_ORIGIN || 'https://funded.vip').replace(/\/$/, '');
assert(rpcUrl, 'SOLANA_RPC_URL is required for independent finalized Devnet reads.');
const connection = new Connection(rpcUrl, 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');

async function publicJson(path) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  assert.equal(response.status, 200, path + ' must be publicly available');
  return response.json();
}

const [launches, activity, buyback] = await Promise.all([
  publicJson('/api/launches'),
  publicJson('/api/tokens/' + mint + '/fee-activity'),
  publicJson('/api/buyback/status'),
]);
const launch = launches.find(row => row.mint === mint);
assert(launch?.onchainVerified && launch.cluster === 'devnet', 'Launch must be verified on Devnet.');
const router = await verifyMintFeeRouterAccount({ connection, programId, mint });
assert.equal(router.verified, true, 'The current-program mint router must be verified on-chain.');
assert.equal(router.address.toBase58(), launch.pumpFeeRoute?.router);
assert.equal(activity.cluster, 'devnet');

const collections = [];
for (const row of activity.collections || []) {
  const transaction = await connection.getParsedTransaction(row.signature, {
    commitment: 'finalized', maxSupportedTransactionVersion: 0,
  });
  assert(transaction && transaction.meta?.err === null, 'Collection must be finalized: ' + row.signature);
  const index = transaction.transaction.message.accountKeys
    .findIndex(key => key.pubkey.toBase58() === router.address.toBase58());
  assert(index >= 0, 'Collection omitted the verified mint router.');
  const credit = BigInt(transaction.meta.postBalances[index]) - BigInt(transaction.meta.preBalances[index]);
  assert.equal(credit, BigInt(row.collectedLamports), 'Router credit differs from indexed collection.');
  collections.push({ signature: row.signature, creditedLamports: credit.toString() });
}
assert(collections.length > 0, 'No finalized fee collection exists for this mint.');

const payouts = [];
for (const receiver of activity.overview?.receivers || []) {
  const claimed = BigInt(receiver.confirmedPaidLamports || '0');
  if (claimed === 0n) continue;
  let observed = 0n;
  for (const signature of receiver.payoutSignatures || []) {
    const transaction = await connection.getParsedTransaction(signature, {
      commitment: 'finalized', maxSupportedTransactionVersion: 0,
    });
    assert(transaction && transaction.meta?.err === null, 'Payout must be finalized: ' + signature);
    const index = transaction.transaction.message.accountKeys
      .findIndex(key => key.pubkey.toBase58() === receiver.recipient);
    assert(index >= 0, 'Payout omitted the named recipient: ' + receiver.id);
    const credit = BigInt(transaction.meta.postBalances[index]) - BigInt(transaction.meta.preBalances[index]);
    assert(credit > 0n, 'Recipient balance did not increase: ' + receiver.id);
    observed += credit;
  }
  assert.equal(observed, claimed, 'Recipient credits differ from public paid total: ' + receiver.id);
  payouts.push({ id: receiver.id, creditedLamports: observed.toString(), signatures: receiver.payoutSignatures });
}

const pending = (buyback.pending || []).find(row => row.mint === mint);
const receipts = (buyback.receipts || []).filter(row => row.mint === mint);
console.log(JSON.stringify({
  verification: 'finalized-devnet-state',
  mint,
  programId: programId.toBase58(),
  router: router.address.toBase58(),
  collections,
  payouts,
  unpaid: (activity.overview?.receivers || []).filter(row => BigInt(row.allocatedLamports || '0')
    > BigInt(row.confirmedPaidLamports || '0')).map(row => ({
      id: row.id,
      allocatedLamports: row.allocatedLamports,
      confirmedPaidLamports: row.confirmedPaidLamports,
    })),
  buyback: { pendingLamports: pending?.pendingLamports || '0', receiptCount: receipts.length },
}));
