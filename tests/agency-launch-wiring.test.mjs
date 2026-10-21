import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {buildLaunchMintRouter} from '../launch-flow.js';
import {buildFeeRouterPolicy} from '../fee-router.js';
import {canonicalLaunchPolicy,launchPolicyStatement} from '../launch-policy-auth.js';
import {buildFeeDistributionPolicy} from '../distribution-policy.js';
import {agencyProtocolSplit,agencyDiscriminator} from '../agency-mint-router-v3.js';
import {createV3LaunchConfig} from '../server/v3-launch-config.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey,[program,mint,creator,authority,lookup]=[241,242,243,244,245].map(key),split=agencyProtocolSplit();
const agency={version:'marketing-agency-v1',configRevision:'2',selectedAgents:['buyback-300k','x-promotion']};
const shares={creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0};
test('normal launch uses the separate immutable agency initializer even when no team is selected',()=>{
  const v3={programId:program,initialAuthority:authority,split,agency};
  for(const selectedAgents of [agency.selectedAgents,[]]){
    const built=buildLaunchMintRouter({mint,payer:creator,v3FeeRouter:{...v3,agency:{...agency,selectedAgents}},feeShares:shares});
    assert(built.instruction.data.subarray(0,8).equals(agencyDiscriminator('initialize_agency_mint_v3')));
    assert.equal(built.selectedMask,selectedAgents.length?5:0);assert.equal(built.instruction.data.readBigUInt64LE(21),2n);
    assert.equal(buildFeeRouterPolicy({...built.router,scope:'per-mint-v3',agencyPolicy:true}).settlement.rule,
      'on-chain-eight-category-80-percent-creator-20-percent-protocol-allocation');
  }
  assert.throws(()=>buildLaunchMintRouter({mint,payer:creator,v3FeeRouter:{...v3,agency:null},feeShares:shares}),/verified dedicated agency/);
});
test('creator signature binds canonical selected agents and config revision; historical statement shape remains untouched',()=>{
  const input={mint:mint.toBase58(),creatorWallet:creator.toBase58(),cluster:'devnet',signature:'launch',communityAllocation:3,
    pumpFeeRoute:{scope:'per-mint-v3',programId:program.toBase58(),initialAuthority:authority.toBase58(),router:creator.toBase58(),protocolSplit:split},
    marketingAgency:agency,feeDistribution:buildFeeDistributionPolicy(shares,{fundedSplit:split})};
  const canonical=canonicalLaunchPolicy(input);assert.deepEqual(canonical.marketingAgency.selectedAgents,['x-promotion','buyback-300k']);
  const statement=launchPolicyStatement(input);
  assert.notEqual(statement,launchPolicyStatement({...input,marketingAgency:{...agency,selectedAgents:[]}}));
  assert.notEqual(statement,launchPolicyStatement({...input,marketingAgency:{...agency,configRevision:'3'}}));
  assert.throws(()=>canonicalLaunchPolicy({...input,marketingAgency:undefined}),/immutable agency/);
  assert.throws(()=>canonicalLaunchPolicy({...input,marketingAgency:{...agency,selectedAgents:['unknown']}}));
});

