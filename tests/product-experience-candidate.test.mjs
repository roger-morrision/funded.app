import test from 'node:test';
import assert from 'node:assert/strict';
import { publicExperienceSnapshot } from '../scripts/product-experience-snapshot.mjs';
import { candidateEnvironment,reviewedLoopback,readOnlyRpc } from '../scripts/product-experience-candidate.mjs';
import { verifyCandidateBurn } from '../scripts/product-experience-chain-proof.mjs';
import { financialRows } from '../src/features/experience/financial-model.js';
const mint='11111111111111111111111111111111',wallet='So11111111111111111111111111111111111111112',sig='3'.repeat(64);
test('candidate environment does not inherit credentials, wallets, databases or execution gates',()=>{
  const env=candidateEnvironment({port:8789,build:'local-candidate',storePath:'copy.json',rewardPath:'rewards.json',rpcUrl:'http://127.0.0.1:9000'},
    {PATH:'runtime',DATABASE_URL:'private',SOLANA_KEEPER_SECRET_KEY:'private',FUNDED_V3_ROUTER_AUTHORITY_KEYPAIR_PATH:'private',FUNDED_API_ONLY:'false',FUNDED_V3_BUYBACK_ENABLED:'true',NODE_OPTIONS:'--require untrusted',DEV_MODE:'true'});
  assert.equal(env.PATH,'runtime');assert.equal(env.HOST,'127.0.0.1');assert.equal(env.FUNDED_API_ONLY,'true');assert.equal(env.FUNDED_SKIP_LOCAL_ENV,'true');assert.equal(env.DEV_MODE,'false');
  for(const key of ['DATABASE_URL','SOLANA_KEEPER_SECRET_KEY','FUNDED_V3_ROUTER_AUTHORITY_KEYPAIR_PATH','FUNDED_V3_BUYBACK_ENABLED','NODE_OPTIONS'])assert.equal(env[key],undefined);
});
test('reviewed API origin must be explicit loopback without credentials or arbitrary paths',()=>{
  assert.equal(reviewedLoopback('http://127.0.0.1:8788'),'http://127.0.0.1:8788');
  for(const url of ['https://funded.vip','http://127.0.0.1:8788/api/status','http://secret@localhost:8788','http://127.0.0.1:8788/?token=private'])assert.throws(()=>reviewedLoopback(url));
});
test('snapshot omits auth and private profiles, strips unexpected keys, and excludes foreign financial records',()=>{
  const state={launches:{[mint]:{mint,cluster:'devnet',onchainVerified:true,creatorWallet:wallet,pumpFeeRoute:{programId:wallet,secretKey:'excluded'},feeDistribution:{},privateKey:'excluded'},foreign:{mint:'foreign',cluster:'mainnet-beta',onchainVerified:true}},
    creatorProfiles:{private:{workspacePreferences:{private:'excluded'},updates:[{text:'Unpublished'}]}},productIssues:{private:{description:'Excluded report'}},v3Settlements:{one:{mint,status:'finalized',tokenHash:'excluded'},foreign:{mint:'foreign'}}};
  const rewards={serviceStatus:{status:'active'},schedules:{ours:{mint,kind:'holder'},foreign:{mint:'foreign'}},dailyBonusSnapshots:{mixed:{snapshot:{sources:[{mint},{mint:'foreign'}]}}}};
  const result=publicExperienceSnapshot(state,rewards,{build:'test'});
  assert.deepEqual(Object.keys(result.state.launches),[mint]);assert.deepEqual(result.state.creatorProfiles,{});assert.equal(result.state.productIssues,undefined);assert.equal(result.rewards.serviceStatus,undefined);assert.equal(result.rewards.schedules.foreign,undefined);assert.equal(result.rewards.dailyBonusSnapshots.mixed,undefined);
  assert.doesNotMatch(JSON.stringify(result),/excluded|Unpublished|Excluded report/);assert.match(result.coverage,/not an atomic/);
});
test('read-only RPC relay rejects transaction broadcast and mixed batches before forwarding',async()=>{
  const relay=await readOnlyRpc('http://127.0.0.1:1');
  try{for(const value of [{method:'sendTransaction'},[{method:'getBalance'},{method:'sendTransaction'}],{method:'requestAirdrop'}]){
    const response=await fetch(relay.url,{method:'POST',body:JSON.stringify(value)});assert.equal(response.status,403);
  }assert.equal(relay.stats.forwarded,0);assert.equal(relay.stats.blocked,3);}finally{await new Promise(done=>relay.server.close(done));}
});
test('fresh burn verification rejects wrong network before inspecting any financial receipt',async()=>{
  await assert.rejects(verifyCandidateBurn({getGenesisHash:async()=> 'mainnet',getTransaction:()=>assert.fail('Wrong network must stop reads')},{},{}),/must be Solana Devnet/);
});
test('on-chain policy burns retain direct Explorer verification without an unsupported registry lookup',()=>{
  const receipt={mint,signature:sig,sourceKind:'onchain-policy',status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:'10'};
  assert.equal(financialRows({buybacks:{cluster:'devnet',receipts:[receipt]}})[0].receiptView,'explorer');
  assert.equal(financialRows({buybacks:{cluster:'devnet',receipts:[{...receipt,sourceKind:'collection'}]}})[0].receiptView,'exact');
});
