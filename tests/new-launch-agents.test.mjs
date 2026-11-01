import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {NEW_LAUNCH_AGENT_IDS as ids,MARKETING_AGENCY_POLICY as policy} from '../config/marketing-agency.js';
import {readLaunchAgencySelection} from '../src/features/marketing/agency-selection.js';
import {createLaunchRegistrationRoutes} from '../server/routes/launch-registration.mjs';
import {buildLaunchMintRouter} from '../launch-flow.js';
import {agencyProtocolSplit} from '../agency-mint-router-v3.js';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey,[mint,wallet,program]=[21,22,23].map(key),split=agencyProtocolSplit();
const agency={version:policy.version,configRevision:'2'};
function input(selectedAgents,x=false){return{chain:'solana',cluster:'devnet',mint:String(mint),creatorWallet:String(wallet),communityAllocation:3,
  signature:'fixture-only',pumpFeeRoute:{scope:'per-mint-v3',router:String(wallet),programId:String(program),initialAuthority:String(wallet),protocolSplit:split},
  marketingAgency:{...agency,selectedAgents},...(x?{xUserId:'123'}:{}),feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:x?70:80,holderAirdropPercent:0,solClaimPercent:x?10:0},recipients:{xAccount:x?'@rewarded':''}}}};}
async function register(data,existing=null){let result;
  const handle=createLaunchRegistrationRoutes({solanaCluster:'devnet',solanaRpcUrl:'https://fixture.invalid',body:async()=>data,
    env:{FUNDED_V3_AGENCY_ENABLED:'true'},store:{readLaunch:async()=>existing,read:async()=>({})},
    v3LaunchConfig:async()=>({ready:true,beneficiaryRoutingOnChainEnforced:true,agency}),
    respond:(_res,status,body)=>{result={status,body};}});
  await handle({method:'POST'},{},new URL('https://fixture.invalid/api/launches'));return result;}

test('new launch preparation includes every agent independently of editable DOM state',()=>{
  assert.deepEqual(readLaunchAgencySelection({querySelectorAll:()=>[]}),ids);
  const copy=readLaunchAgencySelection();copy.pop();assert.deepEqual(readLaunchAgencySelection(),ids);
  const built=buildLaunchMintRouter({mint,payer:wallet,v3FeeRouter:{programId:program,initialAuthority:wallet,split,agency:{...agency,selectedAgents:readLaunchAgencySelection()}},
    feeShares:{creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0}});
  assert.equal(built.selectedMask,7);
});

test('new registration rejects every incomplete team before quotes, signatures or chain calls',async()=>{
  for(let mask=0;mask<7;mask++){
    const result=await register(input(ids.filter((_,i)=>mask&(1<<i))));
    assert.equal(result.status,409);assert.match(result.body.error,/all three AI marketing agents/);
  }
  const complete=await register(input([...ids].reverse()));assert.equal(complete.status,409);
  assert.match(complete.body.error,/saved launch service fee quote/);
});

test('historical registration keeps its signed subset and still passes through existing payout gates',async()=>{
  for(const selected of [[],[ids[0]],[...ids]]){
    const result=await register(input(selected,true),{mint:String(mint)});
    assert.equal(result.status,503);assert.match(result.body.error,/X payout and claim verification/);
  }
});
