import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID, creatorVaultPda } from '@pump-fun/pump-sdk';
import { PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import { Keypair, SystemProgram } from '@solana/web3.js';
import { deriveMintRouterV3, buildMintRouterV3SettlementInstruction } from '../mint-router-v3.js';
import { verifyV3PumpCollection } from '../server/v3-collection-proof.mjs';

const programId = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const router = deriveMintRouterV3(programId, mint).address;
const vault = creatorVaultPda(router);
const signature = bs58.encode(Buffer.alloc(64, 8));
const keys = [authority, router, vault, NATIVE_MINT, TOKEN_PROGRAM_ID, PUMP_PROGRAM_ID,
  SystemProgram.programId];
const collection = {
  programIdIndex:5,
  accounts:[1, 0, 2, 0, 3, 4],
  data:bs58.encode(createHash('sha256').update('global:collect_creator_fee_v2').digest().subarray(0, 8)),
};
const transaction = {
  slot:42,
  transaction:{ signatures:[signature], message:{ accountKeys:keys, instructions:[collection] } },
  meta:{ err:null, loadedAddresses:{ writable:[], readonly:[] },
    preBalances:[10_000_000, 1_000_000, 0, 0, 0, 0, 0],
    postBalances:[9_995_000, 3_000_000, 0, 0, 0, 0, 0] },
};
const params = { transaction, signature, programId, mint, expectedLamports:2_000_000 };
const proof = await verifyV3PumpCollection(params);
assert.equal(proof?.router, router.toBase58());
assert.equal(proof?.expectedLamports, 2_000_000n);
assert.equal(proof?.claimId.length, 32);
const settle = buildMintRouterV3SettlementInstruction({ ...proof, programId, authority, creator });
assert.equal(settle.instruction.data.readBigUInt64LE(40), 2_000_000n);
const altered = original => ({ ...original,
  transaction:{ ...original.transaction, signatures:[...original.transaction.signatures],
    message:{ ...original.transaction.message, accountKeys:[...original.transaction.message.accountKeys],
      instructions:original.transaction.message.instructions.map(ix => ({ ...ix, accounts:[...ix.accounts] })) } },
  meta:{ ...original.meta, preBalances:[...original.meta.preBalances], postBalances:[...original.meta.postBalances] },
});
assert.equal(await verifyV3PumpCollection({ ...params, signature:bs58.encode(Buffer.alloc(64, 9)) }), null);
assert.equal(await verifyV3PumpCollection({ ...params, expectedLamports:1_999_999 }), null);
assert.equal(await verifyV3PumpCollection({ ...params, transaction:{ ...transaction, meta:{ ...transaction.meta, err:{ InstructionError:[0, 'Custom'] } } } }), null);
const wrongVault = altered(transaction);
wrongVault.transaction.message.instructions[0].accounts[2] = 0;
assert.equal(await verifyV3PumpCollection({ ...params, transaction:wrongVault }), null);
const wrongSource = altered(transaction);
wrongSource.transaction.message.instructions[0].programIdIndex = 6;
assert.equal(await verifyV3PumpCollection({ ...params, transaction:wrongSource }), null);
const unrelatedTransfer = altered(transaction);
unrelatedTransfer.transaction.message.instructions.push({ programIdIndex:6, accounts:[0, 1], data:'' });
assert.equal(await verifyV3PumpCollection({ ...params, transaction:unrelatedTransfer }), null);
const noCredit = altered(transaction);
noCredit.meta.postBalances[1] = noCredit.meta.preBalances[1];
assert.equal(await verifyV3PumpCollection({ ...params, transaction:noCredit }), null);
const ammTransfer = await PUMP_AMM_SDK.transferCreatorFeesToPumpV2Instruction({
  payer:authority, coinCreator:router, quoteMint:NATIVE_MINT, quoteTokenProgram:TOKEN_PROGRAM_ID,
});
const withAmm = altered(transaction);
const ammProgram = ammTransfer.programId.toBase58();
const accountKeys = withAmm.transaction.message.accountKeys;
for (const key of [ammTransfer.programId, ...ammTransfer.keys.map(item => item.pubkey)]) {
  if (!accountKeys.some(item => item.equals(key))) {
    accountKeys.push(key);
    withAmm.meta.preBalances.push(0);
    withAmm.meta.postBalances.push(0);
  }
}
const amm = { programIdIndex:accountKeys.findIndex(key => key.toBase58() === ammProgram),
  accounts:ammTransfer.keys.map(item => accountKeys.findIndex(key => key.equals(item.pubkey))),
  data:bs58.encode(ammTransfer.data) };
withAmm.transaction.message.instructions.unshift(amm);
assert.equal((await verifyV3PumpCollection({ ...params, transaction:withAmm }))?.expectedLamports, 2_000_000n);
const unrelatedAmm = altered(withAmm);
unrelatedAmm.transaction.message.instructions[0].data = bs58.encode(Buffer.alloc(8));
assert.equal(await verifyV3PumpCollection({ ...params, transaction:unrelatedAmm }), null);
const wrongAmmCreator = altered(withAmm);
wrongAmmCreator.transaction.message.instructions[0].accounts[5] = 0;
assert.equal(await verifyV3PumpCollection({ ...params, transaction:wrongAmmCreator }), null);
console.log('v3 finalized Pump collection proof checks passed (synthetic transaction only)');
