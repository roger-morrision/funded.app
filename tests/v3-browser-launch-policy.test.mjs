import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { buildFeeRouterPolicy, MINT_FEE_ROUTER_V3_SEED } from '../fee-router.js';
import { deriveMintRouterV3, buildMintRouterV3InitializeInstruction } from '../mint-router-v3.js';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';

test('new V3 launch metadata names its mint router and matches the initialized PDA', () => {
  const programId = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const route = deriveMintRouterV3(programId, mint);
  const initialized = buildMintRouterV3InitializeInstruction({ programId, mint,
    creator, authority, split:PROTOCOL_FEE_SPLIT });
  const policy = buildFeeRouterPolicy({ ...route, scope:'per-mint-v3' });
  assert.equal(initialized.router.address.toBase58(), route.address.toBase58());
  assert.equal(policy.ingress.recipient, route.address.toBase58());
  assert.equal(policy.router.seed, MINT_FEE_ROUTER_V3_SEED);
  assert.equal(policy.router.mint, mint.toBase58());
  assert.equal(policy.router.programId, programId.toBase58());
  assert.equal(policy.router.accountMagic, 'FUNDMNT3');
  assert.equal(policy.router.version, 3);
  assert.equal(policy.settlement.idempotencyKey, 'v3-claim-id');
});
