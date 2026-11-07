import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ExtensionType} from '@solana/spl-token';
import {pack} from '@solana/spl-token-metadata';
import {readVerifiedListingMint,tokenMetadataAddress,TOKEN_METADATA_PROGRAM_ID} from '../server/token-metadata.mjs';
const mint=new PublicKey('AqSK8Dpov641bGo2LWpkMjE1nf7dsZuHkqBBm5Pkeww8');
const header=()=>{const data=Buffer.alloc(82);data.writeBigUInt64LE(123456789000000n,36);data[44]=6;data[45]=1;return data;};
const rpc=(account,metadata=null)=>({getAccountInfo:async key=>key.equals(mint)?account:key.equals(tokenMetadataAddress(mint))?metadata:null});
const field=text=>{const bytes=Buffer.from(text),length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);return Buffer.concat([length,bytes]);};
test('external SPL tokens resolve finalized Metaplex identity without a Funded launch',async()=>{
  const prefix=Buffer.alloc(65);prefix[0]=4;mint.toBuffer().copy(prefix,33);
  const metadata={owner:TOKEN_METADATA_PROGRAM_ID,data:Buffer.concat([prefix,field('External coin'),field('EXT'),field('https://example.com/meta.json')])};
  const r=await readVerifiedListingMint(rpc({owner:TOKEN_PROGRAM_ID,data:header()},metadata),mint);
  assert.equal(r.symbol,'EXT');assert.equal(r.decimals,6);assert.equal(r.supplyBaseUnits,'123456789000000');assert.equal(r.source,'metaplex-onchain-finalized');
});
test('external Token-2022 resolves metadata embedded in the mint',async()=>{
  const prefix=Buffer.alloc(166);header().copy(prefix);prefix[165]=1;
  const tlv=(type,data)=>{const h=Buffer.alloc(4);h.writeUInt16LE(type,0);h.writeUInt16LE(data.length,2);return Buffer.concat([h,data]);};
  const pointer=Buffer.alloc(64);mint.toBuffer().copy(pointer,32);
  const metadata=Buffer.from(pack({updateAuthority:mint,mint,name:'External 2022',symbol:'E22',uri:'https://example.com/22.json',additionalMetadata:[]}));
  const r=await readVerifiedListingMint(rpc({owner:TOKEN_2022_PROGRAM_ID,data:Buffer.concat([prefix,tlv(ExtensionType.MetadataPointer,pointer),tlv(ExtensionType.TokenMetadata,metadata)])}),mint);
  assert.equal(r.symbol,'E22');assert.equal(r.source,'token-2022-onchain-finalized');assert.equal(r.metadataStatus,'verified');
});
test('a valid bare mint is listable by address without fabricating metadata',async()=>{
  const r=await readVerifiedListingMint(rpc({owner:TOKEN_PROGRAM_ID,data:header()}),mint);
  assert.equal(r.mintVerified,true);assert.equal(r.metadataStatus,'missing');assert.match(r.name,/^Token /);
});
test('wrong owners, uninitialized mints and mismatched metadata are rejected',async()=>{
  await assert.rejects(()=>readVerifiedListingMint(rpc({owner:mint,data:header()}),mint),/supported SPL/);
  const bytes=header();bytes[45]=0;
  await assert.rejects(()=>readVerifiedListingMint(rpc({owner:TOKEN_PROGRAM_ID,data:bytes}),mint),/not initialized/);
  const prefix=Buffer.alloc(65);prefix[0]=4;
  await assert.rejects(()=>readVerifiedListingMint(rpc({owner:TOKEN_PROGRAM_ID,data:header()},{owner:TOKEN_METADATA_PROGRAM_ID,data:Buffer.concat([prefix,field('Fake'),field('FAKE')])}),mint),/does not match/);
});
