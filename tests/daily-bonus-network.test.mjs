import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {assertBonusRpc,assertBonusLedgerNetwork,assertBonusNetwork} from '../server/daily-bonus-network.mjs';
import {buildDailyBonusSnapshot} from '../server/daily-bonus.mjs';
import {verifyBonusSnapshotRevision,appendDailyBonusResidual} from '../server/daily-bonus-reconciliation.mjs';
import {createDailyBonusRuntime} from '../server/daily-bonus-runtime.mjs';
import {createDailyBonusService} from '../server/daily-bonus-service.mjs';
import {dailyBonusWork} from '../server/daily-bonus-queue.mjs';

const programId=Keypair.generate().publicKey.toBase58();
const base={day:'2026-11-09',now:Date.parse('2026-11-10T00:00:00Z')/1000,collections:[],trades:[],coverage:[]};
const ledger=snapshot=>({dailyBonusSnapshots:{[snapshot.day]:{snapshot,payouts:{}}}});

test('bonus snapshots bind Mainnet identity while preserving legacy Devnet hashes',()=>{
  const legacy=buildDailyBonusSnapshot(base),devnet=buildDailyBonusSnapshot({...base,cluster:'devnet',programId});
  assert.deepEqual(devnet,legacy);assert.equal(devnet.cluster,undefined);
  const mainnet=buildDailyBonusSnapshot({...base,cluster:'mainnet-beta',programId});
  assert.equal(mainnet.cluster,'mainnet-beta');assert.equal(mainnet.programId,programId);
  assert.notEqual(mainnet.hash,devnet.hash);
  verifyBonusSnapshotRevision({snapshot:mainnet});verifyBonusSnapshotRevision({snapshot:devnet});
  assertBonusLedgerNetwork(ledger(mainnet),'mainnet-beta',programId);
  assertBonusLedgerNetwork(ledger(devnet),'devnet',programId);
  for(const [snapshot,cluster,id]of [[devnet,'mainnet-beta',programId],[mainnet,'devnet',programId],
    [mainnet,'mainnet-beta',Keypair.generate().publicKey.toBase58()]])
    assert.throws(()=>assertBonusLedgerNetwork(ledger(snapshot),cluster,id),/another network or program/);
  assert.throws(()=>appendDailyBonusResidual(devnet,mainnet),/cannot change/);
});

test('QA bonus periods and wrong RPC networks cannot enter Mainnet paths',async()=>{
  for(const options of [{window:{qa:true}},{schedule:{periodSeconds:300}},{schedule:{mints:[programId]}}])
    assert.throws(()=>assertBonusNetwork('mainnet-beta',options),/forbidden/);
  await assert.rejects(assertBonusRpc({getGenesisHash:async()=>SOLANA_GENESIS.devnet},'mainnet-beta'),/network does not match/);
  await assertBonusRpc({getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta']},'mainnet-beta');
  assert.throws(()=>buildDailyBonusSnapshot({...base,cluster:'mainnet-beta',programId,
    day:'qa5m:2026-11-09T23:55:00Z'}),/forbidden/);
});

test('placeholder Mainnet release cannot load a bonus signer or construct a financial chain',async()=>{
  let signerReads=0,chains=0;
  const runtime=createDailyBonusRuntime({solanaCluster:'mainnet-beta',solanaRpcUrl:'https://example.invalid',
    env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),FUNDED_DAILY_BONUS_ENABLED:'true'},
    v3AuthorityKeypair(){signerReads++;throw Error('Must not load');},serviceFactory(){chains++;}});
  assert.equal(runtime.start(),false);assert.equal(signerReads,0);assert.equal(chains,0);
  assert.throws(()=>createDailyBonusService({cluster:'mainnet-beta',programId,expectedProgramDataSha256:'a'.repeat(64),
    chainFactory(){chains++;}}),/reviewed release/);
  assert.equal(chains,0);
});

test('bonus queues select only the requested network and refuse foreign snapshots',()=>{
  const createdTimestamp=Date.parse('2026-11-09T12:00:00Z')/1000;
  const launch={cluster:'devnet',onchainVerified:true,mint:programId,createdTimestamp,
    feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}};
  const args={app:{launches:{[programId]:launch}},ledger:{},now:base.now,programId};
  assert.equal(dailyBonusWork({...args,cluster:'mainnet-beta'}).eligible,false);
  assert.equal(dailyBonusWork({...args,cluster:'devnet'}).eligible,true);
  assert.throws(()=>dailyBonusWork({...args,cluster:'mainnet-beta',ledger:ledger(buildDailyBonusSnapshot(base))}),/another network/);
});
