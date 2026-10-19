import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {Keypair} from '@solana/web3.js';
import {createAdminRoutes} from '../server/routes/admin.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';

test('verified legacy review permits only zero-corrective preservation and records no transfer',async()=>{
  const admin=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58();
  const creator=Keypair.generate().publicKey.toBase58(),authority=Keypair.generate().publicKey.toBase58();
  const programId=Keypair.generate().publicKey.toBase58(),hash='a'.repeat(64);
  const state={launches:{[mint]:{mint,cluster:'devnet',onchainVerified:true,creatorWallet:creator,
    pumpFeeRoute:{programId,initialAuthority:authority,protocolSplit:{}}}},collections:{},v3Settlements:{}};
  const store={read:async()=>structuredClone(state),update:async fn=>fn(state)};
  const original={walletLamports:'10396043',holderLamports:'742574',xLamports:'742575'};
  let plan={mint,programId,hash,status:'reviewed-legacy-preservation-no-transfer',sources:[{
    collectionSignature:Keypair.generate().publicKey.toBase58(),originalCreatorDirected:original,
    verifiedTransfers:[{kind:'creator-reward',amount:'1485149'}],unreleasedLamports:['0','0','0']}]};
  let genesis=DEVNET_GENESIS_HASH,ready={ready:true,programId,protectedPolicy:false};
  let reviews=0,approvals=0,output=null,input=null,cookie='';
  const handle=createAdminRoutes({store,body:async()=>input,respond:(_res,status,value)=>{output={status,value};},
    solanaCluster:'devnet',solanaRpcUrl:'https://devnet.invalid',
    env:{PUBLIC_APP_URL:'https://funded.vip',FUNDED_ADMIN_WALLETS:admin.publicKey.toBase58(),
      FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,FUNDED_V3_PROGRAM_DATA_SHA256:'b'.repeat(64)},
    connectionFactory:()=>({getGenesisHash:async()=>genesis}),
    verifyResidualReadiness:async()=>ready,
    reviewResiduals:async()=>{reviews++;return structuredClone(plan);},
    recordResidualPlan:async options=>{approvals++;assert.equal(options.actor,admin.publicKey.toBase58());
      assert.equal(options.expectedHash,hash);return{plan:structuredClone(plan),actor:options.actor,executionStatus:'not-executed'};}});
  const call=async(method,path,value,origin='https://funded.vip')=>{
    input=value;output=null;
    const req={method,headers:{origin,cookie},socket:{remoteAddress:'127.0.0.1'}};
    const res={setHeader(name,value){if(name==='set-cookie')cookie=value.split(';')[0];}};
    await handle(req,res,new URL(path,'https://funded.vip'));
    return output;
  };
  const reviewPath='/api/admin/v3-allocations/review',approvePath='/api/admin/v3-allocations/approve';
  assert.equal((await call('POST',reviewPath,{mint})).status,401);
  assert.equal((await call('POST',reviewPath,{mint},'https://evil.example')).status,403);
  assert.equal(reviews,0);
  const challenge=await call('POST','/api/admin/challenge',{wallet:admin.publicKey.toBase58()});
  const signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.value.message),admin.secretKey));
  assert.equal((await call('POST','/api/admin/session',{
    wallet:admin.publicKey.toBase58(),nonce:challenge.value.nonce,signature})).status,200);
  genesis='wrong-network';assert.equal((await call('POST',reviewPath,{mint})).status,409);assert.equal(reviews,0);
  genesis=DEVNET_GENESIS_HASH;ready={ready:false,programId,protectedPolicy:false};
  assert.equal((await call('POST',reviewPath,{mint})).status,409);assert.equal(reviews,0);
  ready={ready:true,programId,protectedPolicy:false};
  const review=await call('POST',reviewPath,{mint});
  assert.equal(review.status,200);assert.equal(review.value.status,'reviewed-legacy-preservation-no-transfer');
  assert.deepEqual(review.value.sources[0].unreleasedLamports,['0','0','0']);
  assert.equal(review.value.sources[0].originalCreatorDirected.walletLamports,'10396043');
  assert.equal(review.value.sources[0].verifiedTransfers.some(row=>row.kind==='creator-wallet'),false);
  plan.sources[0].unreleasedLamports=['1','0','0'];
  assert.equal((await call('POST',approvePath,{mint,expectedHash:hash,reason:'Reviewed legacy source proof.'})).status,409);
  assert.equal(approvals,0);
  plan.sources[0].unreleasedLamports=['0','0','0'];plan.status='reviewed-residual-not-paid';
  assert.equal((await call('POST',reviewPath,{mint})).status,409);
  plan.status='reviewed-legacy-preservation-no-transfer';
  const approval=await call('POST',approvePath,{mint,expectedHash:hash,reason:'Reviewed legacy source proof.'});
  assert.equal(approval.status,200);assert.equal(approval.value.executionStatus,'not-executed');
  assert.equal(approvals,1);
  ready={ready:true,programId,protectedPolicy:true};
  assert.equal((await call('POST',reviewPath,{mint})).status,409);
  plan.status='reviewed-residual-not-paid';
  assert.equal((await call('POST',reviewPath,{mint})).status,200);
  assert.equal(state.v3CreatorWalletPayout,undefined);
  assert.equal(state.v3CreatorRewardFunding,undefined);
});
