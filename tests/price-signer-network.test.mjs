import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {loadPriceSignerRuntime} from '../server/price-signer-bootstrap.mjs';
import {priceReviewNetwork} from '../server/price-review-network.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';

const key=()=>String(Keypair.generate().publicKey);
function fixture() {
  const signer=Keypair.generate(),entry={programId:key(),authority:key(),upgradeAuthority:key(),mint:key(),pool:key(),
    programDataSha256:'a'.repeat(64),maxOrderLamports:'1000000',allowCurve:true};
  const config={cluster:'devnet',maxDailyLamports:'10000000',programs:[entry]},reads=[];
  const env={PRICE_SIGNER_CONFIG_FILE:'config',PRICE_SIGNER_RPC_FILE:'rpc',PRICE_SIGNER_KEY_FILE:'key',PRICE_SIGNER_TOKEN_FILE:'token'};
  return {config,entry,signer,reads,env,read:path=>{
    reads.push(path);return path==='config'?JSON.stringify(config):path==='rpc'?'https://fixture.invalid':
      path==='key'?JSON.stringify(Array.from(signer.secretKey)):'b'.repeat(64);
  }};
}

test('signer bootstrap rejects Mainnet configuration before accessing RPC or private files',async()=>{
  const f=fixture();f.config.cluster='mainnet-beta';
  await assert.rejects(loadPriceSignerRuntime({...f,connectionFactory:()=>{throw Error('unexpected RPC');}}),/Mainnet price signing is disabled/);
  assert.deepEqual(f.reads,['config']);
});

test('wrong RPC, stale program pins and malformed allowlist fail before key loading',async()=>{
  for(const failure of ['genesis','program','config']) {
    const f=fixture();if(failure==='config')f.entry.maxOrderLamports='999999999999';
    await assert.rejects(loadPriceSignerRuntime({...f,connectionFactory:()=>({getGenesisHash:async()=>
      failure==='genesis'?SOLANA_GENESIS['mainnet-beta']:SOLANA_GENESIS.devnet}),
      verifyProgram:async()=>{if(failure==='program')throw Error('program mismatch');}}));
    assert(!f.reads.includes('key'));assert(!f.reads.includes('token'));
  }
});

test('Devnet bootstrap preserves independent signer and only loads it after public verification',async()=>{
  const f=fixture();let verified=false;
  const result=await loadPriceSignerRuntime({...f,connectionFactory:()=>({getGenesisHash:async()=>SOLANA_GENESIS.devnet}),
    verifyProgram:async()=>{assert(!f.reads.includes('key'));verified=true;}});
  assert(verified);assert(result.keypair.publicKey.equals(f.signer.publicKey));assert.equal(result.config.cluster,'devnet');
});

test('bootstrap failures never echo an upstream URL credential',async()=>{
  const f=fixture();
  await assert.rejects(loadPriceSignerRuntime({...f,connectionFactory:()=>({getGenesisHash:async()=>{
    throw Error('https://rpc.invalid?api-key=private-value');
  }})}),error=>error.message.includes('RPC identity is unavailable')&&!error.message.includes('private-value'));
  assert(!f.reads.includes('key'));
});

test('Mainnet price assessment binds genesis, bytecode, assets and authority without enabling signing',()=>{
  const f=fixture(),config={...f.entry,cluster:'mainnet-beta'},request={cluster:'mainnet-beta',programId:config.programId};
  assert.throws(()=>priceReviewNetwork(config,request),/reviewed/);
  const release={schemaVersion:1,status:'reviewed',cluster:'mainnet-beta',programId:config.programId,
    upgradeAuthority:config.upgradeAuthority,fundedMint:config.mint,fundedPool:config.pool,
    programDataSha256:config.programDataSha256,sourceRevision:'b'.repeat(40),binary:{bytes:100,sha256:'c'.repeat(64)},
    independentReview:{reviewer:'fixture-only',reference:'fixture-only',sourceRevision:'b'.repeat(40),binarySha256:'c'.repeat(64)},
    developerLockPeriodsSeconds:[21600,43200,86400,172800]};
  assert.equal(priceReviewNetwork(config,request,{release}).genesisHash,SOLANA_GENESIS['mainnet-beta']);
  for(const field of ['programDataSha256','upgradeAuthority','mint','pool'])
    assert.throws(()=>priceReviewNetwork({...config,[field]:key()},request,{release}),/reviewed/);
  assert.throws(()=>priceReviewNetwork(config,{...request,cluster:'devnet'},{release}),/network/);
  assert.throws(()=>priceReviewNetwork(config,request,{release:{...release,status:'placeholder'}}),/reviewed/);
});
