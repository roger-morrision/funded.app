import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createV3LaunchConfig} from '../server/v3-launch-config.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {PROTOCOL_FEE_SPLIT} from '../config/protocol-fee-split.js';

function fixture(){
  const authority=Keypair.generate(),program=Keypair.generate().publicKey.toBase58();
  const env={FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program,FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),FUNDED_BUILD_ID:'b'.repeat(40),
    FUNDED_V3_AGENCY_ENABLED:'true',FUNDED_V3_AGENCY_NORMAL_FLOWS_ENABLED:'true',FUNDED_V3_LAUNCH_ENABLED:'true',
    FUNDED_V3_COLLECTION_ENABLED:'true',FUNDED_V3_SETTLEMENT_ENABLED:'true',FUNDED_V3_HOLDER_WORKER_ENABLED:'true',
    FUNDED_V3_BUYBACK_ENABLED:'true',FUNDED_V3_AGENCY_BUYBACK_ENABLED:'false',X_POST_ENABLED:'false',
    FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE:Keypair.generate().publicKey.toBase58(),FUNDED_V3_BUYBACK_LOOKUP_TABLE:Keypair.generate().publicKey.toBase58()};
  let valid=true;
  const read=createV3LaunchConfig({env,solanaCluster:'devnet',solanaRpcUrl:'https://rpc.example.test',v3AuthorityKeypair:()=>authority,
    automaticRewardStore:{read:async()=>({serviceStatus:{constrainedPayouts:true,checkedAt:new Date().toISOString(),reasons:[]}})},
    store:{read:async()=>({})},connectionFactory:()=>({getGenesisHash:async()=>DEVNET_GENESIS_HASH,
      getAddressLookupTable:async()=>({value:{state:{deactivationSlot:18446744073709551615n}}})}),
    programEvidence:async()=>({account:{executable:true},sha256:valid?env.FUNDED_V3_PROGRAM_DATA_SHA256:'wrong'}),
    verifyRouter:async()=>({verified:true,authority:authority.publicKey}),
    readAgency:async()=>({verified:true,revision:1,protocolSplit:PROTOCOL_FEE_SPLIT}),
    readBuybackReadiness:async()=>({ready:false,reason:'Milestone buybacks are disabled.'})});
  return{env,read,invalidate:()=>{valid=false;}};
}

test('disabled optional agency actions do not block verified normal launch and RICH readiness',async()=>{
  const f=fixture(),result=await f.read();
  assert.equal(result.ready,true);assert.equal(result.beneficiaryRoutingOnChainEnforced,true);
  assert.equal(result.agency.buybacks.ready,false);assert.deepEqual(result.reasons,[]);
  f.invalidate();const invalid=await f.read();assert.equal(invalid.ready,false);
  assert(invalid.reasons.some(x=>x.includes('program or authority')));
});

test('enabled agency buybacks or active X publishing still require matching worker evidence',async()=>{
  for(const mode of ['buybacks','x']){
    const f=fixture();
    if(mode==='buybacks')f.env.FUNDED_V3_AGENCY_BUYBACK_ENABLED='true';
    else Object.assign(f.env,{X_POST_ENABLED:'true',X_POST_ACCOUNT_STATUS:'active'});
    const result=await f.read();assert.equal(result.ready,false);assert.equal(result.agency.buybacks.ready,false);
    assert(result.reasons.some(x=>x.includes('Agency worker')));
  }
});
