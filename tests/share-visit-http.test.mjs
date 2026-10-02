import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

test('opt-in visit API validates origin, deduplicates a day, and reports no raw browser ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'funded-share-visit-'));
  const storePath = join(directory, 'store.json');
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const walletKeypair = Keypair.generate();
  const wallet = walletKeypair.publicKey.toBase58();
  const code = 'FND-123456789ABC';
  const visitorId = randomUUID();
  await writeFile(storePath, JSON.stringify({ version:4, shareVisits:{ stale:{ code, visitor:'hashed', source:'direct', day:'2020-01-01' } },
    referrals:{ codes:{ [code]:{ wallet, code } }, wallets:{ [wallet]:{ wallet, code } }, attributions:{}, challenges:{} } }));
  const server = spawn(process.execPath, ['server/index.mjs'], { cwd:process.cwd(),
    env:{ ...process.env, FUNDED_SKIP_LOCAL_ENV:'true', NODE_ENV:'test', PORT:String(port), HOST:'127.0.0.1', FUNDED_STORE_PATH:storePath,
      DATABASE_URL:'', FUNDED_API_TOKEN:'share-test-token', VITE_SOLANA_CLUSTER:'devnet', SOLANA_CLUSTER:'devnet',
      DEV_MODE:'false', DEVNET_TEST_MODE:'false', SOLANA_KEEPER_CONFIGURED:'false', SOLANA_KEEPER_SECRET_KEY:'',
      SOLANA_KEEPER_KEYPAIR_PATH:'', FUNDED_ROUTER_AUTHORITY_SECRET_KEY:'', FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH:'' }, stdio:'ignore' });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'Share API did not start');
    const post = (data, origin = base) => fetch(`${base}/api/shares/visit`, { method:'POST',
      headers:{ 'content-type':'application/json', ...(origin ? { origin } : {}) }, body:JSON.stringify(data) });
    assert.equal((await post({ code, visitorId, source:'x' }, '')).status, 403);
    assert.equal((await post({ code, visitorId:'invalid', source:'x' })).status, 400);
    assert.equal((await post({ code:'FND-AAAAAAAAAAAA', visitorId, source:'x' })).status, 404);
    assert.equal((await post({ code, visitorId, source:'x' })).status, 202);
    assert.equal((await post({ code, visitorId, source:'telegram' })).status, 202);
    const dashboardUrl = `${base}/api/referrals/dashboard?wallet=${wallet}`;
    assert.equal((await fetch(dashboardUrl)).status, 401, 'Referral visit metrics must not be public.');
    const preparedResponse = await fetch(`${base}/api/referrals/session/prepare`, { method:'POST',
      headers:{ origin:base, 'content-type':'application/json' }, body:JSON.stringify({ wallet }) });
    assert.equal(preparedResponse.status, 200);
    const prepared = await preparedResponse.json();
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(prepared.statement), walletKeypair.secretKey));
    const sessionResponse = await fetch(`${base}/api/referrals/session/verify`, { method:'POST',
      headers:{ origin:base, 'content-type':'application/json' },
      body:JSON.stringify({ challengeId:prepared.challengeId, wallet, signature }) });
    assert.equal(sessionResponse.status, 200);
    const cookie = sessionResponse.headers.getSetCookie().find(row => row.startsWith('funded_referral_session=')).split(';')[0];
    const dashboardResponse = await fetch(dashboardUrl, { headers:{ cookie } });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.equal(dashboard.shareVisits.consentedVisitDays, 1);
    assert.deepEqual(dashboard.shareVisits.byChannel, { x:1 });
    const stored = await readFile(storePath, 'utf8');
    assert.equal(stored.includes(visitorId), false);
    assert.equal(stored.includes('2020-01-01'), false);
  } finally {
    if (server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000))]);
    }
    await rm(directory, { recursive:true, force:true });
  }
});
