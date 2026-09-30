import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import bs58 from 'bs58';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { createAutomaticRewardChain, DEVNET_GENESIS_HASH, rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { readCommunityReserveStatus } from '../server/community-reserve-status.mjs';

// One existing, verified Devnet launch at a time. No holder snapshot or claim cycle is
// created here: eligibility must be captured at the actual migration event.
const mintValue = process.argv.find(arg => arg.startsWith('--mint='))?.slice(7);
const preflightInput = process.argv.find(arg => arg.startsWith('--preflight='))?.slice(12);
const execute = process.argv.includes('--execute');
assert.ok(mintValue, 'Pass --mint=<verified launch mint>.');
assert.equal(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET || 'false', 'false');
if (execute) assert.match(preflightInput || '', /^[a-f0-9]{64}$/, 'Dry-run first, then pass --execute --preflight=<printed ID>.');
const mint = new PublicKey(mintValue);
const participantManifest = JSON.parse(await readFile('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
const appRoleManifest = JSON.parse(await readFile('.secrets/devnet-app-roles-20260930/public.json', 'utf8'));
const manifestAddress = (rows, role) => {
  const row = rows.find(item => item.role === role && item.cluster === 'devnet');
  assert.ok(row?.address, `Missing Devnet ${role} public manifest entry.`);
  return new PublicKey(row.address).toBase58();
};
const creator = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
const authority = Keypair.fromSecretKey(bs58.decode(process.env.QA_DEVNET_ROUTER_AUTHORITY_SECRET_KEY || ''));
assert.equal(creator.publicKey.toBase58(), manifestAddress(participantManifest, 'creator'), 'Creator differs from rotated QA manifest.');
assert.equal(authority.publicKey.toBase58(), manifestAddress(appRoleManifest, 'router_authority'), 'Router authority differs from rotated role manifest.');
assert.notEqual(creator.publicKey.toBase58(), authority.publicKey.toBase58(), 'Creator and router authority must be distinct.');
const held = new Set(['B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n', '413yMCxw1uM7BbsLt4rYZKYLeByq2sSuEtpU4NPtYBHK', '928udM1owAvDpVSmoxbzch9J4PeZ7YQcdQnsNZTfuGUF']);
assert.equal(held.has(creator.publicKey.toBase58()) || held.has(authority.publicKey.toBase58()), false, 'Held wallets cannot sign reserve QA.');
if (process.env.FUNDED_REWARD_AUTHORITY) assert.equal(authority.publicKey.toBase58(), process.env.FUNDED_REWARD_AUTHORITY, 'Issuer differs from the published reward-vault authority.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
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
assert.equal(launch.creatorWallet, creator.publicKey.toBase58(), 'Rotated QA creator did not create this launch.');
const reservedTokens = Number(launch.communityAirdrop?.reservedTokens);
assert.ok(Number.isSafeInteger(reservedTokens) && reservedTokens > 0 && reservedTokens <= 500_000_000, 'Launch has no bounded community allocation.');
const apiUrl = process.env.FUNDED_PREVIEW_API_URL || 'http://127.0.0.1:8788';
const reserveResponse = await fetch(`${apiUrl}/api/airdrops/reserves`);
assert.ok(reserveResponse.ok, `Live reserve index returned HTTP ${reserveResponse.status}.`);
const reserveIndex = await reserveResponse.json();
assert.equal(reserveIndex.cluster, 'devnet');
const indexed = reserveIndex.reserves?.find(row => row.mint === mint.toBase58());
assert.ok(indexed && indexed.creatorWallet === creator.publicKey.toBase58() && Number(indexed.reservedTokens) === reservedTokens, 'Live reserve differs from the verified launch.');
assert.equal(indexed.status, 'unfunded', 'Partially funded or uncertain reserve requires reconciliation.');
assert.equal(indexed.verified, false, 'Reserve is already verified.');
const mintInfo = await connection.getParsedAccountInfo(mint, 'finalized');
const tokenProgram = mintInfo.value?.owner;
assert.ok(tokenProgram?.equals(TOKEN_PROGRAM_ID) || tokenProgram?.equals(TOKEN_2022_PROGRAM_ID), 'Launch mint has an unsupported token program.');
const decimals = Number(mintInfo.value?.data?.parsed?.info?.decimals);
assert.ok(Number.isInteger(decimals) && decimals >= 0 && decimals <= 9, 'Launch mint decimals are invalid.');
const amount = BigInt(reservedTokens) * 10n ** BigInt(decimals);
const { vault } = rewardAddresses({ programId, authority: authority.publicKey, mint });
assert.equal(indexed.vault, vault.toBase58(), 'Live reserve points to a different vault.');
const source = getAssociatedTokenAddressSync(mint, creator.publicKey, false, tokenProgram);
const destination = getAssociatedTokenAddressSync(mint, vault, true, tokenProgram);
const balance = address => connection.getTokenAccountBalance(address, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
const [sourceBefore, vaultBefore, vaultInfo, creatorSol] = await Promise.all([
  balance(source), balance(destination), connection.getAccountInfo(vault, 'finalized'), connection.getBalance(creator.publicKey, 'finalized'),
]);
assert.equal(vaultBefore, 0n, 'Vault already holds tokens; reconcile its funding receipts before another transfer.');
assert.ok(creatorSol > 10_000_000, 'Creator needs Devnet SOL for transfer and token-account rent.');
const base = { cluster:'devnet', mint:mint.toBase58(), creator:creator.publicKey.toBase58(), authority:authority.publicKey.toBase58(),
  vault:vault.toBase58(), sourceTokenAccount:source.toBase58(), vaultTokenAccount:destination.toBase58(), reservedTokens,
  amountBaseUnits:String(amount), sourceBalanceBaseUnits:String(sourceBefore), vaultBalanceBaseUnits:String(vaultBefore),
  vaultInitialized:Boolean(vaultInfo), programHash:readiness.observedProgramDataSha256 };
const preflightId = createHash('sha256').update(JSON.stringify(base)).digest('hex');
if (!execute) {
  console.log(JSON.stringify({ status:sourceBefore >= amount ? 'ready-to-fund' : 'blocked-insufficient-creator-tokens', preflightId, ...base }, null, 2));
  if (sourceBefore < amount) process.exitCode = 2;
} else {
  assert.equal(preflightInput, preflightId, 'Reserve state changed since dry-run; repeat preflight.');
  assert.ok(sourceBefore >= amount, 'Creator does not hold the full promised reserve.');
  let submittedSignature = null;
  try {
    if (!vaultInfo) await chain.ensureVault(mint.toBase58());
    const checkedVault = await readCommunityReserveStatus({ connection, programId, authority:authority.publicKey,
      fundingAuthority:creator.publicKey, mint, reservedTokens });
    assert.equal(checkedVault.vaultInitialized, true, 'Current-authority vault initialization did not finalize.');
    assert.equal(checkedVault.status, 'unfunded', 'Vault state changed before transfer.');
    const block = await connection.getLatestBlockhash('finalized');
    const transaction = new Transaction({ feePayer:creator.publicKey, recentBlockhash:block.blockhash }).add(
      createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, destination, vault, mint, tokenProgram),
      createTransferCheckedInstruction(source, mint, destination, creator.publicKey, amount, decimals, [], tokenProgram),
    );
    transaction.sign(creator);
    const simulated = await connection.simulateTransaction(transaction);
    assert.equal(simulated.value.err, null, `Reserve transfer preflight failed: ${JSON.stringify(simulated.value.err)}`);
    submittedSignature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight:false, maxRetries:2 });
    const confirmation = await connection.confirmTransaction({ signature:submittedSignature, blockhash:block.blockhash,
      lastValidBlockHeight:block.lastValidBlockHeight }, 'finalized');
    assert.equal(confirmation.value.err, null, 'Reserve transfer failed.');
    const [signatureStatus, sourceAfter, vaultAfter] = await Promise.all([
      connection.getSignatureStatus(submittedSignature, { searchTransactionHistory:true }), balance(source), balance(destination),
    ]);
    assert.equal(signatureStatus.value?.confirmationStatus, 'finalized', 'Reserve transfer is not finalized.');
    assert.equal(sourceBefore - sourceAfter, amount, 'Creator token balance did not fall by the exact reserve amount.');
    assert.equal(vaultAfter - vaultBefore, amount, 'Vault token balance did not rise by the exact reserve amount.');
    const recorded = await fetch(`${apiUrl}/api/airdrops/reserves/receipt`, { method:'POST',
      headers:{ 'content-type':'application/json', origin:'https://funded.vip' },
      body:JSON.stringify({ mint:mint.toBase58(), signature:submittedSignature }), signal:AbortSignal.timeout(20_000) });
    const receipt = await recorded.json().catch(() => ({}));
    assert.ok(recorded.ok && receipt.verified, `App did not verify reserve funding: ${receipt.error || recorded.status}`);
    console.log(JSON.stringify({ status:'reserve-funded-awaiting-migration-snapshot', ...base, signature:submittedSignature,
      creatorDeltaBaseUnits:String(sourceAfter-sourceBefore), vaultDeltaBaseUnits:String(vaultAfter-vaultBefore), appReceiptVerified:true }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status:submittedSignature ? 'submitted-needs-reconciliation' : 'stopped-before-transfer',
      mint:mint.toBase58(), vault:vault.toBase58(), submittedSignature, error:String(error.message || error) }, null, 2));
    process.exitCode = 1;
  }
}
