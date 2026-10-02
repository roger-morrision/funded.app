import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { BOOST_MEMO_PROGRAM } from '../boost-offer.js';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

if (process.env.BOOST_DEVNET_E2E !== 'true') throw new Error('Set BOOST_DEVNET_E2E=true to run one real Devnet transfer with ephemeral wallets.');
const mint = new PublicKey(process.env.BOOST_TEST_MINT || '').toBase58();
const testSolUsd = Number(process.env.BOOST_TEST_SOL_USD || 100);
const fundingLamports = Number(process.env.BOOST_TEST_FUND_LAMPORTS || 1_000_000_000);
if (!Number.isFinite(testSolUsd) || testSolUsd <= 0 || !Number.isSafeInteger(fundingLamports) || fundingLamports <= 0 || fundingLamports > 1_000_000_000)
  throw new Error('Use a positive test rate and an airdrop of at most 1 Devnet SOL.');
const payer = Keypair.generate();
const recipient = Keypair.generate();
const rpc = new Connection(clusterApiUrl('devnet'), 'confirmed');
assert.equal(await rpc.getGenesisHash(), DEVNET_GENESIS_HASH);
const qaFunding = process.env.BOOST_TEST_FUNDING === 'qa';
let qaFunder = null;
if (qaFunding) {
  assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
  assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
  qaFunder = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
  const manifest = JSON.parse(await readFile(new URL('../.secrets/devnet-qa-wallets-20260930/public.json', import.meta.url), 'utf8'));
  assert.equal(qaFunder.publicKey.toBase58(), manifest.find(row => row.role === 'creator' && row.cluster === 'devnet')?.address);
  assert(await rpc.getBalance(qaFunder.publicKey, 'confirmed') > fundingLamports + 10_000);
}
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'funded-boost-devnet-'));
const storePath = join(temporaryDirectory, 'store.json');
const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
await writeFile(storePath, JSON.stringify({ launches:{ [mint]:{ mint, cluster:'devnet', onchainVerified:true, creatorWallet:recipient.publicKey.toBase58() } } }));
let qaFundingSignature = null;
const child = spawn(process.execPath, ['server/index.mjs'], { cwd:resolve('.'), env:{ ...process.env,
  NODE_ENV:'test', DATABASE_URL:'', FUNDED_STORE_PATH:storePath, PORT:String(port), HOST:'127.0.0.1',
  CORS_ORIGIN:origin, PUBLIC_APP_URL:origin, VITE_SOLANA_CLUSTER:'devnet', SOLANA_RPC_URL:clusterApiUrl('devnet'),
  SOL_USD_PRICE:String(testSolUsd), FUNDED_BOOST_PAYMENT_WALLET:recipient.publicKey.toBase58(), FUNDED_BOOST_ENABLED:'true' }, stdio:['ignore','pipe','pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += String(chunk); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Test API exited: ${stderr}`);
    try { if ((await fetch(`${origin}/api/boosts`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, `Test API did not start: ${stderr}`);
  const request = async (path, body) => {
    const response = await fetch(`${origin}${path}`, { method:'POST', headers:{ origin, 'content-type':'application/json' }, body:JSON.stringify(body) });
    return { status:response.status, data:await response.json() };
  };
  const funding = qaFunder
    ? await sendAndConfirmTransaction(rpc, new Transaction().add(SystemProgram.transfer({ fromPubkey:qaFunder.publicKey, toPubkey:payer.publicKey, lamports:fundingLamports })), [qaFunder], { commitment:'confirmed' })
    : await rpc.requestAirdrop(payer.publicKey, fundingLamports);
  if (qaFunder) qaFundingSignature = funding;
  await rpc.confirmTransaction(funding, 'confirmed');
  assert.equal(await rpc.getBalance(payer.publicKey, 'confirmed'), fundingLamports);
  const before = await rpc.getBalance(recipient.publicKey, 'confirmed');
  const quoteResponse = await request('/api/boosts/quote', { mint, payer:payer.publicKey.toBase58(), packageId:'10x' });
  assert.equal(quoteResponse.status, 201, JSON.stringify(quoteResponse.data));
  const quote = quoteResponse.data;
  assert.equal(quote.lamports, Math.ceil(99 / testSolUsd * 1_000_000_000));
  assert.ok(fundingLamports > quote.lamports + 10_000, 'The ephemeral payer needs enough SOL for the transfer and fee.');
  const transaction = new Transaction().add(
    SystemProgram.transfer({ fromPubkey:payer.publicKey, toPubkey:recipient.publicKey, lamports:quote.lamports }),
    new TransactionInstruction({ keys:[], programId:new PublicKey(BOOST_MEMO_PROGRAM), data:Buffer.from(quote.memo) }),
  );
  const signature = await sendAndConfirmTransaction(rpc, transaction, [payer], { commitment:'confirmed' });
  await rpc.confirmTransaction(signature, 'finalized');
  let confirmed;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    confirmed = await request('/api/boosts/confirm', { quoteId:quote.id, signature });
    if (confirmed.status !== 202) break;
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.payer, payer.publicKey.toBase58());
  assert.equal(confirmed.data.mint, mint);
  console.log(JSON.stringify({ stage:'receipt-finalized', signature, mint, amountLamports:quote.lamports }));
  const after = await rpc.getBalance(recipient.publicKey, 'finalized');
  assert.equal(after - before, quote.lamports);
  let status;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    status = await (await fetch(`${origin}/api/boosts?mint=${mint}`)).json();
    if (status.active?.[mint]) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert(status.active?.[mint], 'Finalized boost is not active after the chain block time.');
  assert.equal(status.active[mint].multiplier, 10);
  assert.equal(status.history[0].signature, signature);
  const replay = await request('/api/boosts/confirm', { quoteId:quote.id, signature });
  assert.equal(replay.status, 200);
  console.log(JSON.stringify({ result:'confirmed', cluster:'devnet', mint, payer:payer.publicKey.toBase58(), recipient:recipient.publicKey.toBase58(), fundingSource:qaFunder?'qa-devnet-wallet':'faucet', fundingSignature:funding, signature, amountLamports:quote.lamports, activeMultiplier:status.active[mint].multiplier }));
} finally {
  if (qaFunder && qaFundingSignature) {
    try {
      const remainder = await rpc.getBalance(payer.publicKey, 'confirmed');
      if (remainder > 10_000) {
        const latest = await rpc.getLatestBlockhash('confirmed');
        const refund = new Transaction({ recentBlockhash:latest.blockhash, feePayer:payer.publicKey }).add(
          SystemProgram.transfer({ fromPubkey:payer.publicKey, toPubkey:qaFunder.publicKey, lamports:1 }));
        const fee = (await rpc.getFeeForMessage(refund.compileMessage(), 'confirmed')).value;
        assert(Number.isSafeInteger(fee) && fee > 0 && remainder > fee, 'Cannot quote the refund network fee.');
        refund.instructions[0] = SystemProgram.transfer({ fromPubkey:payer.publicKey, toPubkey:qaFunder.publicKey, lamports:remainder - fee });
        refund.sign(payer);
        const refundSignature = await rpc.sendRawTransaction(refund.serialize(), { skipPreflight:false });
        const confirmation = await rpc.confirmTransaction({ signature:refundSignature, ...latest }, 'confirmed');
        assert.equal(confirmation.value.err, null);
        assert.equal(await rpc.getBalance(payer.publicKey, 'confirmed'), 0);
        console.log(JSON.stringify({ stage:'qa-funds-refunded', signature:refundSignature, lamports:remainder - fee }));
      }
    } catch (error) { console.error(`QA funding refund failed: ${String(error.message || error)}`); }
  }
  child.kill();
  if (child.exitCode == null) await new Promise(resolve => child.once('exit', resolve));
  const absolute = resolve(temporaryDirectory);
  if (absolute.startsWith(`${resolve(tmpdir())}\\`) && absolute.includes('funded-boost-devnet-')) await rm(absolute, { recursive:true, force:true });
}
