import bs58 from 'bs58';
export function receiptHistoryFixture(count=29) {
  const mint='5'.repeat(44),router='2'.repeat(44),recipient='4'.repeat(44),payer='6'.repeat(44),id='123';
  const state={creatorProfiles:{[id]:{id,handle:'@fixture',name:'Synthetic receipt QA',listed:true,identityVerified:true}},
    launches:{[mint]:{mint,name:'Synthetic receipt coin',symbol:'TEST',cluster:'devnet',onchainVerified:true,policySignature:'fixture-only',xUserId:id,creator:router,creatorWallet:recipient,
      pumpFeeRoute:{verified:true,scope:'per-mint-v2',router},feeDistribution:{creatorDirected:{shares:{solClaimPercent:80},recipients:{xAccount:'@fixture'}}}}},
    obligations:{},claims:{},collections:{},payouts:{}};
  const transactions=new Map();
  for(let n=0;n<count;n++) {
    const key=`history-${String(n).padStart(3,'0')}`,collection=bs58.encode(Buffer.alloc(64,n*2+1)),payout=bs58.encode(Buffer.alloc(64,n*2+2));
    state.obligations[key]={id:key,xUserId:id,mint,claimSignature:collection,source:'verified-per-mint-router-collection',amountLamports:'800000'};
    state.claims[key]={id:key,xUserId:id,obligationId:key,publicKey:recipient,status:'paid',payoutSignature:payout};
    state.collections[collection]={cluster:'devnet',signature:collection,status:'collected',attribution:'mint-verified',onchainVerified:true,mint,router,collectedLamports:1000000};
    state.payouts[key]={cluster:'devnet',signature:payout,status:'paid',source:'mint-router-settle-mint',from:router,to:recipient,mint,claimId:key,obligationId:key,amountLamports:800000};
    transactions.set(collection,{slot:100+n*2,transaction:{signatures:[collection],message:{accountKeys:[payer,router]}},meta:{err:null,preBalances:[2000000,0],postBalances:[1000000,1000000]}});
    transactions.set(payout,{slot:101+n*2,transaction:{signatures:[payout],message:{accountKeys:[router,recipient]}},meta:{err:null,preBalances:[1000000,0],postBalances:[200000,800000]}});
  }
  return {state,transactions,id,mint};
}
