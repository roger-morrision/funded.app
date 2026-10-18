import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';

const base = new URL(process.env.FUNDED_PREVIEW_API_URL || 'http://127.0.0.1:8788');
assert(['http://127.0.0.1:8788/', 'https://funded.vip/'].includes(base.href), 'Use the named Devnet preview.');
const expectedBuild = process.argv.find(arg => arg.startsWith('--expected-build='))?.split('=')[1];
assert(/^[a-f0-9]{40}$/.test(expectedBuild || ''), 'Supply the tested full --expected-build SHA.');
const read = async path => {
  const res = await fetch(new URL(path, base), { signal:AbortSignal.timeout(15_000) });
  assert(res.ok, `Devnet read failed (${res.status}).`); return res.json();
};
const status = await read('/api/status');
assert.equal(status.cluster, 'devnet'); assert.equal(status.build, expectedBuild);
const before = await read('/api/fee-policy');
if (JSON.stringify(before.split) === JSON.stringify(PROTOCOL_FEE_SPLIT)) {
  console.log(JSON.stringify({ status:'already-published', revision:before.revision, split:before.split }));
} else {
  assert.deepEqual(before.split, { operationsPercent:50, referralLevelPercents:[10, 3, 2], communityPercent:10, buybackPercent:25 },
    'An unexpected saved admin policy requires review before replacement.');
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile('.secrets/devnet-admin-qa-keypair.json', 'utf8'))));
  const wallet = admin.publicKey.toBase58();
  let cookie;
  const post = async (path, input) => {
    const res = await fetch(new URL(path, base), { method:'POST',
      headers:{ 'content-type':'application/json', origin:'https://funded.vip', ...(cookie ? { cookie } : {}) },
      body:JSON.stringify(input), signal:AbortSignal.timeout(15_000) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await res.json();
    assert(res.ok, `Devnet admin operation failed (${res.status}): ${data.error || 'unavailable'}`);
    return data;
  };
  try {
    const challenge = await post('/api/admin/challenge', { wallet });
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), admin.secretKey));
    await post('/api/admin/session', { wallet, nonce:challenge.nonce, signature });
    const saved = await post('/api/admin/fee-policy', { expectedRevision:before.revision, split:PROTOCOL_FEE_SPLIT });
    assert.deepEqual(saved.split, PROTOCOL_FEE_SPLIT);
    assert.equal(saved.revision, before.revision + 1);
    assert.deepEqual((await read('/api/fee-policy')).split, PROTOCOL_FEE_SPLIT);
    console.log(JSON.stringify({ status:'published', build:expectedBuild, revision:saved.revision,
      split:saved.split, signedBy:wallet, appliesTo:saved.effectiveFor }));
  } finally { if (cookie) await post('/api/admin/logout', {}).catch(() => {}); }
}