test('configured agency rates work through launch preparation and the signed policy without relaxing the fixed protocol share',()=>{
  for(const agencyPercent of [0,15]){
    const configured={...split,agencyPercent,operationsPercent:split.operationsPercent+split.agencyPercent-agencyPercent};
    const v3={programId:program,initialAuthority:authority,split:configured,agency};
    const built=buildLaunchMintRouter({mint,payer:creator,v3FeeRouter:v3,feeShares:shares});
    assert(built.instruction.data.subarray(0,8).equals(agencyDiscriminator('initialize_agency_mint_v3')));
    const input={mint:String(mint),creatorWallet:String(creator),cluster:'devnet',signature:'launch',communityAllocation:3,
      pumpFeeRoute:{scope:'per-mint-v3',programId:String(program),initialAuthority:String(authority),router:String(creator),protocolSplit:configured},
      marketingAgency:agency,feeDistribution:buildFeeDistributionPolicy(shares,{fundedSplit:configured})};
    assert.equal(canonicalLaunchPolicy(input).protocolSplit.agencyPercent,agencyPercent);
    assert.notEqual(launchPolicyStatement(input),launchPolicyStatement({...input,pumpFeeRoute:{...input.pumpFeeRoute,protocolSplit:split}}));
    const invalid={...configured,operationsPercent:configured.operationsPercent+1};
    assert.throws(()=>buildLaunchMintRouter({mint,payer:creator,v3FeeRouter:{...v3,split:invalid},feeShares:shares}),/totaling 100%/);
    assert.throws(()=>canonicalLaunchPolicy({...input,pumpFeeRoute:{...input.pumpFeeRoute,protocolSplit:invalid}}),/totaling 100%/);
  }
});
test('normal agency launch readiness requires explicit acceptance, verified chain config, matching published split and fresh exact-build worker',async()=>{
  const hash='a'.repeat(64),build='b'.repeat(40),authorityString=authority.toBase58();
  const state={adminSettings:{protocolFeePolicy:{split},agencyWorker:{status:'ready',version:'agency-executor-v1',cluster:'devnet',
    programId:program.toBase58(),approvedHash:hash,authority:authorityString,configRevision:'2',build,xAccountId:'123',
    capabilities:['x-promotion','buyback-100k','buyback-300k'],checkedAt:new Date().toISOString()}}};
  const env={FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program.toBase58(),FUNDED_V3_PROGRAM_DATA_SHA256:hash,FUNDED_BUILD_ID:build,
    FUNDED_V3_LAUNCH_ENABLED:'true',FUNDED_V3_COLLECTION_ENABLED:'true',FUNDED_V3_SETTLEMENT_ENABLED:'true',FUNDED_V3_HOLDER_WORKER_ENABLED:'true',
    FUNDED_V3_BUYBACK_ENABLED:'true',FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE:lookup.toBase58(),FUNDED_V3_BUYBACK_LOOKUP_TABLE:lookup.toBase58(),
    FUNDED_V3_AGENCY_ENABLED:'true',FUNDED_V3_AGENCY_NORMAL_FLOWS_ENABLED:'true',X_POST_ENABLED:'true',X_POST_ACCOUNT_STATUS:'active'};
  const config=createV3LaunchConfig({solanaCluster:'devnet',solanaRpcUrl:'https://fixture.invalid',env,store:{read:async()=>state},
    automaticRewardStore:{read:async()=>({serviceStatus:{checkedAt:new Date().toISOString(),constrainedPayouts:true}})},v3AuthorityKeypair:()=>({publicKey:authority}),
    connectionFactory:()=>({getGenesisHash:async()=>DEVNET_GENESIS_HASH,getAddressLookupTable:async()=>({value:{state:{deactivationSlot:0xffffffffffffffffn}}})}),
    programEvidence:async()=>({sha256:hash,account:{executable:true}}),verifyRouter:async()=>({verified:true,authority}),
    readAgency:async()=>({verified:true,revision:'2',protocolSplit:split,...(state.configRules?{rules:state.configRules}:{})})});
  assert.equal((await config()).ready,true);assert.deepEqual((await config()).agency,{version:agency.version,configRevision:'2'});
  state.adminSettings.agencyWorker.build='c'.repeat(40);assert.equal((await config()).ready,false);state.adminSettings.agencyWorker.build=build;
  env.X_POST_ENABLED='false';env.X_POST_ACCOUNT_STATUS='suspended';assert.equal((await config()).ready,false);
  env.FUNDED_V3_AGENCY_BUYBACK_ENABLED='true';
  state.adminSettings.agencyBuybackWorker={...state.adminSettings.agencyWorker,version:'agency-buyback-executor-v1',capabilities:['buyback-100k','buyback-300k']};
  assert.equal((await config()).ready,true,'An independent verified buyback worker must not require X reinstatement.');
  state.configRules={marketCapUsd:[10,20],communityWindowSeconds:300,promotionIntervalSeconds:86400,source:'on-chain-snapshot'};
  assert.equal((await config()).ready,false,'Unpublished rules must close new-launch readiness.');
  state.adminSettings.protocolFeePolicy.configRevision='2';state.adminSettings.protocolFeePolicy.rules=state.configRules;
  assert.equal((await config()).ready,true);
  env.FUNDED_V3_AGENCY_NORMAL_FLOWS_ENABLED='false';assert.equal((await config()).ready,false);
});
