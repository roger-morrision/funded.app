import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey} from '@solana/web3.js';
import {reviewedMainnetManifest,MAINNET_REVIEWED_PROGRAM_ID} from '../mainnet-program.js';
import {mainnetReleaseVerified} from '../server/mainnet-program.mjs';
import {agencyReleaseVerified} from '../server/agency-release.mjs';
import {readAgencyDeployment,agencyBuybackWorkerHealth} from '../server/agency-deployment.mjs';
import {developerLockConfig} from '../server/developer-token-lock.mjs';
import {loadMainnetConfig} from '../scripts/mainnet-config.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
import {createLaunchTierPricing} from '../server/launch-tier-pricing.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
function fixture(){
 const program=Keypair.generate().publicKey,authority=Keypair.generate().publicKey,binary=Buffer.from([127,69,76,70,1,2,3]);
 const address=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
 const header=Buffer.alloc(36);header.writeUInt32LE(2);address.toBuffer().copy(header,4);
 const bytes=Buffer.alloc(45+binary.length+10);bytes.writeUInt32LE(3);bytes[12]=1;authority.toBuffer().copy(bytes,13);binary.copy(bytes,45);
 const manifest={schemaVersion:1,cluster:'mainnet-beta',status:'reviewed',programId:program.toBase58(),upgradeAuthority:authority.toBase58(),
  programDataSha256:sha(bytes),sourceRevision:'ab'.repeat(20),binary:{bytes:binary.length,sha256:sha(binary)},
  independentReview:{reviewer:'Test fixture only',reference:'fixture:test-only',sourceRevision:'ab'.repeat(20),binarySha256:sha(binary)},
  developerLockPeriodsSeconds:[21600,43200,86400,172800]};
 const evidence={account:{owner:loader,executable:true,data:header},programData:{owner:loader,executable:false,data:bytes},programDataAddress:address.toBase58(),sha256:sha(bytes)};
 return{manifest,evidence,verify:()=>mainnetReleaseVerified(evidence,manifest.programId,manifest.programDataSha256,manifest)};
}
test('Mainnet placeholders and Devnet/test identities never become runtime trust',async()=>{
 assert.equal(reviewedMainnetManifest(),null);assert.equal(MAINNET_REVIEWED_PROGRAM_ID,null);
 const f=fixture();assert.equal(mainnetReleaseVerified(f.evidence,f.manifest.programId,f.manifest.programDataSha256),false);
 assert.equal(agencyReleaseVerified(f.evidence,f.manifest.programId,f.manifest.programDataSha256,{cluster:'mainnet-beta'}),false);
 for(const change of [{status:'awaiting-review'},{upgradeAuthority:null},{programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm'},
  {programId:'3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh'},{independentReview:{...f.manifest.independentReview,binarySha256:'ff'.repeat(32)}}])
  assert.equal(reviewedMainnetManifest({...f.manifest,...change}),null);
 const result=await developerLockConfig({cluster:'mainnet-beta',env:{},connection:{getGenesisHash:()=>{throw Error('No RPC needed for missing review');}}});
 assert.equal(result.ready,false);
});
test('reviewed Mainnet proof requires exact loader, PDA, authority, complete hash and executable bytes',()=>{
 let f=fixture();assert(f.verify());
 for(const change of [f=>{f.evidence.programData.data[12]=0;},f=>{f.evidence.programData.data[13]^=1;},
  f=>{f.evidence.programData.data[49]^=1;},f=>{f.evidence.programData.data[f.evidence.programData.data.length-1]=1;},
  f=>{f.evidence.programData.owner=Keypair.generate().publicKey;},f=>{f.evidence.account.data[4]^=1;},
  f=>{f.evidence.programDataAddress=Keypair.generate().publicKey.toBase58();},f=>{f.evidence.account.executable=false;}]){
  f=fixture();change(f);assert.equal(f.verify(),false);
 }
});
test('Mainnet agency proof checks genesis before account reads and worker heartbeats cannot cross networks',async()=>{
 let reads=0;
 await assert.rejects(()=>readAgencyDeployment({cluster:'mainnet-beta',connection:{getGenesisHash:async()=>SOLANA_GENESIS.devnet},
  readProgram:async()=>{reads++;},verifyRouter:async()=>{reads++;}}),/network/);assert.equal(reads,0);
 const options={programId:'p',approvedHash:'h',authority:'a',revision:'1',build:'ab'.repeat(20),cluster:'mainnet-beta'};
 const row={status:'ready',version:'agency-buyback-executor-v1',cluster:'devnet',programId:'p',approvedHash:'h',authority:'a',configRevision:'1',
  build:options.build,capabilities:['buyback-100k','buyback-300k'],checkedAt:new Date().toISOString()};
 assert.equal(agencyBuybackWorkerHealth({adminSettings:{agencyBuybackWorker:row}},options),false);
 row.cluster='mainnet-beta';assert.equal(agencyBuybackWorkerHealth({adminSettings:{agencyBuybackWorker:row}},options),true);
});
test('explicit Mainnet configuration resolves only declared URL secret files and ignores ambient Devnet values',()=>{
 const header='SOLANA_CLUSTER=mainnet-beta\nVITE_SOLANA_CLUSTER=mainnet-beta\n';let reads=0;
 const env=loadMainnetConfig('fixture.env',{read:path=>{reads++;return path.endsWith('fixture.env')?header+'SOLANA_RPC_URL_FILE=rpc.secret\nDATABASE_URL_FILE=REPLACE_DATABASE\n':'https://rpc.test.invalid';}});
 assert.equal(reads,2);assert.equal(env.SOLANA_RPC_URL,'https://rpc.test.invalid');assert.equal(env.DATABASE_URL,undefined);assert.equal(env.FUNDED_SKIP_LOCAL_ENV,'true');
 assert.throws(()=>loadMainnetConfig('fixture.env',{read:()=>header+'SOLANA_RPC_URL_FILE=rpc.secret\nSOLANA_RPC_URL=https://inline.invalid'}),/both sources/);
 assert.throws(()=>loadMainnetConfig('fixture.env',{read:()=>header.replace('SOLANA_CLUSTER=mainnet-beta','SOLANA_CLUSTER=devnet')}),/both server and client/);
 assert.throws(()=>loadMainnetConfig('fixture.env',{read:path=>{if(path.endsWith('fixture.env'))return header+'SOLANA_RPC_URL_FILE=rpc.secret';throw Error('sensitive error');}}),error=>!error.message.includes('sensitive')&&/Cannot read/.test(error.message));
});
test('promotion pricing checks the selected genesis before pool reads and binds cached quotes to that network',async()=>{
 let reads=0,genesis=SOLANA_GENESIS.devnet;
 const pricing=createLaunchTierPricing({solanaCluster:'mainnet-beta',fundedTokenMint:'configured-mint',fundedSwapPool:'configured-pool',
  connectionFactory:()=>({getGenesisHash:async()=>genesis}),readSolUsdQuote:async()=>({priceUsd:100,fetchedAt:new Date().toISOString()}),
  fetchVerifiedPoolSnapshot:async()=>{reads++;return{spotPriceSol:0.01,pool:'configured-pool',slot:123};}});
 await assert.rejects(()=>pricing.currentLaunchTierPricing(),/network/);assert.equal(reads,0);
 genesis=SOLANA_GENESIS['mainnet-beta'];const [a,b]=await Promise.all([pricing.currentLaunchTierPricing(),pricing.currentLaunchTierPricing()]);
 assert.equal(a.cluster,'mainnet-beta');assert.equal(a.genesisHash,genesis);assert.equal(a,b);assert.equal(reads,1);
});
