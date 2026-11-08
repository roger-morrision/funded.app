import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {prepareMainnetDeployment} from '../scripts/prepare-mainnet-deployment.mjs';
import {rentExempt} from '../scripts/estimate-program-deploy-cost.mjs';
import {assessMainnetConfig,mainnetProgramRoles,readMainnetProgramEvidence,mainnetReadinessPreflight} from '../scripts/mainnet-readiness-preflight.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const program=new PublicKey(new Uint8Array(32).fill(1)),authority=new PublicKey(new Uint8Array(32).fill(2));
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const pda=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
const data=Buffer.alloc(49);data.writeUInt32LE(3);data[12]=1;authority.toBuffer().copy(data,13);
const hash=sha(data);
function env(){return {MAINNET_PROGRAM_LAYOUT:'merged-v3',VITE_SOLANA_CLUSTER:'mainnet-beta',SOLANA_CLUSTER:'mainnet-beta',
  VITE_MAINNET_READ_ONLY:'true',VITE_ALLOW_MAINNET:'false',MAINNET_APP_ORIGIN:'https://staging.funded.example',
  FUNDED_TRADE_FEE_OWNER:authority.toBase58(),VITE_FUNDED_TRADE_FEE_OWNER:authority.toBase58(),
  FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program.toBase58(),FUNDED_V3_PROGRAM_DATA_SHA256:hash,
  FUNDED_DEVELOPER_LOCK_PROGRAM_ID:program.toBase58(),FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:hash,
  VITE_FUNDED_FEE_ROUTER_PROGRAM_ID:program.toBase58(),MAINNET_APPROVED_UPGRADE_AUTHORITY:authority.toBase58(),
  FUNDED_TOKEN_MINT:program.toBase58(),VITE_FUNDED_TOKEN_MINT:program.toBase58(),METADATA_STORAGE:'pinata',PINATA_JWT_FILE:'/run/secrets/metadata',
  SOLANA_RPC_URL:'https://rpc.production.example',DEVNET_SOLANA_RPC_URL:'https://rpc.devnet.example',
  DATABASE_URL:'postgresql://localhost/mainnet',DEVNET_DATABASE_URL:'postgresql://localhost/devnet'};}

test('one merged program satisfies both roles without requiring a separate legacy router',async()=>{
  const values=env(),config=assessMainnetConfig(values);assert(config.configurationComplete);
  assert.deepEqual(mainnetProgramRoles(values,config).map(([role])=>role),['v3-router','developer-escrow']);
  const programData=Buffer.alloc(36);programData.writeUInt32LE(2);pda.toBuffer().copy(programData,4);
  let reads=0;
  const connectionFactory=()=>({getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta'],getAccountInfo:async key=>{
    reads++;return key.equals(program)?{owner:loader,executable:true,data:programData}:{owner:loader,executable:false,data};
  }});
  const proof=await readMainnetProgramEvidence(values,config,{connectionFactory});assert.equal(proof.status,'verified');assert.equal(reads,2);
  assert.equal(proof.programs.length,2);
  const report=await mainnetReadinessPreflight(values);assert.equal(report.ready,false);assert.equal(report.status,'no-go');
});

test('merged preflight rejects split identities, mixed hashes, authority ambiguity and enabled writes',()=>{
  for(const changes of [{FUNDED_DEVELOPER_LOCK_PROGRAM_ID:authority.toBase58()},
    {FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:'ff'.repeat(32)},{FUNDED_REWARD_PROGRAM_DATA_SHA256:'ff'.repeat(32)},
    {FUNDED_FEE_ROUTER_PROGRAM_ID:authority.toBase58()},{MAINNET_PROGRAM_LAYOUT:'unknown'},
    {MAINNET_APPROVED_IMMUTABLE_PROGRAM:'true'},
    {MAINNET_APPROVED_UPGRADE_AUTHORITY:'',MAINNET_APPROVED_IMMUTABLE_PROGRAM:'true'},
    {VITE_ALLOW_MAINNET:'true'},{VITE_DEV_MODE:'true'},
    {PINATA_JWT_FILE:'REPLACE_WITH_METADATA_SECRET'},{SOLANA_RPC_URL:'https://replace_with_rpc.invalid'}])
    assert.equal(assessMainnetConfig({...env(),...changes}).configurationComplete,false,JSON.stringify(changes));
  const old={...env(),MAINNET_PROGRAM_LAYOUT:'legacy-three-role',FUNDED_FEE_ROUTER_PROGRAM_ID:program.toBase58(),FUNDED_REWARD_PROGRAM_DATA_SHA256:hash};
  assert.equal(mainnetProgramRoles(old,assessMainnetConfig(old)).length,3);
});

