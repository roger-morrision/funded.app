import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { buybackPriceService } from '../server/buyback-price-signer.mjs';
import { validatePriceSignerConfig } from '../server/price-signer-service.mjs';
import { krakenSolUsd } from '../server/price-signer-market.mjs';

const signer = Keypair.generate().publicKey.toBase58();

test('app accepts the signer over HTTPS or a private single-label compose service only', () => {
  for (const url of ['https://signer.example/sign', 'http://price-signer:8789/sign'])
    assert.ok(buybackPriceService({ FUNDED_DEVNET_BUYBACK_PRICE_SIGNER:signer, FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL:url }));
  for (const url of ['http://signer.example/sign', 'http://127.0.0.1:8789/sign', 'http://localhost:8789/sign', 'http://user:pw@price-signer/sign'])
    assert.throws(() => buybackPriceService({ FUNDED_DEVNET_BUYBACK_PRICE_SIGNER:signer, FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL:url }), /Invalid independent/, url);
});

test('own-coin signing must be an explicit boolean in the allowlist', () => {
  const authority = Keypair.generate().publicKey.toBase58(), id = () => Keypair.generate().publicKey.toBase58();
  const entry = { programId:id(), authority, upgradeAuthority:authority, mint:id(), pool:id(), programDataSha256:'b'.repeat(64), maxOrderLamports:'1000000', allowCurve:true };
  const config = programs => ({ cluster:'devnet', maxDailyLamports:'2000000', programs });
  assert.ok(validatePriceSignerConfig(config([entry]), signer));
  assert.ok(validatePriceSignerConfig(config([{ ...entry, allowOwnCoin:true }]), signer));
  assert.throws(() => validatePriceSignerConfig(config([{ ...entry, allowOwnCoin:'yes' }]), signer), /explicit/);
});

test('Kraken SOL/USD reference is parsed exactly and rejects bad payloads', async () => {
  const reply = body => async () => ({ ok:true, json:async () => body });
  assert.equal(await krakenSolUsd({ request:reply({ error:[], result:{ SOLUSD:{ c:['142.53000', '1'] } } }) }), '142.53');
  assert.equal(await krakenSolUsd({ request:reply({ error:[], result:{ SOLUSD:{ c:['140.00000'] } } }) }), '140');
  await assert.rejects(krakenSolUsd({ request:reply({ error:['EQuery'], result:{} }) }), /invalid/);
  await assert.rejects(krakenSolUsd({ request:async () => ({ ok:false }) }), /unavailable/);
});
