// Read-only acceptance of the deployed Devnet app's migration-gated community
// records and exact recipient token deltas. Run inside the Devnet app container.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { rewardLedgerPath } from '../server/reward-ledger-path.mjs';
import { verifyPumpMigrationTransaction } from '../server/community-snapshot.mjs';
import { readCommunityReserveStatus, verifiedCommunityClaimedWalletCount } from '../server/community-reserve-status.mjs';
import { buildCommunityClaimInstruction, supportsProgramRecipients } from '../server/community-claim-chain.mjs';
import { verifyCommunityDelivery } from '../server/community-delivery-proof.mjs';

assert.equal(process.env.SOLANA_CLUSTER, 'devnet');
const programId = new PublicKey(process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID);
const expectedHash = process.env.FUNDED_V3_PROGRAM_DATA_SHA256;
assert.match(expectedHash || '', /^[a-f0-9]{64}$/);
const connection = new Connection(process.env.SOLANA_RPC_URL,
  { commitment:'finalized', disableRetryOnRateLimit:true });
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const program = await readProgramDataEvidence(connection, programId);
assert(program.account?.executable && program.sha256 === expectedHash,
  'The deployed program bytes differ from the pinned Devnet release.');

const ledger = await createAutomaticRewardStore(rewardLedgerPath()).read();
const db = new pg.Client({ connectionString:readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim() });
await db.connect();
let rows;
try {
  await db.query('BEGIN READ ONLY');
  rows = (await db.query(`SELECT bucket, entity_key, payload FROM state_entities
    WHERE bucket IN ('launches','communityReserveReceipts','communityExecutions')`)).rows;
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { await db.end(); }
const records = bucket => new Map(rows.filter(row => row.bucket === bucket)
  .map(row => [row.entity_key, row.payload]));
const launches = records('launches'), receipts = records('communityReserveReceipts');
const executions = records('communityExecutions');
const drops = [], payments = [];
for (const [mint, record] of Object.entries(ledger.communityDrops || {})) {
  assert.equal(record.programId, programId.toBase58());
  const launch = launches.get(mint);
  assert(launch?.onchainVerified && launch.cluster === 'devnet');
  const fundingSignature = receipts.get(mint)?.signature || record.fundingSignature;
  const status = await readCommunityReserveStatus({ connection, programId,
    authority:record.authority, fundingAuthority:launch.creatorWallet, mint,
    reservedTokens:Number(launch.communityAirdrop?.reservedTokens),
    fundingSignature, expectedEligibilityMint:record.eligibilityMint,
    dropOpeningSignature:record.openingSignature });
  assert.equal(status.verified, true, `${mint}: reserve or drop is not verified.`);
  if (record.snapshotBasis === 'pump-migration') {
    const tx = await connection.getTransaction(record.migrationSignature,
      { commitment:'finalized', maxSupportedTransactionVersion:0 });
    const migration = verifyPumpMigrationTransaction({ transaction:tx, launchMint:mint });
    assert.equal(migration.slot, record.snapshot.slot);
  }
  if (record.openingSignature) {
    assert(['drop-active','drop-closed'].includes(status.status));
    assert.equal(status.dropOpeningSignature, record.openingSignature);
    assert.equal(status.merkleRoot, record.manifest.root);
    assert.equal(status.snapshotHash, record.manifest.snapshotHash);
    assert.equal(status.migrationSlot, record.snapshot.slot);
    assert.equal(status.leafCount, record.manifest.leaves.length);
    const count = await verifiedCommunityClaimedWalletCount({ connection, programId,
      drop:status.drop, claimedBaseUnits:status.claimedBaseUnits, leafCount:status.leafCount });
    status.claimedWalletCount = count;
  } else assert.equal(status.status, 'funded');
  drops.push({ mint, basis:record.snapshotBasis, migrationSlot:record.snapshot.slot,
    openingSignature:record.openingSignature, status:status.status,
    reservedBaseUnits:record.reservedBaseUnits, claimedBaseUnits:status.claimedBaseUnits || '0',
    claimedWalletCount:status.claimedWalletCount || 0, leafCount:record.manifest.leaves.length,
    expired:Math.floor(Date.now()/1000) >= record.manifest.expiresAt });
}
for (const [key, row] of executions) {
  if (row.status !== 'finalized' || row.intent?.action === 'open') continue;
  const record = ledger.communityDrops?.[row.intent?.mint];
  assert(record?.openingSignature, `${key}: drop did not open.`);
  const recipient = row.intent.action;
  const leaf = record.manifest.leaves.find(item => item.recipient === recipient);
  assert(leaf, `${key}: recipient is absent from the immutable manifest.`);
  const built = buildCommunityClaimInstruction({ programId, authority:record.authority,
    mint:record.mint, tokenProgram:record.tokenProgram, manifest:record.manifest,
    recipient, payer:record.authority, allowProgramRecipient:supportsProgramRecipients(record) });
  const proof = await verifyCommunityDelivery({ connection, signature:row.signature,
    built, programId:programId.toBase58(), recipient, index:leaf.index });
  assert(proof?.finalized && proof.balanceDeltaVerified);
  if (row.proof) {
    assert.equal(proof.amount, row.proof.amount);
    assert.equal(proof.payment, row.proof.payment);
  }
  payments.push({ mint:record.mint, signature:proof.signature, recipient,
    amountBaseUnits:proof.amount, payment:proof.payment });
}
console.log(JSON.stringify({ schemaVersion:1, scope:'read-only finalized Devnet community re-verification',
  checkedAt:new Date().toISOString(), programId:programId.toBase58(),
  programDataSha256:program.sha256, drops, payments }, null, 2));
