import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { createStore } from '../server/store.mjs';
import { createPublicTradeConsent, publicTradeShareConfig } from '../server/x-public-trade-consent.mjs';

const directory = await mkdtemp(join(tmpdir(), 'funded-x-share-'));
try {
  const config = publicTradeShareConfig({
    X_PUBLIC_TRADE_SHARES_ENABLED: 'true',
    X_POST_EXPECTED_HANDLE: 'fundedfixture',
    X_POST_PUBLIC_ORIGIN: 'https://funded.example.org',
  }, 'devnet');
  assert.equal(config.enabled, true);
  assert.equal(publicTradeShareConfig({}, 'devnet').enabled, false);
  assert.equal(publicTradeShareConfig({
    X_PUBLIC_TRADE_SHARES_ENABLED: 'true', X_POST_EXPECTED_HANDLE: 'fundedfixture',
    X_POST_PUBLIC_ORIGIN: 'https://funded.example.org',
  }, 'mainnet-beta').enabled, false);

  const store = createStore(join(directory, 'state.json'), '');
  const wallet = Keypair.generate();
  const mint = Keypair.generate().publicKey.toBase58();
  const buySignature = bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => i + 1));
  const sellSignature = bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => i + 2));
  let verifications = 0;
  const service = createPublicTradeConsent({ store, config, verifyTrade: async trade => {
    verifications += 1;
    return { ...trade, publicConsent: true, completeCostBasis: true, positionClosed: true,
      buyCostLamports: '1000000000', sellProceedsLamports: '3000000000', feesLamports: '1000000' };
  } });
  const request = { wallet: wallet.publicKey.toBase58(), mint, buySignature, sellSignature };
  await assert.rejects(service.prepare(request, 'https://wrong.example.org'), /configured app origin/);
  const preview = await service.prepare(request, config.origin);
  assert.match(preview.statement, /I authorize one factual public X summary/);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(preview.statement), wallet.secretKey));
  await assert.rejects(service.accept({ challengeId: preview.challengeId, signature: buySignature }, config.origin), /Wallet approval/);
  const accepted = await service.accept({ challengeId: preview.challengeId, signature }, config.origin);
  assert.equal(accepted.created, true);
  assert.equal(accepted.share.publication, 'awaiting-collector-verification');
  const replay = await service.accept({ challengeId: preview.challengeId, signature }, config.origin);
  assert.equal(replay.created, false);
  assert.equal(replay.share.id, accepted.share.id);
  assert.equal(verifications, 1);
  await assert.rejects(service.accept({ challengeId: preview.challengeId, signature: buySignature }, config.origin), /does not match/);
  console.log('X public trade consent: Devnet gate, exact origin, wallet signature, verified proof, idempotent replay and tamper rejection passed (mocked proof; no X post).');
} finally {
  await rm(directory, { recursive: true, force: true });
}
