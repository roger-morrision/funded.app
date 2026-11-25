import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {Keypair,Transaction} from '@solana/web3.js';
import {loadV3SettlementPosition} from '../../server/v3-settlement-position.mjs';
import {buildV3PolicySettlement} from '../../server/v3-policy-builders.mjs';
import {deriveAgencyPolicyV3} from '../../agency-mint-router-v3.js';
import {protocolGrossUnits} from '../../mint-router-v3.js';
const key=()=>Keypair.generate().publicKey,code=name=>createHash('sha256').update('global:'+name).digest().subarray(0,8);
function fixture(name){
 const programId=key(),mint=key(),authority=key(),creator=key(),split={operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10};
 const policy=deriveAgencyPolicyV3(programId,mint).address,signature='2'.repeat(88),laterSignature='3'.repeat(88),buySignature='4'.repeat(88);
 const ix=buildV3PolicySettlement({programId,mint,authority,creator,split,auto:true,claimId:Buffer.alloc(32,1),expectedLamports:10000000n}).instruction;
 const tx=new Transaction({feePayer:authority,recentBlockhash:key().toBase58()}).add(ix),message=tx.compileMessage();
 const connection={getAccountInfoAndContext:async()=>({context:{slot:30},value:{}}),getBlockSignatures:async()=>({signatures:[signature]}),
  getSignaturesForAddress:async()=>[{signature:buySignature,slot:25,confirmationStatus:'finalized',err:null},{signature:laterSignature,slot:20,confirmationStatus:'finalized',err:null},{signature,slot:10,confirmationStatus:'finalized',err:null}],
  getTransaction:async sig=>sig===laterSignature?{slot:20,meta:{err:null},transaction:{signatures:[sig],message}}:
   {slot:25,meta:{err:null},transaction:{signatures:[sig],message:{accountKeys:[programId,policy],isAccountWritable:()=>true,instructions:[{programIdIndex:0,accounts:[1],data:code(name)}]}}}};
 return{connection,signature,slot:10,programId,mint,authority,creator,split,expectedLamports:10000000n,categoryLamports:[8000000,...protocolGrossUnits(split)],verifyPolicy:async()=>({verified:true,settledLamports:20000000n})};
}
test('cumulative settlement reconstruction survives both configurable buyback variants',async()=>{
 for(const name of ['buyback_configured_mint_v3','buyback_configured_agency_mint_v3']){
  const proof=await loadV3SettlementPosition(fixture(name));assert.equal(proof.settledBeforeLamports,'0');assert.equal(proof.settledAfterLamports,'10000000');assert.equal(proof.policySettledLamports,'20000000');
 }
});
test('unknown writable policy instructions still block cumulative settlement payouts',async()=>{
 await assert.rejects(loadV3SettlementPosition(fixture('unknown_policy_mutation')),/Unknown V3 policy mutation/);
});
