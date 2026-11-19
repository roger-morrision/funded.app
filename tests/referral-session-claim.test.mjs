import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {createV3RewardFundingRoutes} from '../server/routes/v3-reward-funding.mjs';
import {v3AllocationPlan} from '../server/v3-allocation-plan.mjs';

function harness({authenticated=true,wrongWallet=false,expired=false,cluster='devnet',origin=true,level=1,creatorClaim=false,protectedPolicy=true}={}){
 const authority=Keypair.generate(),creator=Keypair.generate(),recipients=[Keypair.generate(),Keypair.generate(),Keypair.generate()];
 const mint=Keypair.generate().publicKey.toBase58(),programId=Keypair.generate().publicKey.toBase58(),router=Keypair.generate().publicKey.toBase58();
 const source=bs58.encode(Buffer.alloc(64,1)),settlementSignature=bs58.encode(Buffer.alloc(64,2)),claimId='a'.repeat(64);
 const launch={mint,cluster:'devnet',onchainVerified:true,creatorWallet:creator.publicKey.toBase58(),pumpFeeRoute:{scope:'per-mint-v3',programId,initialAuthority:authority.publicKey.toBase58()},feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:40,holderAirdropPercent:40,solClaimPercent:0}}}};
 const proof={mint,claimId,signature:settlementSignature,programId,expectedLamports:'1000000',categoryLamports:['800000','80000','30000','20000','10000','40000','20000'],position:{creatorPoolBeforeLamports:'0',creatorPoolAfterLamports:'800000',settledBeforeLamports:'0',settledAfterLamports:'1000000',policySettledLamports:'1000000'}};
 const allocationPlan=v3AllocationPlan({launch,settlement:{...proof,collectionSignature:source,settlementSignature}});
 const state={launches:{[mint]:launch},collections:{[source]:{mint,signature:source,scope:'per-mint-v3',cluster:'devnet',status:'collected',onchainVerified:true,attribution:'mint-verified',programId,claimId,router,collectedLamports:1000000}},v3Settlements:{[source]:{mint,status:'finalized',collectionSignature:source,settlementSignature,allocationPlan,referralUpline:recipients.map(x=>x.publicKey.toBase58())}}};
 const expectedWallet=creatorClaim?creator:recipients[level-1],otherWallet=creatorClaim?recipients[0]:creator;
 const session=authenticated?{wallet:(wrongWallet?otherWallet:expectedWallet).publicKey.toBase58(),expiresAt:Date.now()+(expired?-1000:60000)}:null;
 let submissions=0,reads=0,lastInput=null,serializedUpdate=Promise.resolve();
 const store={read:async()=>structuredClone(state),update:fn=>{const task=serializedUpdate.then(()=>fn(state));serializedUpdate=task.catch(()=>{});return task;}};
 const handler=createV3RewardFundingRoutes({body:async req=>req.input||{},store,solanaCluster:cluster,solanaRpcUrl:'unused',v3AuthorityKeypair:()=>authority,
  referralSession:async()=>session,requireAuthorized:()=>true,originAllowed:()=>origin,
  env:{FUNDED_V3_CREATOR_WALLET_PAYOUT_ENABLED:'true',FUNDED_V3_REFERRAL_PAYOUT_ENABLED:'true',FUNDED_V3_AUTO_DISBURSEMENT_ENABLED:'true',FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64)},
  respond:(res,status,data)=>Object.assign(res,{status,data}),connectionFactory:()=>{reads++;return{getBalance:async()=>1000000,getMinimumBalanceForRentExemption:async()=>890880,getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100})};},
  verifyReadiness:async()=>({ready:true,configuredRouter:router,protectedPolicy}),rewardChainFactory:()=>({readiness:async()=>({constrainedPayouts:true})}),loadSettlement:async()=>proof,ensureAutomation:async()=>{},
  submitTransaction:async({transaction})=>{submissions++;return bs58.encode(transaction.signature);},loadFunding:async input=>{lastInput=input;return{cluster:'devnet',mint,signature:input.signature,recipient:String(input.recipient),amount:String(input.amount),category:input.category,balanceDeltaVerified:true};}});
 const path=creatorClaim?`/api/tokens/${mint}/v3-creator-wallet-payout/${source}`:`/api/tokens/${mint}/v3-referral-payout/${source}/${level}`;
 return {state,session,authority,recipients,source,programId,allocationPlan,get submissions(){return submissions;},get reads(){return reads;},get lastInput(){return lastInput;},async request(input={},customPath=path){const res={};await handler({method:'POST',headers:{origin:'https://funded.vip'},input},res,new URL(customPath,'https://funded.vip'));return res;}};
}

