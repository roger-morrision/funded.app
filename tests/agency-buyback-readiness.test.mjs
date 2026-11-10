import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {readAgencyBuybackReadiness} from '../server/agency-buyback-readiness.mjs';
import {createMarketingAgencyRoutes} from '../server/routes/marketing-agency.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';

function fixture(){
  const program=Keypair.generate().publicKey,signer=Keypair.generate().publicKey;
  const env={FUNDED_V3_AGENCY_ENABLED:'true',FUNDED_V3_AGENCY_BUYBACK_ENABLED:'true',FUNDED_DEVNET_BUYBACK_PRICE_SIGNER:signer.toBase58(),
    FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL:'https://signer.example.test/cosign',FUNDED_BUILD_ID:'a'.repeat(40),FUNDED_V3_PROGRAM_DATA_SHA256:'b'.repeat(64)};
  let account={owner:program,data:Buffer.concat([createHash('sha256').update('account:BuybackPriceConfig').digest().subarray(0,8),signer.toBuffer()])};
  let genesis=DEVNET_GENESIS_HASH;
  const connection={getGenesisHash:async()=>genesis,getAccountInfo:async()=>account};
  const read=()=>readAgencyBuybackReadiness({connection,programId:program.toBase58(),env});
  return {env,read,program,connection,setAccount:value=>{account=value;},setGenesis:value=>{genesis=value;}};
}
test('buybacks require configured service and the exact finalized on-chain signer account',async()=>{
  const f=fixture();assert.equal((await f.read()).ready,true);
  f.setAccount(null);assert.match((await f.read()).reason,/not activated/);
  f.setAccount({owner:f.program,data:Buffer.alloc(40)});assert.equal((await f.read()).ready,false);
  f.setGenesis('wrong-network');assert.equal((await f.read()).ready,false);
  delete f.env.FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL;assert.match((await f.read()).reason,/not configured/);
  f.env.FUNDED_V3_AGENCY_BUYBACK_ENABLED='false';assert.match((await f.read()).reason,/disabled/);
});
test('unavailable RPC and invalid signer settings fail closed',async()=>{
  const f=fixture();f.connection.getAccountInfo=async()=>{throw Error('timeout');};
  assert.match((await f.read()).reason,/unavailable/);
  f.env.FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL='http://signer.example.test';
  assert.match((await f.read()).reason,/unavailable/);
});
test('public capability keeps verified deployment separate from blocked execution and reports the reason',async()=>{
  const f=fixture();f.setAccount(null);
  const config={ready:true,programId:f.program.toBase58(),protocolSplit:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10},agency:{configRevision:'1',buybacks:await f.read()}};
  let payload;
  const handle=createMarketingAgencyRoutes({env:f.env,store:{read:async()=>({})},readLaunchConfig:async()=>config,respond:(_res,status,data)=>{assert.equal(status,200);payload=data;}});
  const request=()=>handle({method:'GET'},{},new URL('https://funded.test/api/marketing-agency'));
  await request();assert.equal(payload.active,true);assert.equal(payload.executionEnabled,false);
  assert(payload.agents.every(row=>!row.enabled));assert(payload.blockers.some(reason=>reason.includes('not activated')));
  // X being active must never substitute for a disabled or unverified buyback.
  f.env.X_POST_ENABLED='true';f.env.X_POST_ACCOUNT_STATUS='active';f.env.FUNDED_V3_AGENCY_BUYBACK_ENABLED='false';
  config.agency.buybacks={ready:true,reason:null};await request();
  assert.equal(payload.agents[0].enabled,true);assert(payload.agents.slice(1).every(row=>!row.enabled));
  f.env.FUNDED_V3_AGENCY_BUYBACK_ENABLED='true';await request();assert(payload.agents.every(row=>row.enabled));
  assert.deepEqual(payload.blockers,[]);
});

test('manual email promotion is available independently and never enables automatic execution',async()=>{
  const env={FUNDED_LAUNCH_POST_EMAIL_ENABLED:'true',FUNDED_ADMIN_EMAIL_PROVIDER:'gmail',
    FUNDED_ADMIN_EMAIL:'admin@richpad.fun',FUNDED_ADMIN_EMAIL_FROM:'admin@richpad.fun',FUNDED_ADMIN_GMAIL_APP_PASSWORD:'abcdefghijklmnop',X_POST_ENABLED:'false'};
  let payload;
  const handle=createMarketingAgencyRoutes({env,store:{read:async()=>({})},respond:(_res,_status,data)=>{payload=data;}});
  const request=()=>handle({method:'GET'},{},new URL('https://richpad.fun/api/marketing-agency'));
  await request();assert.equal(payload.agents[0].enabled,true);assert.equal(payload.agents[0].deliveryMode,'admin-email');
  assert.equal(payload.agents[0].status,'manual-ready');assert.equal(payload.executionEnabled,false);
  assert(payload.agents.slice(1).every(row=>!row.enabled));assert.equal(payload.publishingPaused,true);
  env.FUNDED_API_ONLY='true';await request();assert.equal(payload.agents[0].enabled,false);
  env.FUNDED_API_ONLY='false';env.FUNDED_ADMIN_GMAIL_APP_PASSWORD='';await request();assert.equal(payload.agents[0].enabled,false);
});
