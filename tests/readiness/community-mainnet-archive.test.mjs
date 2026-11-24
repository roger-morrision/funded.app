import test from 'node:test';
import assert from 'node:assert/strict';
import {communityArchiveFixture} from './community-archive-fixture.mjs';
import {SOLANA_GENESIS} from '../../solana-network.js';

test('Mainnet refuses missing original archive before RPC or ledger writes',async t=>{
  const f=await communityArchiveFixture(t);assert.throws(()=>f.service({cluster:'mainnet-beta',snapshotArchive:null}),/requires a durable original snapshot archive/);
  assert.equal(f.reads,0);assert.equal(await f.store.hasPublishedFile(),false);
});
test('fresh Mainnet eligibility durably archives complete bank inputs and replays after restart',async t=>{
  const f=await communityArchiveFixture(t);f.connection.getGenesisHash=async()=>SOLANA_GENESIS['mainnet-beta'];
  const service=f.service({cluster:'mainnet-beta'}),record=await service.prepare(f.input);
  assert.equal(record.cluster,'mainnet-beta');assert.equal(record.genesisHash,SOLANA_GENESIS['mainnet-beta']);assert(record.snapshotEvidence);
  for(const name of Object.keys(f.connection))if(typeof f.connection[name]==='function')f.connection[name]=async()=>{throw Error('No new RPC during archive replay');};
  assert.deepEqual(await f.service({cluster:'mainnet-beta'}).prepared(f.launch),record);
});
test('Devnet records cannot be imported into Mainnet eligibility even with a valid archive',async t=>{
  const f=await communityArchiveFixture(t);await f.service().prepare(f.input);
  await assert.rejects(f.service({cluster:'mainnet-beta'}).prepared(f.launch),/network differs/);
});
test('missing original archive cannot be replaced by current Mainnet balances',async t=>{
  const f=await communityArchiveFixture(t);f.connection.getGenesisHash=async()=>SOLANA_GENESIS['mainnet-beta'];
  await f.service({cluster:'mainnet-beta'}).prepare(f.input);
  await f.store.transaction(state=>{delete state.communityDrops[String(f.launch)].snapshotEvidence;});
  const reads=f.reads;await assert.rejects(f.service({cluster:'mainnet-beta'}).prepared(f.launch),/lacks its original raw bank archive/);
  assert.equal(f.reads,reads);
});
