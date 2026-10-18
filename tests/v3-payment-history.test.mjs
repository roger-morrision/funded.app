import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentHistoryReader } from '../server/payment-history.mjs';
import { v3DisbursementId } from '../server/v3-disbursement-id.mjs';

const mint='5'.repeat(44), creator='6'.repeat(44), authority='7'.repeat(44);
const program='8'.repeat(44), initialAuthority='9'.repeat(44);
const collectionSignature='3'.repeat(64), settlementSignature='4'.repeat(64);
const paymentSignature='A'.repeat(64);

function fixture({ amount='60', operations=false, protectedPolicy=false, recipient=operations?'B'.repeat(44):creator } = {}) {
  const state={
    launches:{[mint]:{mint,creatorWallet:creator,cluster:'devnet',onchainVerified:true,
      pumpFeeRoute:{scope:'per-mint-v3',programId:program,initialAuthority,protocolSplit:{}}}},
    collections:{[collectionSignature]:{signature:collectionSignature,mint,cluster:'devnet',
      scope:'per-mint-v3',programId:program,status:'collected',onchainVerified:true}},
    v3Settlements:{[collectionSignature]:{collectionSignature,mint,status:'finalized',
      settlementSignature,allocationPlan:{status:'allocated-not-funded',
        creatorDirected:{walletLamports:'60'}}}},
    v3CreatorWalletPayout:{[collectionSignature]:{collectionSignature,mint,
      signature:paymentSignature,recipient,amount,programId:program,category:0,
      status:'finalized',balanceDeltaVerified:true,protectedPolicy}},
  };
  if(operations){state.v3OperationsPayout=state.v3CreatorWalletPayout;state.v3CreatorWalletPayout={};
    state.v3OperationsPayout[collectionSignature].category=1;
    state.v3Settlements[collectionSignature].allocationPlan.protocol={operationsLamports:'60'};}
  let proofCalls=0;
  const loadPayment=async args=>{
    proofCalls++;
    assert.deepEqual(args.withdrawalId,v3DisbursementId(operations?'operations':'creator-wallet',settlementSignature));
    assert.equal(args.authority,authority);assert.equal(args.amount,'60');assert.equal(args.protectedPolicy,protectedPolicy);
    assert.equal(args.beneficiary,operations?3:0);assert.equal(args.holderAmount,0n);
    return {signature:paymentSignature,mint,programId:program,category:operations?1:0,amount:'60',
      recipient:operations?recipient:creator,balanceDeltaVerified:true,slot:42,blockTime:1000,feePayer:authority,feeLamports:5000};
  };
  const read=createPaymentHistoryReader({v3Only:true,cluster:'devnet',
    readEvidence:async()=>({cluster:'devnet',commitment:'finalized',status:'no-records'}),
    rewardsStore:{read:async()=>({schedules:{}})},store:{read:async()=>state},
    officialGenesis:async()=> 'devnet-genesis',connectionFactory:()=>({
      getGenesisHash:async()=> 'devnet-genesis',
      getTransaction:async()=>({transaction:{message:{accountKeys:[authority]}}}),
    }),
    loadCreatorPayment:loadPayment,loadOperationsPayment:loadPayment,
  });
  return {read,proofCalls:()=>proofCalls};
}

test('finalized V3 creator payment enters history only after exact proof',async()=>{
  const f=fixture();
  const history=await f.read();
  assert.equal(f.proofCalls(),1);
  assert.equal(history.status,'onchain-indexed');
  assert.equal(history.checkedCreator,1);
  assert.equal(history.verifiedPayouts[0].source,'v3-creator-wallet');
  assert.equal(history.verifiedPayouts[0].actualReceivedLamports,60);
});

test('mismatched creator allocation stays partial and never calls proof loader',async()=>{
  const f=fixture({amount:'61'});
  const history=await f.read();
  assert.equal(f.proofCalls(),0);
  assert.equal(history.status,'partial');
  assert.equal(history.checkedCreator,1);
  assert.equal(history.unavailablePayouts,1);
  assert.deepEqual(history.verifiedPayouts,[]);
});

test('protected V3 creator receipts preserve their beneficiary enforcement during history verification',async()=>{
  const f=fixture({protectedPolicy:true}),history=await f.read();assert.equal(f.proofCalls(),1);
  assert.equal(history.verifiedPayouts[0].source,'v3-creator-wallet');assert.equal(history.unavailablePayouts,0);
});
test('operations history requires a matching protected allocation and exact operations proof',async()=>{
  const f=fixture({operations:true,protectedPolicy:true}),history=await f.read();assert.equal(f.proofCalls(),1);
  assert.equal(history.checkedOperations,1);assert.equal(history.checkedCreator,0);
  assert.equal(history.verifiedPayouts[0].source,'v3-operations');assert.equal(history.verifiedPayouts[0].actualReceivedLamports,60);
  for(const invalid of [{operations:true},{operations:true,protectedPolicy:true,amount:'61'}]){
    const bad=fixture(invalid),result=await bad.read();assert.equal(bad.proofCalls(),0);
    assert.equal(result.unavailablePayouts,1);assert.deepEqual(result.verifiedPayouts,[]);
  }
});
