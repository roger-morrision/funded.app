import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { buildProtectedMintRouterV3InitializeInstruction,
  deriveCommunityRewardVaultV3 } from '../mint-router-v3.js';
import { buildProtectedMintV3ApprovalInstruction,
  buildProtectedMintV3DisbursementInstruction } from '../protected-mint-router-v3.js';
import { loadFinalizedV3RewardFunding } from '../server/v3-reward-funding-proof.mjs';

const keys = () => ({ programId:Keypair.generate().publicKey,
  mint:Keypair.generate().publicKey, authority:Keypair.generate().publicKey,
  creator:Keypair.generate().publicKey });

function finalized(input, instructions, vault, recipient, amount) {
  const message = new Transaction({ feePayer:input.authority,
    recentBlockhash:Keypair.generate().publicKey.toBase58() }).add(...instructions).compileMessage();
  const addresses = message.accountKeys.map(key => key.toBase58());
  const before = addresses.map(() => 0);
  const after = addresses.map(() => 0);
  before[addresses.indexOf(vault.toBase58())] = 100;
  after[addresses.indexOf(vault.toBase58())] = 100 - amount;
  after[addresses.indexOf(recipient.toBase58())] = amount;
  return { slot:50, meta:{ err:null, preBalances:before, postBalances:after },
    transaction:{ signatures:['1'.repeat(64)], message } };
}

test('protected mint instruction commits creator, holder and X shares', () => {
  const input = keys();
  const built = buildProtectedMintRouterV3InitializeInstruction({ ...input,
    shares:{ creatorWalletPercent:60, holderAirdropPercent:10, solClaimPercent:10 } });
  assert.deepEqual(built.directedUnits, [6_000_000, 1_000_000, 1_000_000]);
  assert.equal(built.instruction.data.length, 44);
  assert.equal(built.instruction.data.readUInt32LE(32), 6_000_000);
});

test('protected holder and X funding proves the exact split in the instruction', async () => {
  const input = keys();
  const recipient = deriveCommunityRewardVaultV3(input.programId, input.mint, input.authority);
  const withdrawalId = Buffer.alloc(32, 5);
  const built = buildProtectedMintV3DisbursementInstruction({ ...input,
    withdrawalId, category:0, beneficiary:1, amount:30n, holderAmount:20n, recipient });
  const tx = finalized(input, [built.instruction], built.vault, recipient, 30);
  const proofInput = { connection:{ getTransaction:async () => tx }, signature:'1'.repeat(64),
    ...input, initialAuthority:input.authority, withdrawalId, category:0,
    beneficiary:1, amount:30n, holderAmount:20n, recipient, protectedPolicy:true,
    verifyWithdrawal:async () => ({ verified:true, address:built.withdrawal }),
    verifyPolicy:async () => ({ verified:true, protectedPolicy:true,
      address:built.policy.address, withdrawnLamports:[30n,0n,0n,0n,0n,0n,0n] }) };
  const proof = await loadFinalizedV3RewardFunding(proofInput);
  assert.equal(proof.holderAmount, '20');
  assert.equal(proof.balanceDeltaVerified, true);
  assert.equal(await loadFinalizedV3RewardFunding({ ...proofInput, holderAmount:19n }), null);
});

test('protected referral payout requires exact creator-approved recipient and amount', async () => {
  const input = keys();
  const recipient = Keypair.generate().publicKey;
  const withdrawalId = Buffer.alloc(32, 6);
  const params = { ...input, withdrawalId, category:2, beneficiary:4,
    amount:30n, recipient };
  const approval = buildProtectedMintV3ApprovalInstruction(params);
  const built = buildProtectedMintV3DisbursementInstruction(params);
  const tx = finalized(input, [approval.instruction, built.instruction], built.vault, recipient, 30);
  const proofInput = { connection:{ getTransaction:async () => tx }, signature:'1'.repeat(64),
    ...params, initialAuthority:input.authority, protectedPolicy:true,
    verifyWithdrawal:async () => ({ verified:true, address:built.withdrawal }),
    verifyPolicy:async () => ({ verified:true, protectedPolicy:true,
      address:built.policy.address, withdrawnLamports:[0n,0n,30n,0n,0n,0n,0n] }),
    verifyApproval:async () => ({ verified:true, address:approval.approval }) };
  assert.equal((await loadFinalizedV3RewardFunding(proofInput)).approval,
    approval.approval.toBase58());
  assert.equal(await loadFinalizedV3RewardFunding({ ...proofInput,
    verifyApproval:async () => ({ verified:false }) }), null);
  tx.transaction.message.instructions.shift();
  assert.equal(await loadFinalizedV3RewardFunding(proofInput), null);
});
