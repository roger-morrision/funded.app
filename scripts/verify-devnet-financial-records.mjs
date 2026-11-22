// Read-only acceptance of the deployed app's finalized paired conversions and
// own-coin milestone buybacks. Run inside the Devnet app container via stdin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';
import { verifyStoredPairedBonusConversion } from '../server/daily-bonus-paired-conversion.mjs';
import { loadFinalizedV3Buyback } from '../server/v3-buyback-proof.mjs';

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

const db = new pg.Client({ connectionString:readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim() });
await db.connect();
let rows;
try {
  await db.query('BEGIN READ ONLY');
  rows = (await db.query(`SELECT bucket, entity_key, payload FROM state_entities
    WHERE bucket IN ('v3TokenBonusConversions','v3TokenBonusSources','v3AgencyExecutions','launches')`)).rows;
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { await db.end(); }
const byBucket = bucket => rows.filter(row => row.bucket === bucket);
const sources = new Map(byBucket('v3TokenBonusSources').map(row => [row.entity_key, row.payload]));
const launches = new Map(byBucket('launches').map(row => [row.entity_key, row.payload]));
const conversions = [], milestones = [];
for (const row of byBucket('v3TokenBonusConversions')) {
  const conversion = row.payload;
  assert.equal(conversion.status, 'finalized', `Conversion ${row.entity_key} is not finalized.`);
  const { proof, allocations } = await verifyStoredPairedBonusConversion({
    connection, programId:programId.toBase58(), conversion, sources,
  });
  assert.equal(proof.balanceDeltaVerified, true);
  conversions.push({ id:row.entity_key, signature:proof.signature, slot:proof.slot,
    mint:proof.mint, spentQuoteRaw:proof.spentQuoteRaw,
    receivedLamports:proof.receivedLamports, allocationCount:allocations.length });
}
for (const row of byBucket('v3AgencyExecutions')) {
  const saved = row.payload, intent = saved.intent, evidence = saved.evidence;
  assert.equal(saved.status, 'finalized', `Agency execution ${row.entity_key} is not finalized.`);
  assert.equal(intent?.programId, programId.toBase58());
  const launch = launches.get(intent.mint);
  assert.equal(launch?.pumpFeeRoute?.scope, 'per-mint-v3');
  const execution = { ...evidence.agencyExecution,
    observationHash:Buffer.from(evidence.agencyExecution.observationHash, 'hex') };
  const pumpBuyInstruction = new TransactionInstruction({
    programId:new PublicKey(evidence.pump.programId),
    data:Buffer.from(evidence.pump.data, 'base64'),
    keys:evidence.pump.keys.map(key => ({ ...key, pubkey:new PublicKey(key.pubkey) })),
  });
  const buybackId = createHash('sha256')
    .update(`funded.agency.own-coin.v1:${intent.mint}:${intent.agent}`).digest();
  const proof = await loadFinalizedV3Buyback({
    connection, signature:saved.signature, programId, sourceMint:intent.mint,
    creator:intent.creator, initialAuthority:intent.initialAuthority,
    authority:intent.initialAuthority, priceSigner:evidence.priceSigner,
    buybackId, agencyPolicy:true, agencyExecution:execution,
    split:launch.pumpFeeRoute.protocolSplit,
    baseTokenProgram:evidence.baseTokenProgram,
    spendableQuoteIn:evidence.spendableQuoteIn,
    minBaseAmountOut:evidence.minBaseAmountOut,
    maxTotalDebit:evidence.maxTotalDebit, pumpBuyInstruction,
  });
  assert(proof && proof.balanceDeltaVerified && proof.vaultDebitVerified
    && proof.burnInstructionVerified, `Agency execution ${row.entity_key} lacks a complete finality proof.`);
  for (const field of ['signature','receipt','pool','spentLamports','burnedBaseUnits'])
    assert.equal(proof[field], saved.proof?.[field], `${row.entity_key}: ${field} changed.`);
  assert.equal(proof.category, 7);
  assert.equal(proof.agent, intent.agent);
  milestones.push({ key:row.entity_key, signature:proof.signature, slot:proof.slot,
    mint:intent.mint, agent:intent.agent, spentLamports:proof.spentLamports,
    burnedBaseUnits:proof.burnedBaseUnits });
}
console.log(JSON.stringify({ schemaVersion:1, scope:'read-only finalized Devnet financial re-verification',
  checkedAt:new Date().toISOString(), programId:programId.toBase58(),
  programDataSha256:program.sha256, conversions, milestones }, null, 2));
