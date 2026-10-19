import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {MARKETING_AGENCY_POLICY as POLICY} from '../config/marketing-agency.js';
import {deriveAgencyPolicyV3,deriveAgencyVaultsV3,decodeAgencyPolicyV3} from '../agency-mint-router-v3.js';
import {protocolGrossUnits,deriveMintRouterV3} from '../mint-router-v3.js';
import {DEVNET_GENESIS_HASH,readProgramDataEvidence} from './automatic-reward-chain.mjs';
import {verifyFeeRouterAccount} from '../fee-router.js';
import {verifyPumpLaunch} from './launch-verification.mjs';
import {loadFinalizedV3PumpCollection} from './v3-finalized-collection.mjs';
import {loadFinalizedV3Settlement} from './v3-settlement-proof.mjs';
import {createFinalizedReadCache} from './finalized-read-cache.mjs';
import {agencyReleaseVerified} from './agency-release.mjs';

// This is an independent execution preflight. It does not infer fee funding
// from a DB allocation, an env switch, a vault donation, or a similar UI.
export async function readAgencyMintContext({connection,state,mint,programId,approvedHash,authority,
  readProgram=readProgramDataEvidence,verifyRelease=agencyReleaseVerified,verifyRouter=verifyFeeRouterAccount,verifyLaunch=verifyPumpLaunch,
  loadCollection=loadFinalizedV3PumpCollection,loadSettlement=loadFinalizedV3Settlement}){
  const launch=state.launches?.[mint],route=launch?.pumpFeeRoute;
  if(!launch?.onchainVerified||launch.cluster!=='devnet'||launch.mint!==mint||route?.scope!=='per-mint-v3'
    ||route.verified!==true||route.programId!==String(programId)||route.initialAuthority!==new PublicKey(authority).toBase58()
    ||launch.marketingAgency?.version!==POLICY.version||route.protocolSplit?.agencyPercent!==10
    ||!/^[a-f0-9]{64}$/.test(String(approvedHash)))throw new Error('An immutable agency-enabled Devnet launch is required.');
  const rpc=createFinalizedReadCache(connection);
  const[genesis,program,global]=await Promise.all([rpc.getGenesisHash(),readProgram(rpc,programId),verifyRouter({connection:rpc,programId,commitment:'finalized'})]);
  if(genesis!==DEVNET_GENESIS_HASH||!verifyRelease(program,programId,approvedHash)
    ||!global.verified||!global.authority?.equals(new PublicKey(authority)))throw new Error('The approved Devnet agency program and current authority are not verified.');
  const identity=deriveAgencyPolicyV3(programId,mint),vault=deriveAgencyVaultsV3(programId,mint)[7];
  const snapshot=await connection.getMultipleAccountsInfoAndContext([identity.address,vault],{commitment:'finalized'});
  if(!Number.isSafeInteger(snapshot?.context?.slot)||snapshot.context.slot<1||snapshot.value?.length!==2)
    throw new Error('A finalized agency custody snapshot is required.');
  const policy=decodeAgencyPolicyV3(snapshot.value[0],{programId,mint,creator:launch.creatorWallet,initialAuthority:route.initialAuthority,
    protocolUnits:protocolGrossUnits(route.protocolSplit),shares:launch.feeDistribution?.creatorDirected?.shares,
    selectedAgents:launch.marketingAgency.selectedAgents});
  const vaultInfo=snapshot.value[1],rent=BigInt(await rpc.getMinimumBalanceForRentExemption(0,'finalized'));
  const remaining=policy.paidLamports[7]-policy.withdrawnLamports[7];
  if(remaining>0n&&(!vaultInfo||!vaultInfo.owner?.equals(SystemProgram.programId)||vaultInfo.data?.length!==0
    ||BigInt(vaultInfo.lamports)<remaining+rent))throw new Error('Finalized agency funds or vault custody are incomplete.');
  const creation=await verifyLaunch({connection:rpc,mint,signature:launch.signature||route.transaction,commitment:'finalized',
    promotionClaim:null});
  const expectedRouter=deriveMintRouterV3(programId,mint).address.toBase58();
  if(creation?.onchainVerified!==true||creation.mint!==mint||creation.feePayer!==launch.creatorWallet||creation.creator!==expectedRouter
    ||creation.signature!==(launch.signature||route.transaction)||!Number.isSafeInteger(creation.slot)
    ||creation.slot<1||creation.slot>snapshot.context.slot)throw new Error('The actual Pump launch differs from this agency policy.');
  const proofs=[{signature:creation.signature,slot:creation.slot,cluster:'devnet',commitment:'finalized',verified:true}];
  const policyConnection=new Proxy(rpc,{get(target,name){if(name==='getAccountInfo')return async(address,...args)=>
    address.equals(identity.address)?snapshot.value[0]:target.getAccountInfo(address,...args);
    const value=target[name];return typeof value==='function'?value.bind(target):value;}});
  let gross=0n,funded=0n;
  const entries=Object.entries(state.v3Settlements||{}).filter(([,row])=>row.mint===mint&&row.status==='finalized');
  if(entries.length>2000)throw new Error('Agency funding history requires a larger reviewed index.');
  for(const[source,saved]of entries){
    const collection=state.collections?.[source];
    if(collection?.signature!==source||collection.mint!==mint||collection.scope!=='per-mint-v3'||collection.cluster!=='devnet'
      ||collection.status!=='collected'||collection.onchainVerified!==true||collection.attribution!=='mint-verified'
      ||collection.programId!==String(programId)||saved.collectionSignature!==source)throw new Error('Agency fee source attribution is incomplete.');
    const collected=await loadCollection({connection:rpc,signature:source,programId,mint,launch});
    if(!collected||collected.signature!==source||collected.router!==expectedRouter||collected.claimId.toString('hex')!==collection.claimId
      ||String(collected.expectedLamports)!==String(collection.collectedLamports))throw new Error('An agency source is not a verified Pump creator-fee collection.');
    const settled=await loadSettlement({connection:policyConnection,signature:saved.settlementSignature,programId,mint,
      authority:route.initialAuthority,creator:launch.creatorWallet,claimId:collected.claimId,
      expectedLamports:collected.expectedLamports,split:route.protocolSplit});
    if(!settled||settled.signature!==saved.settlementSignature||settled.mint!==mint||settled.categoryLamports?.length!==8
      ||!Number.isSafeInteger(settled.slot)||settled.slot>snapshot.context.slot)throw new Error('Finalized eight-category agency settlement is unavailable.');
    gross+=BigInt(settled.expectedLamports);funded+=BigInt(settled.categoryLamports[7]);
    proofs.push({signature:settled.signature,slot:settled.slot,cluster:'devnet',commitment:'finalized',verified:true});
  }
  if(gross!==policy.settledLamports||funded!==policy.paidLamports[7])throw new Error('Agency counters contain unverified or unindexed source funding.');
  const balance=await rpc.getBalance(new PublicKey(policy.promotionRecipient),'finalized');
  return{launch:{...launch,name:creation.name,symbol:creation.symbol},policy,vault,slot:snapshot.context.slot,remainingLamports:String(remaining),
    agentRemaining:policy.agentTargets.map((n,i)=>String(n-policy.agentSpent[i])),promotionRecipientReady:BigInt(balance)>=rent,
    policyFingerprint:createHash('sha256').update(snapshot.value[0].data).digest('hex'),proofs,
    verified:true,cluster:'devnet',programDataSha256:program.sha256};
}
