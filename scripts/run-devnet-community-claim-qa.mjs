import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { buildCommunityManifest } from '../community-merkle.js';
import { communityAddresses, buildCommunityInitializeInstruction } from '../server/community-claim-chain.mjs';
import { captureExactCommunitySnapshot } from '../server/community-snapshot.mjs';
import { DEVNET_GENESIS_HASH, rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { readCommunityReserveStatus } from '../server/community-reserve-status.mjs';

// Read-only evidence builder for a freshly migrated, reserve-funded Devnet QA
// mint. It never reads a private key or submits a transaction. Claim execution
// requires an independently reviewed and pinned program upgrade.
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mint = new PublicKey(arg('mint'));
const migrationSignature = arg('migration-signature');
assert.ok(migrationSignature, 'Pass --migration-signature=<finalized Pump migration transaction>.');
assert.equal(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER, 'devnet');
assert.notEqual(process.env.VITE_ALLOW_MAINNET, 'true');
const eligibilityMint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
const authority = new PublicKey(process.env.FUNDED_REWARD_AUTHORITY || process.env.QA_DEVNET_ROUTER_AUTHORITY);
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH, 'Configured endpoint is not Devnet.');
const api = process.env.FUNDED_PREVIEW_API_URL || 'http://127.0.0.1:8788';
const [launchResponse, reserveResponse] = await Promise.all([
  fetch(`${api}/api/launches?limit=100`, { signal:AbortSignal.timeout(15_000) }),
  fetch(`${api}/api/airdrops/reserves`, { signal:AbortSignal.timeout(15_000) }),
]);
assert(launchResponse.ok && reserveResponse.ok, 'Verified launch and reserve APIs must be available.');
const [launches, reserveIndex] = await Promise.all([launchResponse.json(), reserveResponse.json()]);
const launch = launches.find(row => row.mint === mint.toBase58());
const reserve = reserveIndex.reserves?.find(row => row.mint === mint.toBase58());
assert(launch?.onchainVerified && launch.cluster === 'devnet', 'Launch is not verified on Devnet.');
assert(reserve?.verified && reserve.status === 'funded' && reserve.fundingSignature, 'Community reserve lacks verified funding.');
const { vault } = rewardAddresses({ programId, authority, mint });
assert.equal(reserve.vault, vault.toBase58(), 'Funded reserve is not controlled by the current reward authority.');
const reservedTokens = Number(launch.communityAirdrop?.reservedTokens);
assert(Number.isSafeInteger(reservedTokens) && reservedTokens > 0, 'Launch has no bounded community token allocation.');
const mintInfo = await connection.getAccountInfo(mint, 'finalized');
assert(mintInfo && mintInfo.data.length >= 45, 'Launch mint is unavailable.');
const exactAmount = BigInt(reservedTokens) * 10n ** BigInt(mintInfo.data[44]);
const liveReserve = await readCommunityReserveStatus({ connection, programId, authority,
  fundingAuthority:launch.creatorWallet, mint, reservedTokens, fundingSignature:reserve.fundingSignature });
assert.equal(liveReserve.status, 'funded', 'Finalized reserve receipt did not verify against the source and vault.');
const snapshot = await captureExactCommunitySnapshot({ connection, mint:eligibilityMint, launchMint:mint, migrationSignature });
const { drop } = communityAddresses({ programId, authority, mint });
const manifest = buildCommunityManifest({ drop:drop.toBase58(), launchMint:mint.toBase58(), eligibilityMint:eligibilityMint.toBase58(),
  migrationSignature, migrationSlot:snapshot.slot, migrationBlockTime:snapshot.blockTime, snapshot,
  amountBaseUnits:String(exactAmount), excludedWallets:[authority.toBase58(), vault.toBase58(), drop.toBase58()] });
const instruction = buildCommunityInitializeInstruction({ programId, authority, creator:launch.creatorWallet,
  mint, eligibilityMint, tokenProgram:mintInfo.owner, manifest, sourceVaultBalance:String(exactAmount) });
const out = arg('out');
if (out) await writeFile(out, `${JSON.stringify({ ...manifest, snapshot }, null, 2)}\n`, { flag:'wx' });
console.log(JSON.stringify({ status:'snapshot-and-instruction-ready-awaiting-pinned-contract-upgrade', cluster:'devnet',
  mint:mint.toBase58(), eligibilityMint:eligibilityMint.toBase58(), migrationSignature, migrationSlot:snapshot.slot,
  baseSlot:snapshot.baseSlot, replayedBlocks:snapshot.replayedBlocks, holderCount:snapshot.accounts.length,
  reserveVault:vault.toBase58(), drop:drop.toBase58(), reserveBaseUnits:String(exactAmount),
  manifestRoot:manifest.root, snapshotHash:manifest.snapshotHash, leafCount:manifest.leaves.length,
  initializeInstructionBytes:instruction.instruction.data.length, savedManifest:out || null }, null, 2));
