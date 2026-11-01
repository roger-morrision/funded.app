import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createAirdropsRoutes} from '../server/routes/airdrops.mjs';
const mint=String(Keypair.generate().publicKey),signature='1'.repeat(88);
test('only a verified migration preparation receives the bounded long replay response timeout',async()=>{
 for(const verified of [false,true]){
  let timeout=null,response,prepared=0;
  const {handle}=createAirdropsRoutes({solanaCluster:'devnet',body:async()=>({mint,migrationSignature:signature}),
   store:{readLaunch:async()=>verified?{onchainVerified:true,cluster:'devnet',creatorWallet:mint,communityAirdrop:{reservedTokens:3}}:null,
    read:async()=>({communityReserveReceipts:{[mint]:{signature}}})},
   communityClaimService:async()=>({prepare:async()=>{prepared++;assert.equal(timeout,900000);return{mint,manifest:{drop:mint,root:'00'.repeat(32),snapshotHash:'00'.repeat(32),leaves:[],totalAmount:'3'},snapshot:{slot:1},snapshotBasis:'pump-migration'};}}),
   respond:(_res,status,data)=>{response={status,data};}});
  await handle({method:'POST'},{setTimeout:ms=>{timeout=ms;}},new URL('https://funded.vip/api/airdrops/claims/prepare'));
  assert.equal(response.status,verified?200:404);assert.equal(timeout,verified?900000:null);assert.equal(prepared,verified?1:0);
 }
});
