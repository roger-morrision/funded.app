import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { launchReserveAddresses, launchReserveInstructions } from '../launch-community-reserve.js';
import { verifyAtomicLaunchReserveTransfer } from '../server/community-reserve-status.mjs';
import { verifyPhantomMobileTransaction } from '../phantom-mobile-crypto.js';
import bs58 from 'bs58';

test('an exact creator-signed transfer into the reward vault is required', () => {
  const creator = Keypair.generate(), mint = Keypair.generate(), authority = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const reserveTokens = 30_000_000, decimals = 6, required = BigInt(reserveTokens) * 10n ** 6n;
  const reserve = launchReserveInstructions({ mint:mint.publicKey, payer:creator.publicKey,
    programId, authority, reserveTokens, decimals });
  const accounts = launchReserveAddresses({ mint:mint.publicKey, payer:creator.publicKey, programId, authority });
  assert.ok(accounts.vault.equals(reserve.vault));
  assert.ok(accounts.destination.equals(getAssociatedTokenAddressSync(mint.publicKey, reserve.vault, true, TOKEN_2022_PROGRAM_ID)));
  const message = new TransactionMessage({ payerKey:creator.publicKey,
    recentBlockhash:Keypair.generate().publicKey.toBase58(), instructions:[reserve.instructions[1]] }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([creator]);
  const keys = message.staticAccountKeys;
  const destinationIndex = keys.findIndex(key => key.equals(reserve.destination));
  const entry = amount => ({ accountIndex:destinationIndex, mint:mint.publicKey.toBase58(), owner:reserve.vault.toBase58(),
    uiTokenAmount:{ amount:String(amount), decimals } });
  const receipt = { transaction:{ message }, meta:{ err:null, loadedAddresses:{ writable:[], readonly:[] },
    preTokenBalances:[], postTokenBalances:[entry(required)] } };
  const params = { transaction:receipt, mint:mint.publicKey, creator:creator.publicKey,
    source:reserve.source, destination:reserve.destination, required, decimals };
  assert.equal(verifyAtomicLaunchReserveTransfer(params), true);
  assert.equal(verifyAtomicLaunchReserveTransfer({ ...params, required:required + 1n }), false);
  assert.equal(verifyAtomicLaunchReserveTransfer({ ...params, creator:Keypair.generate().publicKey }), false);
  assert.equal(verifyAtomicLaunchReserveTransfer({ ...params, destination:Keypair.generate().publicKey }), false);
  assert.equal(verifyAtomicLaunchReserveTransfer({ ...params, transaction:{ ...receipt, meta:{ ...receipt.meta, err:{ InstructionError:[0,'Custom'] } } } }), false);
  const wrongInstruction = createTransferCheckedInstruction(reserve.source, mint.publicKey, reserve.destination,
    creator.publicKey, required - 1n, decimals, [], TOKEN_2022_PROGRAM_ID);
  const wrongMessage = new TransactionMessage({ payerKey:creator.publicKey,
    recentBlockhash:Keypair.generate().publicKey.toBase58(), instructions:[wrongInstruction] }).compileToV0Message();
  assert.equal(verifyAtomicLaunchReserveTransfer({ ...params, transaction:{ ...receipt, transaction:{ message:wrongMessage } } }), false);
});

test('Phantom mobile v0 approval preserves the atomic launch message and both signatures', () => {
  const payer = Keypair.generate(), mint = Keypair.generate();
  const message = new TransactionMessage({ payerKey:payer.publicKey,
    recentBlockhash:Keypair.generate().publicKey.toBase58(),
    instructions:[new TransactionInstruction({ programId:Keypair.generate().publicKey,
      keys:[{ pubkey:mint.publicKey, isSigner:true, isWritable:true }], data:Buffer.from([1]) }),
      createTransferCheckedInstruction(
      Keypair.generate().publicKey, mint.publicKey, Keypair.generate().publicKey, payer.publicKey,
      30_000_000_000_000n, 6, [], TOKEN_2022_PROGRAM_ID)] }).compileToV0Message();
  const prepared = new VersionedTransaction(message);
  prepared.sign([mint]);
  const signed = VersionedTransaction.deserialize(prepared.serialize());
  signed.sign([payer]);
  assert.ok(verifyPhantomMobileTransaction(prepared, bs58.encode(signed.serialize()), payer.publicKey.toBase58()));
  const changed = VersionedTransaction.deserialize(signed.serialize());
  changed.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  changed.sign([payer, mint]);
  assert.throws(() => verifyPhantomMobileTransaction(prepared, bs58.encode(changed.serialize()), payer.publicKey.toBase58()), /different transaction/);
});
