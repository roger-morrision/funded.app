import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';

const settlementSignature = process.argv.find(arg => arg.startsWith('--settlement='))?.split('=')[1];
assert(settlementSignature, 'Pass --settlement=<finalized fee-collection signature>.');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet', 'Devnet only.');
const referrer = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY || ''));
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), await new Connection(clusterApiUrl('devnet')).getGenesisHash(), 'Configured RPC is not Devnet.');
const token = readFileSync('.secrets/funded-api-token', 'utf8').trim();
async function post(path, input, authorized = false, cookie = '') {
  const response = await fetch(`http://127.0.0.1:8788${path}`, { method:'POST', headers:{ 'content-type':'application/json', origin:'https://funded.vip', ...(authorized ? { authorization:`Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) }, body:JSON.stringify(input), signal:AbortSignal.timeout(45_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${data.error || ''}`);
  return data;
}

async function referralSessionCookie() {
  const prepared = await post('/api/referrals/session/prepare', { wallet:referrer.publicKey.toBase58() });
  const response = await fetch('http://127.0.0.1:8788/api/referrals/session/verify', {
    method:'POST', headers:{ 'content-type':'application/json', origin:'https://funded.vip' },
    body:JSON.stringify({ challengeId:prepared.challengeId, wallet:referrer.publicKey.toBase58(), signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(prepared.statement), referrer.secretKey)) }),
    signal:AbortSignal.timeout(45_000),
  });
  const session = await response.json().catch(() => ({}));
  assert(response.ok && session.wallet === referrer.publicKey.toBase58(), `Referral session verification failed: ${session.error || response.status}`);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert(cookie?.startsWith('funded_referral_session='), 'Referral wallet session cookie was not issued.');
  return cookie;
}

const claim = await post('/api/referral-claims/prepare', { settlementSignature, recipientWallet:referrer.publicKey.toBase58(), level:1 }, true);
assert.equal(claim.recipientWallet, referrer.publicKey.toBase58());
assert.equal(claim.status, 'awaiting-wallet-signature');
const before = await connection.getBalance(referrer.publicKey, 'finalized');
const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(claim.statement), referrer.secretKey));
const verified = await post(`/api/referral-claims/${claim.id}/verify`, { publicKey:referrer.publicKey.toBase58(), signature });
assert.equal(verified.status, 'wallet-verified');
const payout = await post(`/api/referral-claims/${claim.id}/execute`, {}, false, await referralSessionCookie());
assert.equal(payout.status, 'paid');
const finalized = await connection.getSignatureStatus(payout.signature, { searchTransactionHistory:true });
assert.equal(finalized.value?.confirmationStatus, 'finalized');
assert.equal(finalized.value?.err, null);
const after = await connection.getBalance(referrer.publicKey, 'finalized');
const expected = Math.floor(Number(claim.amount) * 1_000_000_000);
assert.equal(after - before, expected, 'Referral recipient balance delta differs from the claim.');
console.log(JSON.stringify({ claimId:claim.id, settlementSignature, recipient:referrer.publicKey.toBase58(), amountLamports:expected, payoutSignature:payout.signature, finalized:true, recipientDeltaLamports:after-before }));
