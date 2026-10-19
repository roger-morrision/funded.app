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

test('mocked status requires recovery provenance to match the chain proof and reports it separately',async()=>{
  const input=fixture(),load=input.loadSettlement;
  input.loadSettlement=async()=>({...await load(),authorization:'restricted-devnet-qa-recovery'});
  assert.equal((await verifyRecordedV3Settlements(input)).reason,'settlement-authorization-mismatch');
  input.state.v3Settlements[signature].authorization='restricted-devnet-qa-recovery';
  assert.deepEqual(await verifyRecordedV3Settlements(input),{
    verified:true,scope:'all-recorded-v3-collections',recorded:1,checked:1,recoveredRecords:1});
  input.loadSettlement=load;
  assert.equal((await verifyRecordedV3Settlements(input)).reason,'settlement-authorization-mismatch');
});

test('checks finalized proofs in bounded parallel batches and keeps ordered failure evidence', async () => {
  const input = fixture();
  const signatures = Array.from({ length:5 }, (_, index) => signature.slice(0, -1) + String(index + 1));
  input.state.collections = Object.fromEntries(signatures.map((id, index) => [id, {
    ...input.state.collections[signature], signature:id,
  }]));
  input.state.v3Settlements = Object.fromEntries(signatures.map((id, index) => [id, {
    ...input.state.v3Settlements[signature], collectionSignature:id,
    settlementSignature:`settlement-${index}`,
  }]));
  let active = 0;
  let maximum = 0;
  input.loadCollection = async ({ signature:id }) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active -= 1;
    return { signature:id, claimId:Buffer.from(claimId, 'hex'),
      expectedLamports:100n, router:'router' };
  };
  input.loadSettlement = async ({ signature:id }) => ({
    signature:id, claimId, expectedLamports:'100', router:'router', categoryLamports,
  });
  assert.deepEqual(await verifyRecordedV3Settlements(input), {
    verified:true, scope:'all-recorded-v3-collections', recorded:5, checked:5,
  });
  assert.equal(maximum, 4);
  input.loadSettlement = async ({ signature:id }) => ({
    signature:id, claimId, expectedLamports:'100', router:'router',
    categoryLamports:id === 'settlement-2' ? ['wrong'] : categoryLamports,
  });
  assert.deepEqual(await verifyRecordedV3Settlements(input), {
    verified:false, scope:'all-recorded-v3-collections', recorded:5, checked:5,
    reason:'settlement-proof-unavailable',
    verifiedRecords:4, failed:1,
    failures:[{mint,collectionSignature:signatures[2],reason:'settlement-proof-unavailable'}],
  });
  input.loadCollection = async ({signature:id}) => {
    if(id===signatures[4])throw new Error('RPC unavailable');
    return {signature:id,claimId:Buffer.from(claimId,'hex'),expectedLamports:100n,router:'router'};
  };
  const partial=await verifyRecordedV3Settlements(input);
  assert.equal(partial.verified,false);assert.equal(partial.checked,5);
  assert.equal(partial.verifiedRecords,3);assert.equal(partial.failed,2);
  assert.deepEqual(partial.failures.map(row=>row.collectionSignature),[signatures[2],signatures[4]]);
  assert.equal(partial.failures[1].reason,'finalized-evidence-unavailable');
});

test('status covers the 26th collection and still rejects ledgers beyond its bounded budget before RPC',async()=>{
  const input=fixture(),collection=input.state.collections[signature],settlement=input.state.v3Settlements[signature];
  const fill=count=>{
    input.state.collections=Object.fromEntries(Array.from({length:count},(_,index)=>{
      const id=`collection-${index}`;return[id,{...collection,signature:id}];
    }));
    input.state.v3Settlements=Object.fromEntries(Object.keys(input.state.collections).map((id,index)=>
      [id,{...settlement,collectionSignature:id,settlementSignature:`settlement-${index}`} ]));
  };
  let reads=0,active=0,maximum=0;
  input.loadCollection=async({signature:id})=>{
    reads++;active++;maximum=Math.max(maximum,active);await Promise.resolve();active--;
    return{signature:id,claimId:Buffer.from(claimId,'hex'),expectedLamports:100n,router:'router'};
  };
  input.loadSettlement=async({signature:id})=>({signature:id,claimId,expectedLamports:'100',router:'router',categoryLamports});
  fill(26);
  assert.deepEqual(await verifyRecordedV3Settlements(input),{verified:true,scope:'all-recorded-v3-collections',recorded:26,checked:26});
  assert.equal(reads,26);assert.equal(maximum,4);
  fill(101);reads=0;
  input.connection.getGenesisHash=async()=>{throw new Error('Budget rejection must precede all RPC reads.');};
  assert.deepEqual(await verifyRecordedV3Settlements(input),{verified:false,scope:'all-recorded-v3-collections',recorded:101,checked:0,reason:'verification-budget-exceeded'});
  assert.equal(reads,0);
});
