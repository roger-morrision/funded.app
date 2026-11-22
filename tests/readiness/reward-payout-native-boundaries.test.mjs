import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT,NATIVE_MINT_2022,ExtensionType} from '@solana/spl-token';
import {historicalPayoutFixture,PAYOUT_ASSETS} from './reward-payout-fixture.mjs';
import {expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';
for(const [name,asset,tokenProgram] of [['WSOL',NATIVE_MINT,TOKEN_PROGRAM_ID],['Native2022',NATIVE_MINT_2022,TOKEN_2022_PROGRAM_ID]])for(const self of [false,true]){
  test(name+' self='+self+' reconciles backing lamports plus receipt and ATA rent',async t=>{
    const f=historicalPayoutFixture({asset:String(asset),tokenProgram,self}),{store}=await expiryExecutionStore(t,f);
    assert.equal((await f.chain().submitLeaf(f.plan,f.leaf,{store})).payoutTransactionVerified,true);
    const m=f.payoutTransaction.meta,keys=f.payoutTransaction.transaction.message.accountKeys,source=keys.findIndex(k=>k.equals(f.vaultToken)),destination=keys.findIndex(k=>k.equals(f.recipientToken));
    assert.equal(m.preBalances[source]-m.postBalances[source],200);assert.equal(m.postBalances[destination]-m.preBalances[destination],1200);
    assert.equal(m.preBalances.reduce((n,b,i)=>n+BigInt(b)-BigInt(m.postBalances[i]),0n),5000n);assert.equal(f.sends,1);
  });
}
test('native conservation and canonical fee rent accounts reject inconsistent evidence',async t=>{
  for(const asset of PAYOUT_ASSETS)for(const kind of ['unbalanced','reserve-credit','receipt-rent']){
    const f=historicalPayoutFixture(asset),{store}=await expiryExecutionStore(t,f);f.proofAvailable=false;await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}));
    const m=f.payoutTransaction.meta,keys=f.payoutTransaction.transaction.message.accountKeys;
    if(kind==='unbalanced')m.postBalances[0]--;
    else{const address=kind==='reserve-credit'?f.reserve:f.payment(f.leaf);m.postBalances[keys.findIndex(k=>k.equals(address))]++;m.postBalances[0]--;}
    f.proofAvailable=true;await assert.rejects(f.chain().submitLeaf(f.plan,f.leaf,{store}),/exact finalized reconciliation/);
    assert.equal((await store.read()).schedules[f.plan.id].payoutAttempts[f.leaf.recipient].state,'prepared');assert.equal(f.sends,1);assert.equal(f.latestCalls,1);
  }
});

test('metadata-only Token2022 mint quotes only required ATA storage and immutable owner',async t=>{
  const f=historicalPayoutFixture(PAYOUT_ASSETS[2]),{store}=await expiryExecutionStore(t,f),mint=f.rows.get(f.asset),sizes=[];
  const prefix=Buffer.alloc(166);mint.data.copy(prefix);prefix[165]=1;
  const pointer=Buffer.alloc(68);pointer.writeUInt16LE(ExtensionType.MetadataPointer,0);pointer.writeUInt16LE(64,2);new PublicKey(f.asset).toBuffer().copy(pointer,36);
  const metadata=Buffer.alloc(84);metadata.writeUInt16LE(ExtensionType.TokenMetadata,0);metadata.writeUInt16LE(80,2);
  new PublicKey(f.asset).toBuffer().copy(metadata,36);
  mint.data=Buffer.concat([prefix,pointer,metadata]);
  f.connection.getMinimumBalanceForRentExemption=async bytes=>{sizes.push(bytes);return 1000;};
  assert.equal((await f.chain().submitLeaf(f.plan,f.leaf,{store})).payoutTransactionVerified,true);assert.deepEqual(sizes,[100,170]);
});
