import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { BOOST_MEMO_PROGRAM } from '../boost-offer.js';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

const mint = new PublicKey(Uint8Array.from({ length:32 }, (_, index) => index + 1)).toBase58();
const payer = new PublicKey(Uint8Array.from({ length:32 }, (_, index) => index + 33)).toBase58();
const recipient = new PublicKey(Uint8Array.from({ length:32 }, (_, index) => index + 65)).toBase58();
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('any wallet can quote a verified directory token and no payment activates without proof', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'funded-boost-http-'));
  const storePath = join(directory, 'store.json');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let paymentProof = null;
  const rpc = createHttpServer(async (req, res) => {
    let source = '';
    for await (const chunk of req) source += chunk;
    const input = JSON.parse(source);
    const result = input.method === 'getGenesisHash' ? DEVNET_GENESIS_HASH : input.method === 'getTransaction' ? paymentProof : null;
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(JSON.stringify({ jsonrpc:'2.0', id:input.id, result }));
  });
  await new Promise(resolve => rpc.listen(0, '127.0.0.1', resolve));
  const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;
  await writeFile(storePath, JSON.stringify({ launches:{ [mint]:{ mint, cluster:'devnet', onchainVerified:true, creatorWallet:recipient } } }));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd:resolve('.'), env:{ ...process.env,
    NODE_ENV:'test', DATABASE_URL:'', FUNDED_STORE_PATH:storePath, PORT:String(port), HOST:'127.0.0.1',
    CORS_ORIGIN:origin, PUBLIC_APP_URL:origin, VITE_SOLANA_CLUSTER:'devnet', SOL_USD_PRICE:'100',
    FUNDED_BOOST_PAYMENT_WALLET:recipient, FUNDED_BOOST_ENABLED:'true', SOLANA_RPC_URL:rpcUrl }, stdio:['ignore','pipe','pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (child.exitCode != null) throw new Error(`Server exited early: ${stderr}`);
      try { if ((await fetch(`${origin}/api/boosts`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `Server did not start: ${stderr}`);
    const request = (path, body) => fetch(`${origin}${path}`, { method:'POST', headers:{ origin, 'content-type':'application/json' }, body:JSON.stringify(body) });
    const quoted = await request('/api/boosts/quote', { mint, payer, packageId:'10x' });
    assert.equal(quoted.status, 201);
    const quote = await quoted.json();
    assert.equal(quote.payer, payer);
    assert.notEqual(quote.payer, recipient);
    assert.equal(quote.lamports, 990_000_000);
    assert.equal(quote.memo, `funded.vip:boost:devnet:${quote.id}`);
    const persisted = JSON.parse(await readFile(storePath, 'utf8'));
    assert.equal(persisted.boostQuotes[quote.id].payer, payer);
    assert.deepEqual(persisted.boostReceipts || {}, {});
    const active = await (await fetch(`${origin}/api/boosts?mint=${mint}`)).json();
    assert.deepEqual(active.active, {});
    assert.equal(active.enabled, true);
    const wrongOrigin = await fetch(`${origin}/api/boosts/quote`, { method:'POST', headers:{ origin:'https://attacker.example', 'content-type':'application/json' }, body:JSON.stringify({ mint, payer, packageId:'10x' }) });
    assert.equal(wrongOrigin.status, 403);
    const unknown = await request('/api/boosts/quote', { mint:recipient, payer, packageId:'10x' });
    assert.equal(unknown.status, 404);
    const invalid = await request('/api/boosts/confirm', { quoteId:quote.id, signature:'bad' });
    assert.equal(invalid.status, 400);
    const signature = bs58.encode(Buffer.alloc(64, 7));
    paymentProof = { blockTime:Math.floor(Date.now() / 1000), slot:123, version:'legacy',
      meta:{ err:null, fee:5000, preBalances:[1_000_000_000,0], postBalances:[9_995_000,990_000_000],
        innerInstructions:[], logMessages:[], preTokenBalances:[], postTokenBalances:[], rewards:[], status:{ Ok:null } },
      transaction:{ signatures:[signature], message:{ recentBlockhash:recipient,
        accountKeys:[{ pubkey:payer, signer:true, writable:true, source:'transaction' },
          { pubkey:recipient, signer:false, writable:true, source:'transaction' }],
        instructions:[{ program:'system', programId:'11111111111111111111111111111111', parsed:{ type:'transfer', info:{ source:payer, destination:recipient, lamports:quote.lamports } } },
          { program:'spl-memo', programId:BOOST_MEMO_PROGRAM, parsed:quote.memo }] } } };
    const confirmed = await request('/api/boosts/confirm', { quoteId:quote.id, signature });
    const receipt = await confirmed.json();
    assert.equal(confirmed.status, 201, JSON.stringify(receipt));
    assert.equal(receipt?.signature, signature);
    const activeAfter = await (await fetch(`${origin}/api/boosts?mint=${mint}`)).json();
    assert.equal(activeAfter.active[mint].multiplier, 10);
    const replay = await request('/api/boosts/confirm', { quoteId:quote.id, signature });
    assert.equal(replay.status, 200);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    const absolute = resolve(directory);
    if (absolute.startsWith(`${resolve(tmpdir())}\\`) && absolute.includes('funded-boost-http-')) await rm(absolute, { recursive:true, force:true });
    await new Promise(resolve => rpc.close(resolve));
  }
});
