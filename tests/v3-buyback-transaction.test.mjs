import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputeBudgetProgram, Keypair, SystemProgram, TransactionInstruction,
  VersionedTransaction } from '@solana/web3.js';
import { prepareV3BuybackTransaction,
  verifyV3BuybackTransaction } from '../server/v3-buyback-transaction.mjs';

test('a V3 buyback signs one exact v0 message and rejects a changed destination',()=>{
  const authority=Keypair.generate(),creator=Keypair.generate();
  const instruction=new TransactionInstruction({ programId:Keypair.generate().publicKey,
    keys:[{pubkey:creator.publicKey,isSigner:true,isWritable:false},
      {pubkey:authority.publicKey,isSigner:true,isWritable:true}],
    data:Buffer.from([1,2,3]) });
  const lookupTable={ key:Keypair.generate().publicKey,
    state:{addresses:[]} };
  const preparedTransaction=prepareV3BuybackTransaction({instruction,
    authority:authority.publicKey,blockhash:Keypair.generate().publicKey.toBase58(),
    lookupTable});
  const signed=VersionedTransaction.deserialize(Buffer.from(preparedTransaction,'base64'));
  assert.equal(signed.message.compiledInstructions.length,2);
  assert.equal(signed.message.staticAccountKeys[
    signed.message.compiledInstructions[0].programIdIndex].toBase58(),
    ComputeBudgetProgram.programId.toBase58());
  const computeData=Buffer.from(signed.message.compiledInstructions[0].data);
  assert.equal(computeData[0],2);
  assert.equal(computeData.readUInt32LE(1),350_000);
  signed.sign([creator]);
  const serialized=Buffer.from(signed.serialize()).toString('base64');
  assert.deepEqual(verifyV3BuybackTransaction({signedTransaction:serialized,
    preparedTransaction,authority:authority.publicKey,creator:creator.publicKey})
    .signatures[1],signed.signatures[1]);
  const altered=new VersionedTransaction(signed.message);
  altered.message.staticAccountKeys[2]=SystemProgram.programId;
  altered.sign([creator]);
  assert.throws(()=>verifyV3BuybackTransaction({signedTransaction:Buffer.from(
    altered.serialize()).toString('base64'),preparedTransaction,
    authority:authority.publicKey,creator:creator.publicKey}),/changed/);
});
