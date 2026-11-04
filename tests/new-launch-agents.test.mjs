import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {NEW_LAUNCH_AGENT_IDS as ids,MARKETING_AGENCY_POLICY as policy,newLaunchAgencySelection} from '../config/marketing-agency.js';
import {readLaunchAgencySelection} from '../src/features/marketing/agency-selection.js';
import {createLaunchRegistrationRoutes} from '../server/routes/launch-registration.mjs';
import {buildLaunchMintRouter} from '../launch-flow.js';
import {projectAgencyAllocation} from '../server/marketing-agency-policy.mjs';
import {agencyProtocolSplit} from '../agency-mint-router-v3.js';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey,[mint,wallet,program]=[21,22,23].map(key),split=agencyProtocolSplit();
const agency={version:policy.version,configRevision:'2'};
function input(selectedAgents,x=false,promotion=false){return{chain:'solana',cluster:'devnet',mint:String(mint),creatorWallet:String(wallet),communityAllocation:3,
  signature:'fixture-only',pumpFeeRoute:{scope:'per-mint-v3',router:String(wallet),programId:String(program),initialAuthority:String(wallet),protocolSplit:split},
  ...(promotion?{creatorLaunchBurn:{tier:'pro',amountTokens:100000,fundedMint:String(mint),quoteId:'fixture-promotion'}}:{}),
  marketingAgency:{...agency,selectedAgents},...(x?{xUserId:'123'}:{}),feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:x?70:80,holderAirdropPercent:0,solClaimPercent:x?10:0},recipients:{xAccount:x?'@rewarded':''}}}};}
async function register(data,existing=null){let result;
  const handle=createLaunchRegistrationRoutes({solanaCluster:'devnet',solanaRpcUrl:'https://fixture.invalid',body:async()=>data,
    env:{FUNDED_V3_AGENCY_ENABLED:'true'},store:{readLaunch:async()=>existing,read:async()=>({})},
    v3LaunchConfig:async()=>({ready:true,beneficiaryRoutingOnChainEnforced:true,agency}),
    respond:(_res,status,body)=>{result={status,body};}});
  await handle({method:'POST'},{},new URL('https://fixture.invalid/api/launches'));return result;}

test('launch preparation binds promotion-only X promotion to the signed on-chain selection',()=>{
  for(const promoted of [false,true]){
    const selected=readLaunchAgencySelection({requiresBurn:promoted});
    assert.deepEqual(selected,promoted?ids:ids.slice(1));
    const copy=readLaunchAgencySelection({requiresBurn:promoted});copy.pop();assert.deepEqual(readLaunchAgencySelection({requiresBurn:promoted}),selected);
    const built=buildLaunchMintRouter({mint,payer:wallet,v3FeeRouter:{programId:program,initialAuthority:wallet,split,agency:{...agency,selectedAgents:selected}},feeShares:{creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0}});
    assert.equal(built.selectedMask,promoted?7:6);
  }
  assert.deepEqual(readLaunchAgencySelection({querySelectorAll:()=>ids}),ids.slice(1));
});

test('registration rejects agent selections that do not match the promotion package before any chain calls',async()=>{
  for(const promoted of [false,true])for(let mask=0;mask<8;mask++){
    const result=await register(input(ids.filter((_,i)=>mask&(1<<i)),false,promoted));
    assert.equal(result.status,409);
    assert.match(result.body.error,mask===(promoted?7:6)?/saved launch service fee quote/:/signed agents must match the launch package/);
  }
  const reversed=await register(input([...newLaunchAgencySelection()].reverse()));assert.match(reversed.body.error,/saved launch service fee quote/);
});

test('the unchanged 2% agency budget funds only the included agents',()=>{
  for(const promotion of [false,true]){
    const selectedAgents=newLaunchAgencySelection({promotion}),allocation=projectAgencyAllocation({totalGrossLamports:'100000000000',selectedAgents});
    assert.equal(allocation.agencyLamports,'2000000000');
    assert.deepEqual(allocation.agents.map(a=>a.id),selectedAgents);
    assert.equal(allocation.agents.reduce((n,a)=>n+BigInt(a.lamports),0n),2000000000n);
    if(!promotion)assert(allocation.agents.every(a=>a.lamports==='1000000000'));
  }
});

test('historical registration keeps its signed subset and still passes through existing payout gates',async()=>{
  for(const selected of [[],[ids[0]],[...ids]]){
    const result=await register(input(selected,true),{mint:String(mint)});
    assert.equal(result.status,503);assert.match(result.body.error,/X payout and claim verification/);
  }
});
