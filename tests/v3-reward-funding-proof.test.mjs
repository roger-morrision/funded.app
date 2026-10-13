import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { buildMintRouterV3DisbursementInstruction,
  deriveCommunityRewardVaultV3 } from '../mint-router-v3.js';
import { loadFinalizedV3RewardFunding } from '../server/v3-reward-funding-proof.mjs';

test('V3 reward funding requires exact finalized instruction, balance deltas, and receipt', async () => {
  const programId = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const recipient = deriveCommunityRewardVaultV3(programId, mint, authority);
  const withdrawalId = Buffer.alloc(32, 9);
  const signature = '1'.repeat(64);
  const built = buildMintRouterV3DisbursementInstruction({ programId, mint,
    authority, creator, withdrawalId, category:5, amount:30n, recipient });
  const message = new Transaction({ feePayer:authority,
    recentBlockhash:Keypair.generate().publicKey.toBase58() }).add(built.instruction).compileMessage();
  const keys = message.accountKeys.map(key => key.toBase58());
  const vaultIndex = keys.indexOf(built.vault.toBase58());
  const recipientIndex = keys.indexOf(recipient.toBase58());
  const before = keys.map(() => 0);
  const after = keys.map(() => 0);
  before[vaultIndex] = 100;
  after[vaultIndex] = 70;
  before[recipientIndex] = 10;
  after[recipientIndex] = 40;
  const tx = { slot:42, meta:{ err:null, preBalances:before, postBalances:after },
    transaction:{ signatures:[signature], message } };
  let receiptValid = true;
  const input = { connection:{ getTransaction:async () => tx }, signature,
    programId, mint, authority, creator, initialAuthority:authority,
    withdrawalId, category:5, amount:30n, recipient,
    verifyWithdrawal:async () => ({ verified:receiptValid, address:built.withdrawal }),
    verifyPolicy:async () => ({ verified:true, address:built.policy.address,
      withdrawnLamports:[0n, 0n, 0n, 0n, 0n, 30n, 0n] }) };
  const proof = await loadFinalizedV3RewardFunding(input);
  assert.equal(proof.amount, '30');
  assert.equal(proof.recipient, recipient.toBase58());
  assert.equal(proof.balanceDeltaVerified, true);
  receiptValid = false;
  assert.equal(await loadFinalizedV3RewardFunding(input), null);
  receiptValid = true;
  tx.meta.postBalances[recipientIndex] = 39;
  assert.equal(await loadFinalizedV3RewardFunding(input), null);
  tx.meta.postBalances[recipientIndex] = 40;
  tx.transaction.message.instructions[0].programIdIndex = keys.indexOf(creator.toBase58());
  assert.equal(await loadFinalizedV3RewardFunding(input), null);
  assert.equal(await loadFinalizedV3RewardFunding({ ...input, category:6 }), null);
});
