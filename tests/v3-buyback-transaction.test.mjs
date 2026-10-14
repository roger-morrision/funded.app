import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputeBudgetProgram, Keypair, TransactionInstruction,
  VersionedTransaction } from '@solana/web3.js';
import { prepareV3BuybackTransaction } from '../server/v3-buyback-transaction.mjs';

test('automatic V3 buyback prepares one authority-signed v0 message',()=>{
  const authority=Keypair.generate(),creator=Keypair.generate();
  const instruction=new TransactionInstruction({ programId:Keypair.generate().publicKey,
    keys:[{pubkey:creator.publicKey,isSigner:false,isWritable:false},
      {pubkey:authority.publicKey,isSigner:true,isWritable:true}],
    data:Buffer.from([1,2,3]) });
  const prepared=prepareV3BuybackTransaction({instruction,
    authority:authority.publicKey,blockhash:Keypair.generate().publicKey.toBase58(),
    lookupTable:{key:Keypair.generate().publicKey,state:{addresses:[]}}});
  const signed=VersionedTransaction.deserialize(Buffer.from(prepared,'base64'));
  assert.equal(signed.message.header.numRequiredSignatures,1);
  assert.equal(signed.message.staticAccountKeys[0].toBase58(),authority.publicKey.toBase58());
  assert.equal(signed.message.compiledInstructions.length,2);
  assert.equal(signed.message.staticAccountKeys[
    signed.message.compiledInstructions[0].programIdIndex].toBase58(),
    ComputeBudgetProgram.programId.toBase58());
  const computeData=Buffer.from(signed.message.compiledInstructions[0].data);
  assert.equal(computeData[0],2);
  assert.equal(computeData.readUInt32LE(1),350_000);
  signed.sign([authority]);
  assert.notDeepEqual(signed.signatures[0],new Uint8Array(64));
});
