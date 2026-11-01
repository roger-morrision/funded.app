import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createLaunchRegistrationRoutes} from '../server/routes/launch-registration.mjs';
import {verifyV3LaunchRouterReadiness} from '../server/v3-launch-readiness.mjs';
import {agencyProtocolSplit} from '../agency-mint-router-v3.js';
import {deriveMintRouterV3,directedGrossUnits} from '../mint-router-v3.js';
import {MARKETING_AGENCY_POLICY,NEW_LAUNCH_AGENT_IDS,newLaunchAgencySelection} from '../config/marketing-agency.js';
const [mint,creator,authority,program]=[61,62,63,64].map(n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey);
const split=agencyProtocolSplit(),shares={creatorWalletPercent:70,holderAirdropPercent:10,solClaimPercent:0};
const selection={version:MARKETING_AGENCY_POLICY.version,configRevision:'5',selectedAgents:NEW_LAUNCH_AGENT_IDS};
const router=deriveMintRouterV3(program,mint).address;
async function register(revision,selectedAgents=revision==='6'?newLaunchAgencySelection():NEW_LAUNCH_AGENT_IDS){
 let response;
 const data={chain:'solana',cluster:'devnet',mint:String(mint),creatorWallet:String(creator),communityAllocation:3,
  signature:'test-only',marketingAgency:{...selection,selectedAgents,configRevision:revision},
  feeDistribution:{creatorDirected:{shares,recipients:{xAccount:''}}},
  pumpFeeRoute:{scope:'per-mint-v3',router:String(router),programId:String(program),initialAuthority:String(authority),protocolSplit:split}};
 const handle=createLaunchRegistrationRoutes({solanaCluster:'devnet',solanaRpcUrl:'https://fixture.invalid',body:async()=>data,
  env:{FUNDED_V3_AGENCY_ENABLED:'true'},store:{readLaunch:async()=>null,read:async()=>({})},
  v3LaunchConfig:async()=>({ready:true,beneficiaryRoutingOnChainEnforced:true,agency:{version:selection.version,configRevision:'6'}}),
  respond:(_res,status,data)=>{response={status,data};}});
 await handle({method:'POST'},{},new URL('https://fixture.invalid/api/launches'));return response;
}
test('completed older launches reach fee and proof validation after a global publication',async()=>{
 for(const revision of ['5','6']){const r=await register(revision);assert.equal(r.status,409);assert.match(r.data.error,/saved launch service fee/);}
 const future=await register('7');assert.equal(future.status,409);assert.match(future.data.error,/not available on this deployment/);
});

test('current-revision Standard launches cannot acquire X promotion or omit a buyback agent',async()=>{
 for(const agents of [NEW_LAUNCH_AGENT_IDS,['buyback-100k']]){
  const result=await register('6',agents);assert.equal(result.status,409);assert.match(result.data.error,/signed agents must match/);
 }
});
test('historical registration still requires its exact immutable revision and agents',async()=>{
 const policy={verified:true,protectedPolicy:true,agencyPolicy:true,directedUnits:directedGrossUnits(shares),configRevision:'5',selectedMask:7};
 const args={connection:{getGenesisHash:async()=>'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'},programId:program,
  expectedProgramDataSha256:'a'.repeat(64),mint,creatorWallet:creator,initialAuthority:authority,split,directedShares:shares,
  requireProtectedPolicy:true,agencySelection:selection,readEvidence:async()=>({account:{executable:true},sha256:'a'.repeat(64)}),
  verifyGlobal:async()=>({verified:true}),verifyRouter:async()=>({verified:true,address:router}),verifyPolicy:async()=>policy};
 assert.equal((await verifyV3LaunchRouterReadiness(args)).ready,true);
 policy.configRevision='4';assert.equal((await verifyV3LaunchRouterReadiness(args)).ready,false);
 policy.configRevision='5';policy.selectedMask=3;assert.equal((await verifyV3LaunchRouterReadiness(args)).ready,false);
 policy.selectedMask=7;policy.directedUnits=[0,0,8000000];assert.equal((await verifyV3LaunchRouterReadiness(args)).ready,false);
});
