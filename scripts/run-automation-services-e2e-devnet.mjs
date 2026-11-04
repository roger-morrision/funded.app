import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,VersionedTransaction} from '@solana/web3.js';
import {devnetAcceptanceFetch} from './devnet-acceptance-fetch.mjs';
import {finalizedSend,readProgramDataEvidence} from '../server/automatic-reward-chain.mjs';
import {submitPumpDevnetLaunch} from '../launch-flow.js';
import {buildFeeDistributionPolicy} from '../distribution-policy.js';
import {launchPolicyStatement} from '../launch-policy-auth.js';
import {metadataStatement} from '../devnet-metadata.js';
import {buildTradeTransaction} from '../pump-trading.js';
import {OnlinePumpSdk,PUMP_SDK} from '@pump-fun/pump-sdk';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';

const base='http://127.0.0.1:8788',output='tmp/automation-release/services-e2e.json';
const resume=process.argv.includes('--resume');
const report=resume?JSON.parse(await readFile(output,'utf8')):{status:'running',cluster:'devnet',checks:[],transactions:[],limitations:[
  'Real Pump migration, elapsed holder eligibility and daily ranking windows are not fabricated.',
  'X publishing and OAuth are not invoked by this on-chain test.']};
const save=()=>writeFile(output,JSON.stringify(report,null,2));
async function record(stage,data={}){report.checks.push({stage,...data});await save();console.log(JSON.stringify({stage,...data}));}
const authority=Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY||''));
assert.equal(authority.publicKey.toBase58(),'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const connection=new Connection(process.env.FUNDED_AUTOMATION_RPC_URL,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:devnetAcceptanceFetch()});
assert.equal(await connection.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const deployment=JSON.parse(await readFile('tmp/automation-release/deployed-program.json','utf8'));
assert.equal((await readProgramDataEvidence(connection,deployment.program)).sha256,deployment.programDataSha256);
const tokenScript="import{readFileSync}from'node:fs';process.stdout.write(process.env.FUNDED_API_TOKEN||readFileSync(process.env.FUNDED_API_TOKEN_FILE,'utf8').trim())";
const token=execFileSync('docker',['exec','fundedapp-app-1','node','--input-type=module','-e',tokenScript],{encoding:'utf8'}).trim();
async function api(path,body,{authorized=false,retryRead=false,retryRegistration=false}={}){
  for(let retry=0;;retry++){
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{origin:'https://funded.vip',
      ...(body?{'content-type':'application/json'}:{}),...(authorized?{authorization:'Bearer '+token}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
    const data=await response.json();
    if(retry<3&&(retryRead&&(!response.ok||data.ready===false)||retryRegistration&&response.status===503)){
      await new Promise(r=>setTimeout(r,15000));continue;
    }
    assert(response.ok,`${path}: ${response.status} ${JSON.stringify(data).slice(0,700)}`);return data;
  }
}
const config=await api('/api/v3-launch-config',null,{retryRead:true});assert(config.ready);assert(config.agency);
report.build=(await api('/api/status')).build;report.program=config.programId;report.programDataSha256=deployment.programDataSha256;
const creator=resume?{publicKey:new PublicKey(report.creator)}:Keypair.generate();report.creator=creator.publicKey.toBase58();await save();
const fees=await api('/api/service-fees');let registration;
if(!resume){
const funding=await finalizedSend(connection,new Transaction().add(SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:creator.publicKey,lamports:300000000})),[authority]);
await record('fund-ephemeral-creator',{signature:funding,lamports:'300000000',privateKeyPersisted:false});
const quote=await api('/api/launch-service-quote',{payer:creator.publicKey.toBase58(),expectedHash:fees.hash});
const reserve=await api('/api/launch-reserve-config',null,{retryRead:true});
const shares={creatorWalletPercent:70,holderAirdropPercent:10,solClaimPercent:0},selectedAgents=['buyback-100k','buyback-300k'];
const agency={...config.agency,selectedAgents};
const provider={signTransaction:async tx=>{if(tx instanceof VersionedTransaction)tx.sign([creator]);else tx.partialSign(creator);return tx;}};
const launch=await submitPumpDevnetLaunch({connection,provider,payer:creator.publicKey,useMintRouter:true,feeRouterProgramId:config.programId,
  v3FeeRouter:{...config,split:config.protocolSplit,agency},reserveConfig:reserve,
  launchServiceQuote:quote,input:{name:'Automation Services QA',symbol:'ASQA',supply:1000000000,decimals:6,
    reserveTokens:30000000,initialBuySol:0.01,feeShares:shares,maxInitialBuyLamports:'200000000'},
  prepareMetadata:async input=>{
    const metadata={...input,creatorWallet:creator.publicKey.toBase58(),description:'Disposable Devnet automation acceptance token.',imageSha256:''};
    metadata.signature=bs58.encode(nacl.sign.detached(Buffer.from(metadataStatement(metadata)),creator.secretKey));
    return (await api('/api/devnet-metadata',metadata)).uri;
  },onJournal:event=>{report.transactions.push(event);if(event.mint)report.mint=event.mint;writeFileSync(output,JSON.stringify(report,null,2));}});
report.mint=launch.mint.publicKey.toBase58();
registration={chain:'solana',cluster:'devnet',mint:report.mint,signature:launch.signature,metadataUri:launch.metadataUri,
  creatorWallet:creator.publicKey.toBase58(),communityAllocation:3,
  feeDistribution:buildFeeDistributionPolicy(shares,{fundedSplit:config.protocolSplit}),
  marketingAgency:{version:agency.version,configRevision:agency.configRevision,selectedAgents},
  pumpFeeRoute:{scope:'per-mint-v3',programId:config.programId,router:launch.feeRouter.toBase58(),
    initialAuthority:config.initialAuthority,protocolSplit:config.protocolSplit},
  launchServiceFee:{quoteId:quote.id,policyHash:quote.policyHash,amountLamports:quote.amountLamports,recipient:quote.recipient}};
registration.policySignature=bs58.encode(nacl.sign.detached(Buffer.from(launchPolicyStatement(registration)),creator.secretKey));
report.registration=registration;await save();
}else{registration=report.registration;assert(registration?.policySignature,'The immutable signed registration is required to resume');}
const registered=await api('/api/launches',registration,{retryRegistration:true});assert(registered.onchainVerified&&registered.communityReserve.verified);
await record('registered-agency-launch',{mint:report.mint,signature:registration.signature,reserve:registered.communityReserve,fee:registered.launchServiceFee});
for(let index=0;index<7;index++){
  if(report.checks.some(row=>row.stage==='funded-trade-'+index))continue;
  const sdk=new OnlinePumpSdk(connection),curve=await sdk.fetchBondingCurve(new PublicKey(report.mint));
  if(curve.complete&&!report.migration){
    const global=await sdk.fetchGlobal();
    const instruction=await PUMP_SDK.migrateV2Instruction({withdrawAuthority:global.withdrawAuthority,mint:new PublicKey(report.mint),
      user:authority.publicKey,quoteMint:curve.quoteMint,baseTokenProgram:TOKEN_2022_PROGRAM_ID,quoteTokenProgram:TOKEN_PROGRAM_ID});
    report.migration=await finalizedSend(connection,new Transaction().add(instruction),[authority]);
    await record('real-pump-migration',{signature:report.migration});
  }
  const trade=await buildTradeTransaction({connection,side:'buy',mint:report.mint,user:authority.publicKey,amount:0.5,
    feeOwner:fees.tradeRecipient,feeBps:fees.policy.tradeBps,slippagePercent:2});
  const signature=await finalizedSend(connection,new Transaction().add(...trade.instructions),[authority]);
  await record('funded-trade-'+index,{signature,sol:0.5});
  // Wake the deployed workers only after the last trade, using its real proof.
  if(index===6)await record('worker-wakeup',await api('/api/trades/finalized',{mint:report.mint,wallet:authority.publicKey.toBase58(),signature}));
}
await record('awaiting-deployed-workers');
for(let poll=0;poll<24;poll++){
  await new Promise(resolve=>setTimeout(resolve,30000));
  const candidates=await api('/api/keeper/collection-candidates',null,{authorized:true});
  const monitor=await api('/api/automation/status',null,{authorized:true});
  report.latest={candidates,monitor};await record('worker-observation',{poll,pendingSettlements:candidates.pendingV3Settlements.length,
    pendingDisbursements:candidates.pendingV3Disbursements.length,monitor});
  const activity=await api(`/api/tokens/${report.mint}/fee-activity`);report.feeActivity=activity;await save();
  if(activity.overview?.collections?.some(row=>row.settlement==='finalized'&&row.creatorWalletPayoutVerified
    &&row.communityFundingVerified&&row.creatorRewardFundingVerified&&row.operationsPayout==='finalized'))break;
}
report.status='worker-observation-complete-requires-receipt-review';await save();
