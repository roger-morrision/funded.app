import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair,PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ExtensionType } from '@solana/spl-token';
import { TOKEN_METADATA_PROGRAM_ID } from '../server/token-metadata.mjs';
import { portfolioMetaplexMetadata,createPortfolioMetadataReader } from '../server/portfolio-token-metadata.mjs';
import { publicMetadataAddress,publicMetadataUrl } from '../server/public-metadata-json.mjs';
import { enrichHoldingsMetadata,holdingImageUrl } from '../src/features/portfolio/holdings-metadata.js';
import { portfolioTokenIdentity } from '../token-identity.js';

const mint=Keypair.generate().publicKey,other=Keypair.generate().publicKey;
const string=value=>{const bytes=Buffer.from(value),size=Buffer.alloc(4);size.writeUInt32LE(bytes.length);return Buffer.concat([size,bytes]);};
function metaplex(key=mint){return{owner:TOKEN_METADATA_PROGRAM_ID,data:Buffer.concat([Buffer.from([4]),Buffer.alloc(32),key.toBuffer(),string('Outside launch'),string('OUT'),string('ipfs://bafytest/meta.json')])};}
function mintAccount(owner=TOKEN_PROGRAM_ID){const data=Buffer.alloc(82);data[44]=6;data[45]=1;return{owner,data};}
test('Metaplex identity is bound to owner and mint and rejects malformed strings',()=>{
  assert.equal(portfolioMetaplexMetadata(metaplex(),mint).symbol,'OUT');
  assert.equal(portfolioMetaplexMetadata(metaplex(other),mint),null);
  assert.equal(portfolioMetaplexMetadata({...metaplex(),owner:TOKEN_PROGRAM_ID},mint),null);
  const truncated=metaplex();truncated.data=truncated.data.subarray(0,70);assert.equal(portfolioMetaplexMetadata(truncated,mint),null);
});
test('public metadata URLs cannot reach local, private, mapped or special addresses',()=>{
  for(const ip of ['127.0.0.1','10.0.0.4','169.254.169.254','192.168.1.4','172.16.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','2002:7f00::1','2001:db8::1'])assert.equal(publicMetadataAddress(ip),false,ip);
  assert.equal(publicMetadataAddress('1.1.1.1'),true);assert.equal(publicMetadataAddress('2606:4700:4700::1111'),true);
  for(const url of ['http://site.com/a','https://127.1/a','https://localhost/a','https://x.internal/a','https://user:pass@site.com/a','https://site.com:123/a','file:///x','javascript:alert(1)'])assert.equal(publicMetadataUrl(url),null,url);
  assert.equal(publicMetadataUrl('ipfs://ipfs/bafytest/logo.png'),'https://ipfs.io/ipfs/bafytest/logo.png');
  assert.equal(publicMetadataUrl('ar://id'),'https://arweave.net/id');
  assert.equal(holdingImageUrl('javascript:alert(1)'),null);
});
test('external SPL holdings get on-chain names and artwork, cached independently of wallet',async()=>{
  let reads=0,jsonReads=0;
  const read=createPortfolioMetadataReader({cluster:'devnet',connection:{getMultipleAccountsInfo:async(keys,commitment)=>{reads++;assert.equal(commitment,'finalized');assert.equal(keys[0].toBase58(),mint.toBase58());return[mintAccount(),metaplex()];}},readJson:async uri=>{jsonReads++;assert.equal(uri,'https://ipfs.io/ipfs/bafytest/meta.json');return{image:'ar://logo',name:'Ignore forged off-chain name'};}});
  const result=await read(mint.toBase58());assert.equal(result.name,'Outside launch');assert.equal(result.image,'https://arweave.net/logo');assert.equal(result.cluster,'devnet');
  assert.deepEqual(await read(mint.toBase58()),result);assert.equal(reads,1);assert.equal(jsonReads,1);
});
test('unavailable image keeps identity; invalid mint owner supplies no metadata',async()=>{
  const read=createPortfolioMetadataReader({cluster:'devnet',connection:{getMultipleAccountsInfo:async()=>[mintAccount(),metaplex()]},readJson:async()=>{throw Error('offline')}});
  const result=await read(mint.toBase58());assert.equal(result.symbol,'OUT');assert.equal(result.image,null);
  const invalid=createPortfolioMetadataReader({cluster:'devnet',connection:{getMultipleAccountsInfo:async()=>[mintAccount(new PublicKey('11111111111111111111111111111111')),metaplex()]}});
  assert.equal(await invalid(mint.toBase58()),null);
});
test('inline Token-2022 metadata resolves without a Metaplex account',async()=>{
  const tlv=(type,data)=>{const head=Buffer.alloc(4);head.writeUInt16LE(type);head.writeUInt16LE(data.length,2);return Buffer.concat([head,data]);};
  const base=Buffer.alloc(166);mintAccount().data.copy(base);base[165]=1;
  const pointer=Buffer.concat([Buffer.alloc(32),mint.toBuffer()]);
  const metadata=Buffer.concat([Buffer.alloc(32),mint.toBuffer(),string('Extension token'),string('EXT'),string('https://example.com/token.json'),Buffer.alloc(4)]);
  const account={owner:TOKEN_2022_PROGRAM_ID,data:Buffer.concat([base,tlv(ExtensionType.MetadataPointer,pointer),tlv(ExtensionType.TokenMetadata,metadata)])};
  const read=createPortfolioMetadataReader({cluster:'devnet',connection:{getMultipleAccountsInfo:async()=>[account,null]},readJson:async()=>({image:'https://example.com/logo.png'})});
  const result=await read(mint.toBase58());assert.equal(result.symbol,'EXT');assert.equal(result.name,'Extension token');
});
test('wallet changes and wrong-network responses never enrich current balances',async()=>{
  const holding={mint:mint.toBase58(),quantity:42},record={mint:mint.toBase58(),cluster:'devnet',source:'onchain-token-metadata',name:'External',symbol:'EXT'};
  let current=true,finish,updates=0;
  const task=enrichHoldingsMetadata({holdings:[holding],cluster:'devnet',isCurrent:()=>current,onUpdate:()=>updates++,apiRequest:()=>new Promise(resolve=>finish=resolve)});
  current=false;finish({available:true,data:{cluster:'devnet',items:[record]}});await task;assert.equal(holding.metadata,undefined);assert.equal(updates,0);
  current=true;
  for(const cluster of ['mainnet-beta','devnet'])await enrichHoldingsMetadata({holdings:[holding],cluster:'devnet',isCurrent:()=>current,onUpdate:()=>updates++,apiRequest:async()=>({available:true,data:{cluster,items:[record]}})});
  assert.equal(updates,1);assert.equal(holding.quantity,42);assert.equal(portfolioTokenIdentity(holding.mint,{metadata:holding.metadata}).label,'EXT');
});
