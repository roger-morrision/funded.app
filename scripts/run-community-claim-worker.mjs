import { readFile, writeFile } from 'node:fs/promises';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';
import { verifyPumpMigrationTransaction } from '../server/community-snapshot.mjs';
import { rpcQuotaExhausted, rpcWorkerWaitMs } from '../rpc-retry.js';

import { workerHeartbeatHealth, workerFailureReport } from '../server/worker-readiness.mjs';

const heartbeat = '/tmp/funded-community-claim-worker-status.json';
const configuredInterval = Number(process.env.FUNDED_COMMUNITY_CLAIM_TICK_MS || 20_000);
if (!Number.isFinite(configuredInterval) || configuredInterval <= 0) throw new Error('Community worker interval must be a finite positive number.');
const intervalMs = Math.max(15_000, configuredInterval);
const api = String(process.env.FUNDED_COMMUNITY_CLAIM_API || 'http://app:8787').replace(/\/$/, '');
const expectedHash = String(process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 || '').toLowerCase();
if (process.argv.includes('--check')) {
  let status = null;
  try { status = JSON.parse(await readFile(heartbeat, 'utf8')); } catch { /* Missing or partial status is unavailable. */ }
  const health = workerHeartbeatHealth(status, { maxAgeMs: intervalMs * 3 + 30_000, expectedCluster: 'devnet' });
  if (process.env.SOLANA_CLUSTER !== 'devnet') { health.healthy = false; health.reasons.push('worker-configuration-is-not-devnet'); }
  console.log(JSON.stringify(health));
  if (!health.healthy) process.exitCode = 1;
} else {
  if (process.env.SOLANA_CLUSTER !== 'devnet' || !/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error('Pinned Devnet program identity is required for automatic community claims.');
  const token = (await readFile(process.env.FUNDED_API_TOKEN_FILE, 'utf8')).trim();
  const authority = Keypair.fromSecretKey(bs58.decode((await readFile(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY_FILE, 'utf8')).trim()));
  const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
  if (!token || authority.publicKey.toBase58() !== process.env.FUNDED_REWARD_AUTHORITY)
    throw new Error('Community worker API token or reward authority identity is invalid.');
  const rpcUrl = (await readFile(process.env.SOLANA_RPC_URL_FILE, 'utf8')).trim();
  const connection = new Connection(rpcUrl, 'finalized');
  async function request(path, payload) {
    const response = await fetch(`${api}${path}`, { method:payload ? 'POST' : 'GET',
      headers:{ authorization:`Bearer ${token}`, ...(payload ? { 'content-type':'application/json' } : {}) },
      body:payload ? JSON.stringify(payload) : undefined,
      signal:AbortSignal.timeout(payload ? 90_000 : 60_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${String(data.error || 'request failed').slice(0, 200)}`);
    return data;
  }
  async function reviewedProgram() {
    const [genesis, evidence] = await Promise.all([connection.getGenesisHash(), readProgramDataEvidence(connection, programId)]);
    if (genesis !== DEVNET_GENESIS_HASH || !evidence.account?.executable || evidence.sha256 !== expectedHash)
      throw new Error('Current program bytes do not match the reviewed Devnet build.');
  }
  async function findMigration(mint) {
    const launchMint = new PublicKey(mint);
    const pool = canonicalPumpPoolPda(launchMint, NATIVE_MINT);
    const currentSlot = await connection.getSlot('finalized');
    let before;
    for (let page = 0; page < 3; page += 1) {
      const signatures = await connection.getSignaturesForAddress(pool, { limit:100, ...(before ? { before } : {}) }, 'finalized');
      for (const row of signatures) {
        if (row.slot < currentSlot - 256) return null;
        if (row.err) continue;
        const transaction = await connection.getTransaction(row.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
        if (!transaction?.meta || transaction.meta.err) continue;
        try { verifyPumpMigrationTransaction({ transaction, launchMint }); return row.signature; }
        catch { /* The pool's ordinary swap is not a migration receipt. */ }
      }
      if (signatures.length < 100) break;
      before = signatures.at(-1).signature;
    }
    return null;
  }
  async function reconcileOpening(mint, drop) {
    const address = new PublicKey(drop);
    if (!await connection.getAccountInfo(address, 'finalized')) return false;
    const signatures = await connection.getSignaturesForAddress(address, { limit:30 }, 'finalized');
    for (const row of signatures) {
      if (row.err) continue;
      try { await request('/api/airdrops/claims/opening-receipt', { mint, signature:row.signature }); return true; }
      catch { /* A claim or failed candidate is not the atomic opening receipt. */ }
    }
    throw new Error(`CommunityDrop ${drop} exists without a verified opening receipt; operator review required.`);
  }
  async function open(mint, drop) {
    if (await reconcileOpening(mint, drop)) return 'recovered';
    const prepared = await request('/api/airdrops/claims/opening-instruction', { mint });
    if (prepared.drop !== drop || prepared.programId !== programId.toBase58()) throw new Error('Opening instruction differs from prepared drop.');
    const accounts = prepared.accounts.map(row => ({ pubkey:new PublicKey(row.pubkey), isSigner:row.isSigner, isWritable:row.isWritable }));
    if (accounts.filter(row => row.isSigner).length !== 1 || !accounts[0].pubkey.equals(authority.publicKey) || !accounts[0].isSigner)
      throw new Error('Opening instruction requested an unexpected signer.');
    await reviewedProgram();
    const instruction = new TransactionInstruction({ programId, keys:accounts, data:Buffer.from(prepared.data, 'base64') });
    const signature = await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [authority], { commitment:'finalized' });
    await request('/api/airdrops/claims/opening-receipt', { mint, signature });
    return 'opened';
  }
  async function tick() {
    await reviewedProgram();
    const reserves = await request('/api/airdrops/reserves');
    if (reserves.cluster !== 'devnet') throw new Error('Community reserve API is not Devnet.');
    let prepared = 0, opened = 0, recovered = 0;
    for (const reserve of reserves.reserves || []) {
      if (reserve.claimPreparation === 'prepared' && (reserve.status !== 'funded' || reserve.verified !== true)) {
        const status = await request(`/api/airdrops/claims/status?mint=${encodeURIComponent(reserve.mint)}`);
        if (status.status === 'prepared' && status.drop && await reconcileOpening(reserve.mint, status.drop)) recovered += 1;
        continue;
      }
      if (reserve.status !== 'funded' || reserve.verified !== true || reserve.claimPreparation === 'opened') continue;
      const mint = reserve.mint;
      let status = await request(`/api/airdrops/claims/status?mint=${encodeURIComponent(mint)}`);
      if (status.status === 'unprepared') {
        const migrationSignature = await findMigration(mint);
        if (!migrationSignature) continue;
        await request('/api/airdrops/claims/prepare', { mint, migrationSignature });
        prepared += 1;
        status = await request(`/api/airdrops/claims/status?mint=${encodeURIComponent(mint)}`);
      }
      if (status.status !== 'prepared' || !status.drop) continue;
      const result = await open(mint, status.drop);
      if (result === 'opened') opened += 1;
      else recovered += 1;
    }
    const report = { status:'ready', cluster:'devnet', at:new Date().toISOString(), funded:(reserves.reserves || []).filter(row => row.status === 'funded').length,
      prepared, opened, recovered };
    await writeFile(heartbeat, JSON.stringify(report));
    console.log(JSON.stringify(report));
  }
  for (;;) {
    let waitMs = intervalMs;
    try { await tick(); }
    catch (error) {
      const quotaExhausted = rpcQuotaExhausted(error);
      if (quotaExhausted) {
        waitMs = rpcWorkerWaitMs(error, intervalMs);
      }
      await writeFile(heartbeat, JSON.stringify(workerFailureReport({ quotaExhausted, retryAfterMs: waitMs }))).catch(() => {});
      console.error(`Community claim worker: ${String(error.message || error)}${quotaExhausted ? `; retry after ${waitMs}ms` : ''}`);
    }
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}
