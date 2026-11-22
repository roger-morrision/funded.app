import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {buildReviewedUsdcSellConversion,decodeTokenConversionIntent,USDC_SOL_SELL_MARKET} from '../../server/token-conversion-sell.mjs';
import {priceConfigAddress} from '../../server/buyback-price-signer.mjs';
import {sellBuilderFixture as fixture} from './token-sell-capture-fixture.mjs';
const key=n=>new PublicKey(new Uint8Array(32).fill(n));

for(const category of [5,6,7])test('captured exact USDC sell builds category '+category+' with 57 bytes and 41 canonical metas',()=>{
  const f=fixture(category),built=buildReviewedUsdcSellConversion(f),ix=built.instruction;
  assert.equal(ix.data.length,57);assert.equal(ix.keys.length,41);assert.equal(ix.data.readBigUInt64LE(41),1000000n);
  assert.equal(ix.data.readBigUInt64LE(49),14069187n);assert.equal(ix.keys[6].pubkey.toBase58(),built.vault.toBase58());
  assert.ok(ix.keys[39].pubkey.equals(priceConfigAddress(f.programId)));assert.ok(ix.keys[40].pubkey.equals(f.priceSigner));
  assert.deepEqual(ix.keys.filter(k=>k.isSigner).map(k=>String(k.pubkey)),[String(f.authority),String(f.priceSigner)]);
  assert.deepEqual(decodeTokenConversionIntent(ix.data),{conversionId:Buffer.alloc(32,category).toString('hex'),category,amountIn:'1000000',minSolOut:'14069187'});
  assert.equal(built.pool,USDC_SOL_SELL_MARKET.pool);
});

test('wrong sell payload, changed exact input and weaker output cannot be substituted',()=>{
  for(const mutate of [f=>f.pumpSellInstruction.data[0]^=1,f=>f.pumpSellInstruction.data.writeBigUInt64LE(999999n,8),
    f=>f.pumpSellInstruction.data.writeBigUInt64LE(1n,16),f=>{f.pumpSellInstruction.data=Buffer.concat([f.pumpSellInstruction.data,Buffer.from([1])]);}]){
    const f=fixture();mutate(f);assert.throws(()=>buildReviewedUsdcSellConversion(f),/exact input or minimum/);
  }
});

test('only canonical positive u64 input and minimum amounts and supported categories are accepted',()=>{
  for(const value of ['0','01','-1','1.0','18446744073709551616'])for(const field of ['amountIn','minSolOut'])
    assert.throws(()=>buildReviewedUsdcSellConversion({...fixture(),[field]:value}),/u64/);
  for(const category of [0,4,8,256])assert.throws(()=>buildReviewedUsdcSellConversion({...fixture(),category}));
});

test('pool, base/quote, user vault, market vault and fee-program metas cannot be redirected',()=>{
  for(const index of [0,1,2,3,4,5,6,7,8,11,12,13,14,15,16,18,19,20]){
    const f=fixture();f.pumpSellInstruction.keys[index].pubkey=key(91);
    assert.throws(()=>buildReviewedUsdcSellConversion(f),/custody account/,'meta '+index);
  }
});

test('unexpected signer, writable privileges, volume tails and missing price separation are rejected',()=>{
  for(let index=0;index<23;index++)for(const field of ['isSigner','isWritable']){
    const f=fixture();f.pumpSellInstruction.keys[index][field]=!f.pumpSellInstruction.keys[index][field];
    assert.throws(()=>buildReviewedUsdcSellConversion(f),/flags/);
  }
  const f=fixture();f.pumpSellInstruction.keys.push({...f.pumpSellInstruction.keys[0]});
  assert.throws(()=>buildReviewedUsdcSellConversion(f),/metas/);
  assert.throws(()=>buildReviewedUsdcSellConversion({...fixture(),priceSigner:fixture().authority}),/Independent/);
});

test('market owner, pool orientation, coin-creator and special-mode changes are rejected',()=>{
  const wrongOwner=fixture();wrongOwner.poolAccount.owner=key(91);assert.throws(()=>buildReviewedUsdcSellConversion(wrongOwner),/pool bytes/);
  for(const offset of [43,75,211,243,244]){
    const f=fixture();f.poolAccount.data=Buffer.from(f.poolAccount.data);f.poolAccount.data[offset]^=1;
    assert.throws(()=>buildReviewedUsdcSellConversion(f),/orientation or mode/);
  }
});

test('fee recipient membership and canonical WSOL custody are required',()=>{
  for(const field of ['protocolRecipients','buybackRecipients'])for(const value of [[],[key(91)],undefined])
    assert.throws(()=>buildReviewedUsdcSellConversion({...fixture(),[field]:value}),/allowlisted/);
  for(const index of [10,17,22]){const f=fixture();f.pumpSellInstruction.keys[index].pubkey=key(91);assert.throws(()=>buildReviewedUsdcSellConversion(f),/fee custody/);}
});

test('conversion decoder rejects unsupported layout, discriminator, category and zero amounts',()=>{
  const data=buildReviewedUsdcSellConversion(fixture()).instruction.data;
  assert.throws(()=>decodeTokenConversionIntent(data.subarray(0,56)));
  for(const offset of [0,40,41,49]){const bytes=Buffer.from(data);if(offset===0)bytes[0]^=1;else if(offset===40)bytes[40]=4;else bytes.writeBigUInt64LE(0n,offset);assert.throws(()=>decodeTokenConversionIntent(bytes));}
});
