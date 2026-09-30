import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createAutomaticRewardChain, DEVNET_GENESIS_HASH, rewardAddresses } from '../server/automatic-reward-chain.mjs';

assert.equal(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET || 'false', 'false');
const secret = process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY;
assert.ok(secret, 'A configured Devnet reward authority is required.');
const authority = Keypair.fromSecretKey(bs58.decode(secret));
if (process.env.FUNDED_REWARD_AUTHORITY) assert.equal(authority.publicKey.toBase58(), process.env.FUNDED_REWARD_AUTHORITY, 'Reward authority differs from the published vault authority.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL, 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
const chain = createAutomaticRewardChain({ connection, programId, authority, expectedProgramDataSha256:process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
const readiness = await chain.readiness();
assert.ok(readiness.constrainedPayouts, `Approved Devnet reward program unavailable: ${readiness.reasons.join(', ')}`);
const response = await fetch(`${process.env.FUNDED_PREVIEW_API_URL || 'http://127.0.0.1:8788'}/api/launches?limit=100`);
assert.ok(response.ok, `Verified launch registry returned HTTP ${response.status}.`);
const selectedMint = process.argv.find(arg => arg.startsWith('--mint='))?.slice(7);
const launches = (await response.json()).filter(row => row.onchainVerified && row.cluster === 'devnet'
  && Number.isSafeInteger(Number(row.communityAirdrop?.reservedTokens)) && Number(row.communityAirdrop.reservedTokens) > 0
  && (!selectedMint || row.mint === selectedMint));
assert.ok(launches.length && (!selectedMint || launches.length === 1), 'No matching verified Devnet community allocation.');
const execute = process.argv.includes('--execute');
for (const launch of launches) {
  const { vault } = rewardAddresses({ programId, authority:authority.publicKey, mint:launch.mint });
  const prior = await connection.getAccountInfo(vault, 'finalized');
  if (execute && !prior) await chain.ensureVault(launch.mint);
  const after = await connection.getAccountInfo(vault, 'finalized');
  if (execute) assert.ok(after?.owner.equals(programId), 'Vault initialization was not finalized under the expected program.');
  console.log(JSON.stringify({ mint:launch.mint, creatorWallet:launch.creatorWallet, vault:vault.toBase58(), status:after ? 'initialized' : 'ready-to-initialize', executed:execute && !prior }));
}