for(const options of [{authenticated:false},{expired:true},{wrongWallet:true},{cluster:'mainnet-beta'},{origin:false}])test(`referral claim refuses ${JSON.stringify(options)}`,async()=>{const h=harness(options),r=await h.request({recipientSignature:'old-signature',useWalletSession:true});assert([401,403].includes(r.status),JSON.stringify(r));assert.equal(h.submissions,0);if(!options.wrongWallet)assert.equal(h.reads,0);});
for(const level of [1,2,3])test(`level ${level}: a signed-in recipient claims without a new signature or OTP; replay is idempotent`,async()=>{
 const h=harness({level}),r=await h.request({amount:'999999999',recipient:Keypair.generate().publicKey.toBase58()});
 assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.status,'finalized');assert.equal(r.data.recipient,h.session.wallet);assert.equal(r.data.amount,h.allocationPlan.protocol.referralLamports[level-1]);assert.equal(r.data.balanceDeltaVerified,true);assert.equal(h.submissions,1);
 const replay=await h.request();assert.equal(replay.status,200);assert.equal(replay.data.signature,r.data.signature);assert.equal(h.submissions,1);
});
test('concurrent claim clicks submit at most one payout',async()=>{const h=harness(),results=await Promise.all([h.request(),h.request()]);assert.equal(h.submissions,1);assert(results.some(r=>r.status===200));assert(results.every(r=>[200,409].includes(r.status)));});
test('keeper automation cannot trigger recipient claims',async()=>{const h=harness(),r=await h.request({mint:'unused',action:'referral-payout',level:1},'/api/keeper/disburse-v3');assert.equal(r.status,409);assert.equal(h.submissions,0);});

for(const options of [{authenticated:false},{expired:true},{wrongWallet:true},{cluster:'mainnet-beta'},{origin:false},{protectedPolicy:false}])test(`creator claim refuses ${JSON.stringify(options)}`,async()=>{const h=harness({...options,creatorClaim:true}),r=await h.request({creatorSignedTransaction:'old-signature'});assert([401,403,409].includes(r.status),JSON.stringify(r));assert.equal(h.submissions,0);});
test('creator claim uses the authenticated creator, exact allocation and app signature; replay pays once',async()=>{const h=harness({creatorClaim:true});const r=await h.request({amount:'9999999',recipient:h.recipients[0].publicKey.toBase58()});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.status,'finalized');assert.equal(r.data.recipient,h.session.wallet);assert.equal(r.data.amount,'400000');assert.equal(h.lastInput.beneficiary,0);assert.equal(h.lastInput.category,0);assert.equal(h.submissions,1);const replay=await h.request();assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.data.signature,r.data.signature);assert.equal(h.submissions,1);});
test('concurrent creator claims submit one payout',async()=>{const h=harness({creatorClaim:true}),rs=await Promise.all([h.request(),h.request()]);assert.equal(h.submissions,1);assert(rs.some(r=>r.status===200));assert(rs.every(r=>[200,409].includes(r.status)));});
test('keeper cannot initiate creator wallet claims',async()=>{const h=harness({creatorClaim:true}),r=await h.request({mint:'unused',action:'creator-wallet-payout'},'/api/keeper/disburse-v3');assert.equal(r.status,409);assert.equal(h.submissions,0);});
test('creator claim cannot use a residual hash to bypass session/OTP requirements',async()=>{const h=harness({creatorClaim:true,authenticated:false}),r=await h.request({residualPlanHash:'a'.repeat(64),adminEmailAuthorized:true});assert.equal(r.status,403);assert.equal(h.submissions,0);assert.equal(h.reads,0);});
