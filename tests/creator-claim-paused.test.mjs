import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import test from 'node:test';
import { Keypair } from '@solana/web3.js';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('creator claim cannot accept requests until the signed Devnet router is verified', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'funded-creator-claim-paused-'));
  const storePath = join(directory, 'store.json');
  const rewardsPath = `${storePath}.automatic-rewards.json`;
  const mint = Keypair.generate().publicKey.toBase58();
  const creatorWallet = Keypair.generate().publicKey.toBase58();
  const router = Keypair.generate().publicKey.toBase58();
  const collectionSignature = Keypair.generate().publicKey.toBase58();
  const requestId = `${collectionSignature}:creator`;
  await writeFile(storePath, JSON.stringify({
    launches:{ [mint]:{ mint, creatorWallet, creator:router, cluster:'devnet', onchainVerified:true,
      pumpFeeRoute:{ router, scope:'per-mint-v2' } } },
    collections:{ [collectionSignature]:{ mint, router, cluster:'devnet', status:'collected',
      attribution:'mint-verified', onchainVerified:true } },
    settlements:{ [collectionSignature]:{ creatorDestinations:{ creatorWallet:0.02 } } },
  }));
  await writeFile(rewardsPath, JSON.stringify({ version:2, fundingRequests:{
    [requestId]:{ id:requestId, mint, sourceSignature:collectionSignature, kind:'creator', asset:'SOL',
      recipient:creatorWallet, amount:'20000000', status:'claimable' },
  } }));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd:process.cwd(), stdio:'ignore',
    env:{ ...process.env, PORT:String(port), FUNDED_STORE_PATH:storePath, CORS_ORIGIN:base,
      VITE_SOLANA_CLUSTER:'devnet', FUNDED_MINT_FEE_ROUTER_ENABLED:'false', NODE_ENV:'test', DATABASE_URL:'',
      SOLANA_KEEPER_KEYPAIR_PATH:'', SOLANA_KEEPER_SECRET_KEY:'',
      FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH:'', FUNDED_ROUTER_AUTHORITY_SECRET_KEY:'' } });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { healthy = (await fetch(`${base}/api/health`)).ok; if (healthy) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(healthy, true, 'Isolated API fixture did not start.');
    for (const action of ['prepare', 'request']) {
      const response = await fetch(`${base}/api/tokens/${mint}/creator-claim/${action}`, {
        method:'POST', headers:{ origin:base, 'content-type':'application/json' }, body:'{}',
      });
      assert.equal(response.status, 503);
      assert.ok((await response.json()).reasons?.length > 0);
    }
    const rewards = JSON.parse(await readFile(rewardsPath, 'utf8'));
    assert.equal(rewards.fundingRequests[requestId].status, 'claimable');
  } finally {
    child.kill();
    await rm(directory, { recursive:true, force:true });
  }
});
