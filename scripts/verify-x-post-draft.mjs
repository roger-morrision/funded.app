import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPostgresStore } from '../server/postgres-store.mjs';
import bs58 from 'bs58';

assert.equal(process.env.X_POST_DB_TEST, '1');
const databaseUrl = process.env.X_POST_TEST_DATABASE_URL;
const target = new URL(databaseUrl);
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '15433'); assert.equal(target.pathname, '/funded_x_test');
const directory = await mkdtemp(join(tmpdir(), 'funded-x-draft-'));
const trap = join(directory, 'network-trap.mjs');
const evidence = join(directory, 'requests.json');
const store = createPostgresStore(databaseUrl);
try {
  // Include an otherwise eligible launch so zero traffic cannot be explained by an empty source ledger.
  const mint = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  const signature = bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => i + 1));
  await store.update(state => { state.launches[mint] = { mint, signature, name: 'Offline draft fixture', cluster: 'devnet', onchainVerified: true, createdTimestamp: Math.floor(Date.now() / 1000) - 10,
    creatorLaunchBurn: { tier: 'pro', status: 'verified', amountTokens: 100, fundedMint: mint,
      receipt: { signature, verified: true, atomicWithPumpLaunch: true } } }; });
  await writeFile(trap, `
    import http from 'node:http'; import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module'; import { writeFileSync } from 'node:fs';
    const calls=[];
    const blocked=(input)=>{let host;try{host=new URL(typeof input==='string'?input:input?.href).hostname;}catch{host=input?.hostname||input?.host||'unknown';}calls.push(String(host));throw new Error('Outbound HTTP blocked by draft verification fixture');};
    globalThis.fetch=blocked;http.request=blocked;http.get=blocked;https.request=blocked;https.get=blocked;syncBuiltinESMExports();
    process.on('exit',()=>writeFileSync(${JSON.stringify(evidence)},JSON.stringify(calls)));
  `);
  const outputs = [];
  for (const args of [[], ['--status']]) {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(trap).href, 'scripts/run-x-post-worker.mjs', ...args], {
      cwd: new URL('..', import.meta.url), timeout: 15_000, encoding: 'utf8',
      env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, SOLANA_CLUSTER: 'devnet', X_POST_EXPECTED_HANDLE: 'draftfixture', X_POST_PUBLIC_ORIGIN: 'https://funded.vip', X_POST_START_AT: '2026-10-01T00:00:00.000Z', AUTOMATIC_REWARD_STORE_PATH: join(directory, 'missing-ledger.json') },
    });
    assert.equal(result.status, 0, result.stderr);
    const requests = JSON.parse(await readFile(evidence, 'utf8'));
    assert(requests.every(host => !/(?:^|\.)x\.com$|(?:^|\.)twitter\.com$/.test(host)), 'Draft and status CLI must make zero X requests, even with eligible source launches');
    if (args.includes('--status')) assert.deepEqual(requests, [], 'Status only reads local persisted records');
    else assert(requests.length > 0 && requests.every(host => host === 'api.devnet.solana.com'), 'Eligible draft sources must attempt only read-only Devnet verification');
    outputs.push(JSON.parse(result.stdout.trim()));
  }
  console.log(JSON.stringify({ mode: 'real PostgreSQL and real CLI subprocesses with all outbound HTTP blocked', passed: 2, checks: ['Default draft mode makes zero X requests while attempting read-only RPC verification', 'Status mode makes zero outbound requests'], externalRequests: 0, xRequests: 0, rpc: 'intercepted and blocked before network' }, null, 2));
} finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
