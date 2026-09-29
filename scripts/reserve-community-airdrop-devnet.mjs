import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createAutomaticRewardChain, DEVNET_GENESIS_HASH, rewardAddresses } from '../server/automatic-reward-chain.mjs';

// One existing, verified launch at a time. No holder snapshot or claim cycle is
// created here: eligibility must be captured at the actual migration event.
const mintValue = process.argv.find(arg => arg.startsWith('--mint='))?.slice(7);
assert.ok(mintValue, 'Pass --mint=<verified launch mint>.');
assert.equal(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET || 'false', 'false');
const mint = new PublicKey(mintValue);
const issuerSecret = process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY;
assert.ok(issuerSecret, 'A configured Devnet issuer signer is required.');
const authority = Keypair.fromSecretKey(bs58.decode(issuerSecret));
if (process.env.FUNDED_REWARD_AUTHORITY) assert.equal(authority.publicKey.toBase58(), process.env.FUNDED_REWARD_AUTHORITY, 'Issuer differs from the published reward-vault authority.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL, 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH);
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
const chain = createAutomaticRewardChain({
  connection, programId, authority,
  expectedProgramDataSha256: process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256,
});
const readiness = await chain.readiness();
assert.ok(readiness.constrainedPayouts, `Verified reward program unavailable: ${readiness.reasons.join(', ')}`);
const response = await fetch(`${process.env.FUNDED_PREVIEW_API_URL || 'http://127.0.0.1:8788'}/api/launches?limit=100`);
assert.ok(response.ok, `Launch registry returned HTTP ${response.status}.`);
const rows = await response.json();
const launch = rows.find(row => row.mint === mint.toBase58());
assert.ok(launch?.onchainVerified && launch.cluster === 'devnet', 'Mint is not a verified Devnet launch.');
assert.equal(launch.creatorWallet, authority.publicKey.toBase58(), 'Configured issuer did not create this launch.');
const reservedTokens = Number(launch.communityAirdrop?.reservedTokens);
assert.ok(Number.isSafeInteger(reservedTokens) && reservedTokens > 0 && reservedTokens <= 500_000_000, 'Launch has no bounded community allocation.');
const mintInfo = await connection.getParsedAccountInfo(mint, 'finalized');
const tokenProgram = mintInfo.value?.owner;
assert.ok(tokenProgram?.equals(TOKEN_PROGRAM_ID) || tokenProgram?.equals(TOKEN_2022_PROGRAM_ID), 'Launch mint has an unsupported token program.');
const decimals = Number(mintInfo.value?.data?.parsed?.info?.decimals);
assert.ok(Number.isInteger(decimals) && decimals >= 0 && decimals <= 9, 'Launch mint decimals are invalid.');
const amount = BigInt(reservedTokens) * 10n ** BigInt(decimals);
const { vault } = rewardAddresses({ programId, authority: authority.publicKey, mint });
const source = getAssociatedTokenAddressSync(mint, authority.publicKey, false, tokenProgram);
const destination = getAssociatedTokenAddressSync(mint, vault, true, tokenProgram);
const balance = address => connection.getTokenAccountBalance(address, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
const [sourceBefore, vaultBefore] = await Promise.all([balance(source), balance(destination)]);
assert.equal(vaultBefore, 0n, 'Vault already holds tokens; reconcile its funding receipts before another transfer.');
assert.ok(sourceBefore >= amount, 'Configured issuer does not hold the promised token reserve.');
const base = { cluster:'devnet', mint:mint.toBase58(), issuer:authority.publicKey.toBase58(), vault:vault.toBase58(), vaultTokenAccount:destination.toBase58(), reservedTokens, amountBaseUnits:String(amount) };
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ status:'ready-to-fund', ...base, sourceBalanceBaseUnits:String(sourceBefore) }, null, 2));
  process.exit(0);
}
const funding = await chain.fundTokenVault({ mint:mint.toBase58(), asset:mint.toBase58(), amount:String(amount), decimals });
const [sourceAfter, vaultAfter] = await Promise.all([balance(source), balance(destination)]);
assert.equal(sourceBefore - sourceAfter, amount, 'Issuer token balance did not fall by the exact reserve amount.');
assert.equal(vaultAfter - vaultBefore, amount, 'Vault token balance did not rise by the exact reserve amount.');
console.log(JSON.stringify({ status:'reserve-funded-awaiting-migration-snapshot', ...base, signature:funding.signature, sourceBalanceBaseUnits:String(sourceAfter), vaultBalanceBaseUnits:String(vaultAfter), balanceDeltaVerified:true }, null, 2));
