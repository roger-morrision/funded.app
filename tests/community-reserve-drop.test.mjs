import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import bs58 from 'bs58';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Keypair } from '@solana/web3.js';
import { communityAddresses } from '../server/community-claim-chain.mjs';
import { rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { readCommunityReserveStatus } from '../server/community-reserve-status.mjs';

const key = () => Keypair.generate().publicKey;
const programId = key(), authority = key(), creator = key(), mint = key(), eligibilityMint = key();
const { vault } = rewardAddresses({ programId, authority, mint });
const { drop } = communityAddresses({ programId, authority, mint });
const source = getAssociatedTokenAddressSync(mint, vault, true, TOKEN_PROGRAM_ID);
const destination = getAssociatedTokenAddressSync(mint, drop, true, TOKEN_PROGRAM_ID);
const mintBytes = Buffer.alloc(82);
mintBytes.writeUInt32LE(0, 0); mintBytes.writeBigUInt64LE(1_000_000n, 36); mintBytes[44] = 0;
const vaultBytes = Buffer.alloc(73);
createHash('sha256').update('account:RewardVault').digest().copy(vaultBytes, 0, 0, 8);
authority.toBuffer().copy(vaultBytes, 8); mint.toBuffer().copy(vaultBytes, 40);
const tokenBytes = (owner, balance) => {
  const bytes = Buffer.alloc(165);
  mint.toBuffer().copy(bytes, 0); owner.toBuffer().copy(bytes, 32);
  bytes.writeBigUInt64LE(BigInt(balance), 64); bytes[108] = 1;
  return bytes;
};
const dropBytes = Buffer.alloc(350);
createHash('sha256').update('account:CommunityDrop').digest().copy(dropBytes, 0, 0, 8);
authority.toBuffer().copy(dropBytes, 8); creator.toBuffer().copy(dropBytes, 40); authority.toBuffer().copy(dropBytes, 72);
mint.toBuffer().copy(dropBytes, 104); eligibilityMint.toBuffer().copy(dropBytes, 136);
dropBytes.fill(7, 168, 200); dropBytes.fill(8, 200, 232);
dropBytes.writeBigUInt64LE(123n, 296); dropBytes.writeBigUInt64LE(123n, 304);
dropBytes.writeBigUInt64LE(100n, 312); dropBytes.writeBigUInt64LE(30n, 320);
const openingSignature = bs58.encode(Buffer.alloc(64, 9));
const openingData = bs58.encode(createHash('sha256').update('global:initialize_community_drop_from_reward_vault').digest().subarray(0, 8));
const openingKeys = [authority, creator, authority, mint, eligibilityMint, vault, source, drop, destination, programId,
  TOKEN_PROGRAM_ID, key(), key()];
const tokenRow = (accountIndex, amount) => ({ accountIndex, mint:mint.toBase58(), uiTokenAmount:{ amount:String(amount) } });
const openingTransaction = { slot:124, meta:{ err:null,
  preTokenBalances:[tokenRow(6, 100), tokenRow(8, 0)], postTokenBalances:[tokenRow(6, 0), tokenRow(8, 100)] },
  transaction:{ message:{ accountKeys:openingKeys,
    instructions:[{ programIdIndex:9, accounts:[0,1,2,3,4,5,6,7,8,10,11,12,12], data:openingData }] } } };
const accounts = new Map([
  [mint.toBase58(), { owner:TOKEN_PROGRAM_ID, data:mintBytes }],
  [vault.toBase58(), { owner:programId, data:vaultBytes }],
  [source.toBase58(), { owner:TOKEN_PROGRAM_ID, data:tokenBytes(vault, 0) }],
  [drop.toBase58(), { owner:programId, data:dropBytes }],
  [destination.toBase58(), { owner:TOKEN_PROGRAM_ID, data:tokenBytes(drop, 70) }],
]);
const connection = { getAccountInfo:async address => accounts.get(address.toBase58()) || null,
  getSignatureStatus:async () => ({ value:{ confirmationStatus:'finalized', err:null } }),
  getTransaction:async () => openingTransaction };
const input = { connection, programId, authority, fundingAuthority:creator, mint, reservedTokens:100,
  expectedEligibilityMint:eligibilityMint, dropOpeningSignature:openingSignature };

test('recognizes only a finalized atomic escrow transfer with exact opening and current claim balances', async () => {
  const status = await readCommunityReserveStatus(input);
  assert.equal(status.status, 'drop-active');
  assert.equal(status.verified, true);
  assert.equal(status.claimedBaseUnits, '30');
  assert.equal(status.remainingBaseUnits, '70');
  assert.equal(status.drop, drop.toBase58());
  const withoutReceipt = await readCommunityReserveStatus({ ...input, dropOpeningSignature:null });
  assert.equal(withoutReceipt.verified, false);
  assert.equal(withoutReceipt.status, 'funding-unverified');
  const wrongReceipt = await readCommunityReserveStatus({ ...input, connection:{ ...connection,
    getTransaction:async () => ({ ...openingTransaction, meta:{ ...openingTransaction.meta,
      preTokenBalances:[tokenRow(6, 99), tokenRow(8, 0)] } }) } });
  assert.equal(wrongReceipt.verified, false);
  const unrelatedInstruction = await readCommunityReserveStatus({ ...input, connection:{ ...connection,
    getTransaction:async () => ({ ...openingTransaction, transaction:{ message:{ ...openingTransaction.transaction.message,
      instructions:[{ ...openingTransaction.transaction.message.instructions[0], accounts:[0,1,2,3,4,5,8,7,6,10,11,12,12] }] } } }) } });
  assert.equal(unrelatedInstruction.verified, false);
  const withoutExpectedEligibility = await readCommunityReserveStatus({ ...input, expectedEligibilityMint:null });
  assert.equal(withoutExpectedEligibility.verified, false);
});
