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
  response.data.image='https://metadata.funded.vip/default.svg';
  response.data.publication={verified:true,uri:response.data.uri,image:response.data.image,storage:'hosted-devnet',checkedAt:new Date().toISOString()};
  const app={captureWalletSession:()=>session,assertWalletSessionCurrent:current=>assert.equal(current,session),
    getLaunchBurnPolicy:()=>({requiresBurn:false}),getLaunchMetadataPreview:()=>({description:'UI regression fixture'}),
    assertImageReady:()=>{},getPreparedImage:()=>null,canonicalLaunchSocialUrl:()=>'',metadataStatement,devnetMetadataUri,bs58,
    apiRequest:async(path,{body})=>{assert.equal(path,'/api/devnet-metadata');assert.equal(parseSignedMetadata(body).record.mint,mint);return response;}};
  return{app,response,mint,run:()=>createLaunchReviewController(app).prepareLaunchMetadata({mint,name:'QA metadata',symbol:'QAURL'})};
}

test('browser launch accepts the compact metadata URI after the actual signed upload payload validates',async()=>{
  const f=fixture();assert.deepEqual(await f.run(),{uri:f.response.data.uri,symbolReservationExpiresAt:f.response.data.symbolReservationExpiresAt});
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

test('browser requires fresh public metadata and image verification before returning a launch URI',async()=>{
 for(const mutate of [data=>delete data.publication,data=>data.publication.verified=false,data=>data.publication.image='wrong',data=>data.publication.checkedAt=new Date(0).toISOString()]){
  const f=fixture();mutate(f.response.data);await assert.rejects(f.run(),/could not be verified/);
 }
});

test('browser accepts a verified pinned URI and preserves it for launch preparation',async()=>{
 const f=fixture();const uri='https://gateway.pinata.cloud/ipfs/bafy'+'a'.repeat(55);
 f.response.data.uri=uri;f.response.data.image=uri;Object.assign(f.response.data.publication,{uri,image:uri,storage:'pinata'});
 assert.equal((await f.run()).uri,uri);
});
