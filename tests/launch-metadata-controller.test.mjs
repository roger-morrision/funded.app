import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createLaunchReviewController} from '../src/app/controllers/launch-review.js';
import {metadataStatement,devnetMetadataUri,devnetLaunchMetadataUri} from '../devnet-metadata.js';
import {parseSignedMetadata} from '../server/devnet-metadata.mjs';

function fixture() {
  const wallet=Keypair.generate(),mint=String(Keypair.generate().publicKey);
  const session={address:String(wallet.publicKey),provider:{signMessage:async bytes=>({signature:nacl.sign.detached(bytes,wallet.secretKey)})}};
  const response={available:true,data:{uri:devnetLaunchMetadataUri(mint),symbolReservationExpiresAt:new Date(Date.now()+60_000).toISOString()}};
  const app={captureWalletSession:()=>session,assertWalletSessionCurrent:current=>assert.equal(current,session),
    getLaunchBurnPolicy:()=>({requiresBurn:false}),getLaunchMetadataPreview:()=>({description:'UI regression fixture'}),
    assertImageReady:()=>{},getPreparedImage:()=>null,canonicalLaunchSocialUrl:()=>'',metadataStatement,devnetMetadataUri,bs58,
    apiRequest:async(path,{body})=>{assert.equal(path,'/api/devnet-metadata');assert.equal(parseSignedMetadata(body).record.mint,mint);return response;}};
  return{app,response,mint,run:()=>createLaunchReviewController(app).prepareLaunchMetadata({mint,name:'QA metadata',symbol:'QAURL'})};
}

test('browser launch accepts the compact metadata URI after the actual signed upload payload validates',async()=>{
  const f=fixture();assert.deepEqual(await f.run(),f.response.data);
});

test('browser launch rejects foreign, wrong-mint and legacy upload URLs before transaction preparation',async()=>{
  for(const uri of [mint=>'https://foreign.example/m/'+mint,()=>devnetLaunchMetadataUri(String(Keypair.generate().publicKey)),devnetMetadataUri]){
    const f=fixture();f.response.data.uri=uri(f.mint);await assert.rejects(f.run(),/metadata could not be published/);
  }
});

test('browser metadata upload requires an available response and a valid ticker reservation',async()=>{
  const unavailable=fixture();unavailable.response.available=false;await assert.rejects(unavailable.run(),/metadata could not be published/);
  const expired=fixture();expired.response.data.symbolReservationExpiresAt='invalid';await assert.rejects(expired.run(),/Ticker reservation/);
});
