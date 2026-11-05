import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';

// Verify transaction-specific deltas, not a wallet's current balance, which can
// change after delivery. The payment PDA is the on-chain once-per-wallet guard.
export async function verifyCommunityDelivery({connection,signature,built,programId,recipient,index}) {
  const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(!tx)return null;
  assert(tx.meta?.err===null&&tx.transaction.signatures.includes(signature),'A finalized successful delivery is required.');
  const message=tx.transaction.message;
  const keys=[...(message.accountKeys||message.staticAccountKeys||[]),
    ...(!message.accountKeys?[...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])]:[])].map(k=>new PublicKey(k.pubkey||k).toBase58());
  const expected=built.instruction.keys.map(k=>k.pubkey.toBase58());
  const matches=(message.instructions||message.compiledInstructions||[]).filter(ix=>
    keys[ix.programIdIndex]===programId&&isDeepStrictEqual(Array.from(ix.accounts||ix.accountKeyIndexes,i=>keys[i]),expected)
    &&Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data).equals(built.instruction.data));
  assert.equal(matches.length,1,'Delivery instruction differs from the immutable allocation.');
  assert.equal(message.header.numRequiredSignatures,1);assert.equal(keys[0],expected[0]);
  const amount=BigInt(built.amount),mint=expected[3],tokenProgram=expected[7];
  function delta(address,owner,allowMissing=false){
    const accountIndex=keys.indexOf(address);assert(accountIndex>=0);
    const read=(rows,missing)=>{
      assert(Array.isArray(rows),'Token-balance metadata is unavailable.');
      const row=rows.find(x=>x.accountIndex===accountIndex);
      if(!row&&missing)return 0n;
      assert(row&&row.mint===mint&&row.owner===owner&&(!row.programId||row.programId===tokenProgram));
      assert(/^\d+$/.test(row.uiTokenAmount?.amount));return BigInt(row.uiTokenAmount.amount);
    };
    return read(tx.meta.postTokenBalances,false)-read(tx.meta.preTokenBalances,allowMissing);
  }
  assert.equal(delta(built.recipientToken,recipient,true),amount);
  assert.equal(delta(built.vaultToken,expected[1]),-amount);
  const payment=await connection.getAccountInfo(new PublicKey(built.payment),'finalized'),bytes=Buffer.from(payment?.data||[]);
  assert.equal(payment?.owner.toBase58(),programId);assert.equal(bytes.length,92);
  assert(bytes.subarray(0,8).equals(createHash('sha256').update('account:CommunityPayment').digest().subarray(0,8)));
  assert(bytes.subarray(8,40).equals(new PublicKey(expected[1]).toBuffer()));
  assert(bytes.subarray(40,72).equals(new PublicKey(recipient).toBuffer()));
  assert.equal(bytes.readBigUInt64LE(72),amount);assert.equal(bytes.readUInt32LE(80),index);
  assert.equal(tx.meta.preBalances[keys.indexOf(built.payment)],0);
  return {signature,finalized:true,balanceDeltaVerified:true,recipient,amount:built.amount,payment:built.payment};
}
