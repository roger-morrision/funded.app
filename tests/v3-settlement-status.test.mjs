import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { verifyRecordedV3Settlements } from '../server/v3-settlement-status.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

const programId = '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
const authority = new PublicKey('7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const mint = '26ds5kGQhgUCgsoRwfaLKLwdNiNRsnitAzdgCjTd7UJm';
const signature = '3q6PqX9UmX7nZZxZrAD8uemmN1UfvqNAHiURaE4L8veA6bN88AZfwi4CAEzVc4Pb4jdv5ma8387dTytzL464f6kM';
const claimId = 'a'.repeat(64);
const approvedHash = 'b'.repeat(64);
const categoryLamports = ['1', '2', '3', '4', '5', '6', '7'];

function fixture() {
  const launch = { mint, cluster:'devnet', onchainVerified:true, creatorWallet:authority.toBase58(),
    pumpFeeRoute:{ scope:'per-mint-v3', verified:true, programId,
      initialAuthority:authority.toBase58() } };
  const collection = { signature, mint, scope:'per-mint-v3', cluster:'devnet', programId,
    status:'collected', onchainVerified:true, attribution:'mint-verified',
    collectedLamports:100, claimId, router:'router' };
  const settlement = { collectionSignature:signature, settlementSignature:'settlement', mint,
    status:'finalized', cluster:'devnet', claimId, expectedLamports:'100', categoryLamports };
  const state = { launches:{ [mint]:launch }, collections:{ [signature]:collection },
    v3Settlements:{ [signature]:settlement } };
  const input = { state, programId, approvedHash,
    connection:{ getGenesisHash:async () => DEVNET_GENESIS_HASH },
    readProgram:async () => ({ account:{ executable:true }, sha256:approvedHash }),
    verifyGlobal:async () => ({ verified:true, authority }),
    loadCollection:async () => ({ signature, claimId:Buffer.from(claimId, 'hex'),
      expectedLamports:100n, router:'router' }),
    loadSettlement:async () => ({ signature:'settlement', claimId,
      expectedLamports:'100', router:'router', categoryLamports }),
  };
  return input;
}

test('all recorded V3 collections require finalized collection and settlement proofs', async () => {
  const input = fixture();
  assert.deepEqual(await verifyRecordedV3Settlements(input), {
    verified:true, scope:'all-recorded-v3-collections', recorded:1, checked:1,
  });
  input.state.v3Settlements[signature].status = 'verification-pending';
  assert.equal((await verifyRecordedV3Settlements(input)).verified, false);
});

test('rejects missing, inconsistent, and unapproved evidence', async () => {
  const input = fixture();
  assert.equal((await verifyRecordedV3Settlements({ ...input, state:{} })).reason,
    'no-v3-collections');
  assert.equal((await verifyRecordedV3Settlements({ ...input, maxRecords:0 })).reason,
    'verification-budget-exceeded');
  assert.equal((await verifyRecordedV3Settlements({ ...input, approvedHash:'' })).reason,
    'approved-program-unavailable');
  assert.equal((await verifyRecordedV3Settlements({ ...input,
    readProgram:async () => ({ account:{ executable:true }, sha256:'c'.repeat(64) }) })).reason,
  'approved-program-unverified');
  assert.equal((await verifyRecordedV3Settlements({ ...input,
    loadCollection:async () => null })).reason, 'collection-proof-unavailable');
  assert.equal((await verifyRecordedV3Settlements({ ...input,
    loadSettlement:async () => ({ ...await input.loadSettlement(), categoryLamports:['100'] }) })).reason,
  'settlement-proof-unavailable');
});
