import assert from 'node:assert/strict';
import test from 'node:test';
import bs58 from 'bs58';
import { Keypair, Transaction } from '@solana/web3.js';
import { buildMintRouterSettlementInstruction } from '../server/mint-router-payout.mjs';
import { prepareCreatorSettlement, verifyCreatorSettlement, submitCreatorSettlement, verifyFinalizedSettlementDelta,
  creatorSettlementRetryState } from '../server/creator-settlement-transaction.mjs';
import {publicError} from '../server/http-policy.mjs';

const programId = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const authority = Keypair.generate();
const creator = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();
const settlement = buildMintRouterSettlementInstruction({ programId, mint, authority:authority.publicKey,
  creator:creator.publicKey, recipient, amountLamports:'1000000', obligationId:'verified-obligation' });

function creatorSigned() {
  const transaction = Transaction.from(Buffer.from(prepareCreatorSettlement({ instruction:settlement.instruction,
    authority:authority.publicKey, blockhash }), 'base64'));
  transaction.partialSign(creator);
  return transaction.serialize({ requireAllSignatures:false, verifySignatures:false }).toString('base64');
}

test('server accepts only the exact creator-signed payout message', () => {
  const signedTransaction = creatorSigned();
  assert.ok(verifyCreatorSettlement({ signedTransaction, instruction:settlement.instruction,
    authority:authority.publicKey, creator:creator.publicKey }));
  const changed = buildMintRouterSettlementInstruction({ programId, mint, authority:authority.publicKey,
    creator:creator.publicKey, recipient, amountLamports:'1000001', obligationId:'verified-obligation' });
  assert.throws(() => verifyCreatorSettlement({ signedTransaction, instruction:changed.instruction,
    authority:authority.publicKey, creator:creator.publicKey }), /changes the approved payout/);
  assert.throws(() => verifyCreatorSettlement({ signedTransaction, instruction:settlement.instruction,
    authority:authority.publicKey, creator:Keypair.generate().publicKey }), /has not signed/);
  const unsigned = prepareCreatorSettlement({ instruction:settlement.instruction, authority:authority.publicKey, blockhash });
  assert.throws(() => verifyCreatorSettlement({ signedTransaction:unsigned, instruction:settlement.instruction,
    authority:authority.publicKey, creator:creator.publicKey }), /has not signed/);
});

test('server adds its signature to the same transaction and verifies finality', async () => {
  const transaction = verifyCreatorSettlement({ signedTransaction:creatorSigned(), instruction:settlement.instruction,
    authority:authority.publicKey, creator:creator.publicKey });
  let sends = 0;
  const connection = {
    isBlockhashValid: async () => ({ value:true }),
    sendRawTransaction: async bytes => {
      sends++;
      const submitted = Transaction.from(bytes);
      assert.equal(submitted.verifySignatures(), true);
      assert.equal(submitted.instructions.length, 1);
      return bs58.encode(submitted.signature);
    },
    getSignatureStatuses: async () => ({ value:[{ err:null, confirmationStatus:'finalized' }] }),
  };
  const signature = await submitCreatorSettlement({ connection, transaction, authority, pollMs:1 });
  assert.equal(signature, bs58.encode(transaction.signature));
  assert.equal(sends, 1);
});

test('expired creator approvals return a recoverable conflict without broadcasting', async () => {
  const transaction=verifyCreatorSettlement({signedTransaction:creatorSigned(),instruction:settlement.instruction,
    authority:authority.publicKey,creator:creator.publicKey});
  await assert.rejects(submitCreatorSettlement({connection:{isBlockhashValid:async()=>({value:false}),
    sendRawTransaction:()=>assert.fail('An expired transaction must not be broadcast')},transaction,authority}),error=>{
    const response=publicError(error,'qa-expired');assert.equal(response.status,409);
    assert.match(response.body.error,/Prepare and sign a fresh transaction/);return true;
  });
});

test('ambiguous broadcast and transient receipt errors do not create a second transaction', async () => {
  const transaction = verifyCreatorSettlement({ signedTransaction:creatorSigned(), instruction:settlement.instruction,
    authority:authority.publicKey, creator:creator.publicKey });
  let sends = 0, polls = 0;
  const connection = {
    isBlockhashValid:async () => ({ value:true }),
    sendRawTransaction:async () => { sends++; throw new Error('fetch failed'); },
    getSignatureStatuses:async () => {
      polls++;
      if (polls === 1) throw new Error('RPC timed out');
      return { value:[{ err:null, confirmationStatus:'finalized' }] };
    },
  };
  assert.equal(await submitCreatorSettlement({ connection, transaction, authority, timeoutMs:1000, pollMs:1 }),
    bs58.encode(transaction.signature));
  assert.equal(sends, 1);
  assert.equal(polls, 2);
});

test('finalized settlement proves exact router debit and recipient credit', async () => {
  const router = Keypair.generate().publicKey;
  const signature = bs58.encode(Keypair.generate().publicKey.toBytes());
  const row = {
    transaction:{ signatures:[signature], message:{ accountKeys:[router,recipient] } },
    meta:{ err:null, preBalances:[2_000_000,1_000_000], postBalances:[1_000_000,2_000_000] },
  };
  const connection = { getTransaction:async()=>row };
  assert.equal(await verifyFinalizedSettlementDelta({ connection, signature, router, recipient,
    amountLamports:'1000000' }), true);
  await assert.rejects(verifyFinalizedSettlementDelta({ connection, signature, router, recipient,
    amountLamports:'1000001' }), /exact router debit/);
  row.meta.err = { InstructionError:[0,'Custom'] };
  await assert.rejects(verifyFinalizedSettlementDelta({ connection, signature, router, recipient,
    amountLamports:'1000000' }), /unavailable or failed/);
});

test('pending payout retry waits for possible landing and permits expired or failed attempts', async () => {
  let status = null, valid = true;
  const connection = {
    getSignatureStatuses:async()=>({ value:[status] }),
    isBlockhashValid:async()=>({ value:valid }),
  };
  const input = { connection, signatures:['saved-signature'], blockhash:'saved-blockhash' };
  assert.equal((await creatorSettlementRetryState(input)).retry,false);
  valid = false;
  assert.equal((await creatorSettlementRetryState(input)).retry,true);
  status = { err:null, confirmationStatus:'confirmed' };
  assert.equal((await creatorSettlementRetryState(input)).retry,false);
  status = { err:{ InstructionError:[0,'Custom'] }, confirmationStatus:'finalized' };
  assert.equal((await creatorSettlementRetryState(input)).retry,true);
  assert.equal((await creatorSettlementRetryState({ connection, signatures:[], blockhash:'saved-blockhash' })).retry,false);
});
