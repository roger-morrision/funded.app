import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {buybackPriceService,cosignBuyback} from '../server/buyback-price-signer.mjs';
import {priceSignerFixture} from './fixtures/buyback-price-signer.mjs';

test('buyback price approval is bound to the finalized Devnet signer account and exact quote',async()=>{
  const program=Keypair.generate().publicKey, payer=Keypair.generate().publicKey,connection={};
  const {env,request}=priceSignerFixture(connection,program),service=buybackPriceService(env);
  assert.equal(buybackPriceService({}),null);
  const transaction=amount=>new VersionedTransaction(new TransactionMessage({payerKey:payer,
    recentBlockhash:payer.toBase58(),instructions:[new TransactionInstruction({programId:program,
      keys:[{pubkey:service.signer,isSigner:true,isWritable:false}],data:Buffer.from([amount])})]}).compileToV0Message());
  const first=transaction(1);
  await cosignBuyback({connection,transaction:first,program,service,request});
  const captured=Buffer.from(first.signatures[1]).toString('base64');
  await assert.rejects(cosignBuyback({connection,transaction:transaction(2),program,service,
    request:async()=>({ok:true,json:async()=>({signature:captured})})}),/Invalid price signature/);
  for(const override of [{getGenesisHash:async()=>'other cluster'},{getAccountInfo:async()=>null},
    {getAccountInfo:async()=>({owner:payer,data:Buffer.alloc(40)})}]){
    await assert.rejects(cosignBuyback({connection:{...connection,...override},transaction:transaction(1),program,service,
      request:async()=>assert.fail('Must reject before contacting signer')}),/not activated/);
  }
});
