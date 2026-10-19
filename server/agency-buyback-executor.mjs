import {createHash} from 'node:crypto';
import {PublicKey,TransactionInstruction,VersionedTransaction} from '@solana/web3.js';
import {deriveAgencyVaultsV3} from '../agency-mint-router-v3.js';
import {readAgencyMintContext} from './agency-mint-context.mjs';
import {readAgencyMarketObservation} from './agency-market-observation.mjs';
import {quoteAgencyBuyback} from './agency-buyback-quote.mjs';
import {executeAgencyJournal} from './agency-execution-journal.mjs';
import {buildV3BuybackInstruction} from './v3-buyback-instruction.mjs';
import {prepareV3BuybackTransaction} from './v3-buyback-transaction.mjs';
import {loadFinalizedV3Buyback} from './v3-buyback-proof.mjs';

// Fixed action key plus contract completion bitmap enforce one purchase per
// milestone, including when future fees replenish this agent's sub-budget.
export async function runAgencyMilestone({store,connection,mint,agent,programId,approvedHash,authority,lookupAddress,
  readContext=readAgencyMintContext,readObservation=readAgencyMarketObservation,quote=quoteAgencyBuyback,
  journal=executeAgencyJournal,loadProof=loadFinalizedV3Buyback,now=()=>Date.now()}){
  if(![1,2].includes(agent))throw new Error('An own-coin milestone agent is required.');
  const state=await store.read(),context=await readContext({connection,state,mint,programId,approvedHash,authority:authority.publicKey});
  const key=`agency:${mint}:${agent}:0`,saved=state.v3AgencyExecutions?.[key];
  if(!saved&&(!(context.policy.selectedMask&(1<<agent))||context.policy.completedMask&(1<<agent)))return{status:'not-payable',mint,agent};
  const intent=saved?.intent||{cluster:'devnet',mint,programId:String(programId),approvedHash,agent,
    maxBudgetLamports:context.agentRemaining[agent],creator:context.launch.creatorWallet,initialAuthority:context.launch.pumpFeeRoute.initialAuthority};
  if(intent.mint!==mint||intent.agent!==agent||intent.programId!==String(programId)||intent.approvedHash!==approvedHash
    ||intent.creator!==context.launch.creatorWallet||intent.initialAuthority!==context.launch.pumpFeeRoute.initialAuthority)
    throw new Error('The milestone journal belongs to a different immutable mint policy.');
  if(!saved&&BigInt(intent.maxBudgetLamports)<10000n)return{status:'awaiting-funding',mint,agent};
  // No financial intent is created below the threshold. Later observations may
  // qualify; an already signed intent is always reconciled without requoting.
  let observation=null;
  if(!saved?.signature){
    observation=await readObservation({connection,mint});
    if(BigInt(observation.marketCapUsdMicros)<BigInt(agent===1?100000:300000)*1000000n)return{status:'below-threshold',mint,agent};
  }
  const buybackId=createHash('sha256').update(`funded.agency.own-coin.v1:${mint}:${agent}`).digest();
  return journal({store,connection,key,intent,authority,prepare:async()=>{
    const fresh=await readContext({connection,state:await store.read(),mint,programId,approvedHash,authority:authority.publicKey});
    if(!(fresh.policy.selectedMask&(1<<agent))||fresh.policy.completedMask&(1<<agent)
      ||BigInt(fresh.agentRemaining[agent])<BigInt(intent.maxBudgetLamports))throw new Error('The protected milestone budget or completion state changed.');
    observation=await readObservation({connection,mint});
    if(!observation.verified||observation.slot<fresh.slot||now()-observation.observedAt*1000>60000
      ||now()<observation.observedAt*1000)throw new Error('A current finalized own-coin observation is required.');
    const vault=deriveAgencyVaultsV3(programId,mint)[7],quoted=await quote({observation,vault,budgetLamports:intent.maxBudgetLamports});
    const agencyExecution={agent,pool:observation.pool,observationSlot:String(observation.slot),observedAt:observation.observedAt,
      marketCapUsdMicros:observation.marketCapUsdMicros,observationHash:Buffer.from(observation.observationHash,'hex')};
    const built=buildV3BuybackInstruction({programId,sourceMint:mint,creator:intent.creator,authority:authority.publicKey,
      buybackId,agencyPolicy:true,agencyExecution,...quoted});
    const lookup=await connection.getAddressLookupTable(new PublicKey(lookupAddress),{commitment:'finalized'});
    if(!lookup.value?.key.equals(new PublicKey(lookupAddress))||lookup.value.state.deactivationSlot!==0xffffffffffffffffn)
      throw new Error('An active agency buyback lookup table is required.');
    const latest=await connection.getLatestBlockhash('finalized');
    const prepared=prepareV3BuybackTransaction({instruction:built.instruction,authority:authority.publicKey,blockhash:latest.blockhash,lookupTable:lookup.value});
    // Conservative maximum for two ATAs, volume PDA and receipt, including
    // temporary refundable rent. Preserve reserve before, during and after CPI.
    const rents=await Promise.all([connection.getMinimumBalanceForRentExemption(10240,'finalized'),
      connection.getMinimumBalanceForRentExemption(209,'finalized'),connection.getMinimumBalanceForRentExemption(256,'finalized')]);
    return{transaction:VersionedTransaction.deserialize(Buffer.from(prepared,'base64')),lastValidBlockHeight:latest.lastValidBlockHeight,
      estimatedRentLamports:String(BigInt(rents[0])*2n+BigInt(rents[1])+BigInt(rents[2])),evidence:{
        agencyExecution:{...agencyExecution,observationHash:agencyExecution.observationHash.toString('hex')},
        observation:{mint,slot:observation.slot,marketCapUsdMicros:observation.marketCapUsdMicros,observedAt:observation.observedAt,
          source:observation.source,accountHashes:observation.accountHashes,solUsd:observation.solUsd,solUsdFetchedAt:observation.solUsdFetchedAt},
        baseTokenProgram:quoted.baseTokenProgram.toBase58(),spendableQuoteIn:quoted.spendableQuoteIn,minBaseAmountOut:quoted.minBaseAmountOut,maxTotalDebit:quoted.maxTotalDebit,
        pump:{programId:quoted.pumpBuyInstruction.programId.toBase58(),data:Buffer.from(quoted.pumpBuyInstruction.data).toString('base64'),
          keys:quoted.pumpBuyInstruction.keys.map(row=>({...row,pubkey:row.pubkey.toBase58()}))}}};
  },prove:async row=>{
    const saved=row.evidence;if(!saved?.agencyExecution||!saved.pump)return null;
    const execution={...saved.agencyExecution,observationHash:Buffer.from(saved.agencyExecution.observationHash,'hex')};
    return loadProof({connection,signature:row.signature,programId,sourceMint:mint,creator:intent.creator,initialAuthority:intent.initialAuthority,
      authority:authority.publicKey,buybackId,agencyPolicy:true,agencyExecution:execution,split:context.launch.pumpFeeRoute.protocolSplit,
      baseTokenProgram:saved.baseTokenProgram,spendableQuoteIn:saved.spendableQuoteIn,minBaseAmountOut:saved.minBaseAmountOut,maxTotalDebit:saved.maxTotalDebit,
      pumpBuyInstruction:new TransactionInstruction({programId:new PublicKey(saved.pump.programId),data:Buffer.from(saved.pump.data,'base64'),
        keys:saved.pump.keys.map(value=>({...value,pubkey:new PublicKey(value.pubkey)}))})});
  }});
}
