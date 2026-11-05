import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMetadataPublisher,verifyPublishedMetadata} from '../server/metadata-publication.mjs';
import {publicMetadata} from '../server/devnet-metadata.mjs';
import {assertMetadataPublication,isPinnedMetadataUri,pinnedMetadataUri,onchainMetadataUri} from '../metadata-publication.js';
const image=Buffer.from('image fixture'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const record={mint:'11111111111111111111111111111111',name:'Public logo',symbol:'LOGO',imageSha256:hash(image),metadataOrigin:'https://metadata.funded.vip'};
test('canonical on-chain metadata keeps the exact verified CID and leaves other URLs unchanged',()=>{
 const cid='bafy'+'a'.repeat(55);
 assert.equal(onchainMetadataUri(pinnedMetadataUri(cid)),`ipfs://${cid}`);
 for(const uri of ['https://funded.vip/m/example','https://gateway.pinata.cloud/ipfs/'+cid+'?redirect=1','https://gateway.pinata.cloud.evil.example/ipfs/'+cid,`ipfs://${cid}`])assert.equal(onchainMetadataUri(uri),uri);
});
const fixture=()=>{
 const uploads=[],objects=new Map();
 const fetchImpl=async(url,options)=>{
  if(options.method==='POST'){
   assert.equal(url,'https://uploads.pinata.cloud/v3/files');assert.equal(options.body.get('network'),'public');assert.equal(options.headers.Authorization,'Bearer test-server-only');
   const file=options.body.get('file'),bytes=Buffer.from(await file.arrayBuffer()),uri=pinnedMetadataUri('bafy'+String.fromCharCode(97+uploads.length).repeat(55));
   uploads.push({bytes,type:file.type,uri});objects.set(uri,{bytes,type:file.type});return Response.json({data:{cid:uri.split('/').at(-1)}});
  }
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert(!options.headers?.Authorization);
  const item=objects.get(url);return item?new Response(item.bytes,{headers:{'content-type':item.type}}):new Response('missing',{status:404});
 };
 return {uploads,objects,fetchImpl,publish:createMetadataPublisher({env:{METADATA_STORAGE:'pinata',PINATA_JWT:'test-server-only'},fetchImpl})};
};
test('Pinata pins the image and JSON, then checks unauthenticated public bytes',async()=>{
 const f=fixture(),pinned=await f.publish({record,image,imageType:'image/png'});
 assert.equal(f.uploads.length,2);assert.equal(publicMetadata(pinned).image,f.uploads[0].uri);
 const json=JSON.parse(f.uploads[1].bytes);assert.equal(json.image,f.uploads[0].uri);assert.equal(json.name,record.name);
 const publication=await verifyPublishedMetadata(pinned,{fetchImpl:f.fetchImpl});assert.equal(publication.storage,'pinata');
 assertMetadataPublication({publication,image:publication.image},publication.uri);
 assert(!JSON.stringify(pinned).includes('test-server-only'));
});
test('no-image launches pin a public fallback; optional banners are pinned and verified',async()=>{
 const f=fixture(),banner=Buffer.from('banner'),pinned=await f.publish({record:{...record,imageSha256:'',bannerSha256:hash(banner)},banner,bannerType:'image/png'});
 assert.equal(f.uploads.length,3);assert(pinned.pinnedMetadata.fallbackImageSha256);
 assert.equal(publicMetadata(pinned).banner,f.uploads[1].uri);
});
test('missing Pinata credentials fail closed without upload',async()=>{
 let requests=0;const publish=createMetadataPublisher({env:{METADATA_STORAGE:'pinata'},fetchImpl:async()=>{requests++;}});
 await assert.rejects(publish({record,image,imageType:'image/png'}),/not configured/);assert.equal(requests,0);
});
test('upload failures never fall back to hosted assets or expose provider bodies',async()=>{
 const publish=createMetadataPublisher({env:{METADATA_STORAGE:'pinata',PINATA_JWT:'private-key'},fetchImpl:async()=>new Response('<html>private-key</html>',{status:503})});
 await assert.rejects(publish({record,image,imageType:'image/png'}),error=>/Durable metadata/.test(error.message)&&!error.message.includes('private-key'));
});
for(const fault of ['wrong-image','wrong-json','wrong-mime','unavailable','oversize','banner'])test(`public verification rejects ${fault}`,async()=>{
 const f=fixture(),banner=Buffer.from('banner'),pinned=await f.publish({record:{...record,bannerSha256:hash(banner)},image,imageType:'image/png',banner,bannerType:'image/png'});
 const uri=pinned.pinnedMetadata[fault==='wrong-json'?'uri':fault==='banner'?'banner':'image'];
 if(fault==='unavailable')f.objects.delete(uri);
 else if(fault==='wrong-mime')f.objects.get(uri).type='text/html';
 else f.objects.get(uri).bytes=Buffer.from(fault==='wrong-json'?'{}':fault==='oversize'?'x'.repeat(600001):'changed');
 await assert.rejects(verifyPublishedMetadata(pinned,{fetchImpl:f.fetchImpl}),/could not be verified/);
});
test('hosted Devnet URLs also require matching public JSON and image bytes',async()=>{
 const metadata=publicMetadata(record);
 const fetchImpl=async url=>url.includes('/m/')?Response.json(metadata):new Response(image,{headers:{'content-type':'image/png'}});
 const result=await verifyPublishedMetadata(record,{fetchImpl});assert.equal(result.storage,'hosted-devnet');
 assertMetadataPublication({publication:result,image:result.image},result.uri);
});
test('browser rejects stale verification and unapproved gateways',()=>{
 for(const uri of ['https://evil.example/ipfs/bafya','https://gateway.pinata.cloud@evil.example/ipfs/bafya','https://gateway.pinata.cloud/ipfs/../../private','ipfs://random'])assert.equal(isPinnedMetadataUri(uri),false);
 assert.throws(()=>assertMetadataPublication({publication:{verified:true,uri:'test',storage:'hosted-devnet',image:'x',checkedAt:new Date(0).toISOString()},image:'x'},'test'),/could not be verified/);
});
import {createDevnetMetadataRoutes} from '../server/routes/devnet-metadata.mjs';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {metadataStatement} from '../devnet-metadata.js';

test('signed upload retries reuse immutable pins and public failures do not return a launch URI',async()=>{
 const wallet=Keypair.generate(),mint=Keypair.generate().publicKey.toBase58();
 const entry={mint,creatorWallet:wallet.publicKey.toBase58(),name:'Public logo',symbol:'LOGO',description:'',tagline:'',roadmap:'',website:'',x:'',telegram:'',discord:'',imageSha256:''};
 const payload={...entry,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(entry)),wallet.secretKey))};
 const state={launches:{},launchSymbolReservations:{LOGO:{mint,creatorWallet:entry.creatorWallet,expiresAt:Date.now()+600000,holdUntil:Date.now()+600000}}};
 let stored=null,pins=0,fail=false,response;
 const store={read:async()=>state,update:async fn=>fn(state),readMetadata:async()=>stored,writeMetadata:async row=>stored||=row};
 const handle=createDevnetMetadataRoutes({store,solanaCluster:'devnet',devnetMetadataOrigin:'https://metadata.funded.vip',body:async()=>payload,
  publish:async({record})=>{pins++;return record;},verifyPublication:async row=>{if(fail)throw Error('private endpoint key');return{verified:true,uri:'https://funded.vip/m/'+row.mint,image:publicMetadata(row).image,storage:'hosted-devnet',checkedAt:new Date().toISOString()};},
  respond:(_res,status,data)=>{response={status,data};}});
 const run=()=>handle({method:'POST'},{},new URL('https://funded.vip/api/devnet-metadata'));
 await run();assert.equal(response.status,201);assert(response.data.publication.verified);
 await run();assert.equal(pins,1);
 fail=true;await run();assert.equal(response.status,503);assert(!response.data.uri);assert(!JSON.stringify(response).includes('private endpoint'));
});