test('online inventory refuses a wrong network before reading program accounts',async()=>{
  let read=false;const values=env();
  const result=await readMainnetProgramEvidence(values,assessMainnetConfig(values),{connectionFactory:()=>({
    getGenesisHash:async()=>SOLANA_GENESIS.devnet,getAccountInfo:async()=>{read=true;}})});
  assert.equal(result.status,'blocked');assert.equal(read,false);
});

function fixture(){
  const dir=fs.mkdtempSync(join(tmpdir(),'funded-mainnet-plan-')),binary=Buffer.alloc(1000);binary.set([127,69,76,70]);
  fs.writeFileSync(join(dir,'program.so'),binary);
  const plan={schemaVersion:1,cluster:'mainnet-beta',genesisHash:SOLANA_GENESIS['mainnet-beta'],mainnetActivationAuthorized:false,
    sourceRevision:'a'.repeat(40),targetLayout:'merged-v3',roles:['v3-router','developer-escrow'],feeAllowanceLamports:25_000_000,deploymentMarginLamports:250_000_000,
    referenceArtifacts:[{variant:'reference',file:'program.so',bytes:binary.length,sha256:sha(binary),deployEligible:false}],excludedCosts:[],sequence:[]};
  return {dir,plan,binary,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('planner verifies bytes, obtains Mainnet rent, and does not double-count buffer funding',async()=>{
  const f=fixture();try{
    const queries=[],connection={getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta'],getSlot:async()=>123,
      getMinimumBalanceForRentExemption:async size=>{queries.push(size);return rentExempt(size);}};
    const r=await prepareMainnetDeployment(f.plan,{artifactDir:f.dir,connection});
    assert.equal(r.quote.status,'live-mainnet-rent');assert.equal(r.quote.finalizedSlot,123);
    assert.deepEqual(queries,[36,1045,1037]);assert.equal(r.rows[0].lockedLamports,rentExempt(36)+rentExempt(1045));
    assert.equal(r.rows[0].freshDeploymentFundingBeforeFeesLamports,r.rows[0].lockedLamports);
    assert.equal(r.ready,false);assert.equal(r.mainnetActivationAuthorized,false);assert(r.missingInputs.includes('upgradeAuthority'));
    const offline=await prepareMainnetDeployment(f.plan,{artifactDir:f.dir});assert.equal(offline.quote.status,'offline-assumption');
  }finally{f.cleanup();}
});
test('planner rejects a wrong chain, tampered artifact, path escape and deployment authorization',async()=>{
  const f=fixture();try{
    await assert.rejects(()=>prepareMainnetDeployment(f.plan,{artifactDir:f.dir,connection:{getGenesisHash:async()=>SOLANA_GENESIS.devnet}}),/not Mainnet/);
    await assert.rejects(()=>prepareMainnetDeployment({...f.plan,mainnetActivationAuthorized:true},{artifactDir:f.dir}),/must not authorize/);
    await assert.rejects(()=>prepareMainnetDeployment({...f.plan,referenceArtifacts:[{...f.plan.referenceArtifacts[0],file:'../escape.so'}]},{artifactDir:f.dir}),/escapes/);
    f.binary[999]=1;fs.writeFileSync(join(f.dir,'program.so'),f.binary);
    await assert.rejects(()=>prepareMainnetDeployment(f.plan,{artifactDir:f.dir}),/hash differs/);
  }finally{f.cleanup();}
});
