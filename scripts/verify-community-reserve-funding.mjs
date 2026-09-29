import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { readCommunityReserveStatus } from '../server/community-reserve-status.mjs';
import { rewardAddresses } from '../server/automatic-reward-chain.mjs';

const authority = Keypair.generate().publicKey, creator = Keypair.generate().publicKey;
const stranger = Keypair.generate().publicKey, mint = Keypair.generate().publicKey, programId = Keypair.generate().publicKey;
const vault = rewardAddresses({ programId, authority, mint }).vault;
const source = getAssociatedTokenAddressSync(mint, creator, false, TOKEN_PROGRAM_ID);
const destination = getAssociatedTokenAddressSync(mint, vault, true, TOKEN_PROGRAM_ID);
const amount = 30_000_000n * 1_000_000n;
const mintData = Buffer.alloc(82); mintData[44] = 6;
const vaultData = Buffer.alloc(73);
createHash('sha256').update('account:RewardVault').digest().copy(vaultData, 0, 0, 8);
authority.toBuffer().copy(vaultData, 8); mint.toBuffer().copy(vaultData, 40);
const tokenData = Buffer.alloc(165);
mint.toBuffer().copy(tokenData, 0); vault.toBuffer().copy(tokenData, 32);
tokenData.writeBigUInt64LE(amount, 64); tokenData[108] = 1;
const tokenBalance = (accountIndex, units) => ({ accountIndex, mint:mint.toBase58(), uiTokenAmount:{ amount:String(units) } });
const transaction = { transaction:{ message:{ accountKeys:[creator, source, destination], header:{ numRequiredSignatures:1 } } }, meta:{ err:null,
  preTokenBalances:[tokenBalance(1, amount), tokenBalance(2, 0)], postTokenBalances:[tokenBalance(1, 0), tokenBalance(2, amount)] } };
const accounts = new Map([
  [mint.toBase58(), { owner:TOKEN_PROGRAM_ID, data:mintData }],
  [vault.toBase58(), { owner:programId, data:vaultData }],
  [destination.toBase58(), { owner:TOKEN_PROGRAM_ID, data:tokenData }],
]);
const connection = {
  getAccountInfo:async key => accounts.get(key.toBase58()) || null,
  getSignatureStatus:async () => ({ value:{ err:null, confirmationStatus:'finalized' } }),
  getTransaction:async () => transaction,
};
const input = { connection, programId, authority, fundingAuthority:creator, mint, reservedTokens:30_000_000, fundingSignature:'verified-signature' };
assert.equal((await readCommunityReserveStatus(input)).status, 'funded');
assert.equal((await readCommunityReserveStatus({ ...input, fundingAuthority:stranger })).status, 'funding-unverified');
transaction.meta.postTokenBalances[1] = tokenBalance(2, amount - 1n);
assert.equal((await readCommunityReserveStatus(input)).status, 'funding-unverified');
transaction.meta.postTokenBalances[1] = tokenBalance(2, amount);
accounts.delete(destination.toBase58());
assert.deepEqual(await readCommunityReserveStatus(input).then(row => [row.status, row.vaultInitialized]), ['unfunded', true]);
accounts.delete(vault.toBase58());
assert.deepEqual(await readCommunityReserveStatus(input).then(row => [row.status, row.vaultInitialized]), ['unfunded', false]);
console.log('Creator-signed community reserve receipt, exact deltas, and vault readiness checks passed (mocked chain).');
