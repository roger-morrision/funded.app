import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const execute = process.argv.includes('--execute');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
assert.equal(process.env.DEVNET_TEST_MODE, 'true');

const source = Keypair.fromSecretKey(bs58.decode(process.env.RETIRED_DEVNET_ROUTER_SECRET_KEY || ''));
assert.equal(source.publicKey.toBase58(), 'B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n', 'Source must be the retired Devnet test authority.');
const qaWallets = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
const targets = [
  { role: 'creator', signer: 'SOLANA_DEVNET_CREATOR_SECRET_KEY', desiredTokens: 45_000 },
  { role: 'claimant', signer: 'SOLANA_DEVNET_CLAIMANT_SECRET_KEY', desiredTokens: 25_000 },
].map(({ role, signer, desiredTokens }) => {
  const wallet = Keypair.fromSecretKey(bs58.decode(process.env[signer] || ''));
  assert.equal(wallet.publicKey.toBase58(), qaWallets.find(row => row.role === role && row.cluster === 'devnet')?.address);
  return { role, wallet, desiredTokens };
});

const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const mint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
assert.equal(mint.toBase58(), 'C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64');
const mintState = await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID);
assert.equal(mintState.mintAuthority, null);
const scale = 10n ** BigInt(mintState.decimals);
const tokenAccount = owner => getAssociatedTokenAddressSync(mint, owner);
const sourceAta = tokenAccount(source.publicKey);
const sourceBefore = (await getAccount(connection, sourceAta, 'finalized', TOKEN_PROGRAM_ID)).amount;
const plans = [];
for (const target of targets) {
  const ata = tokenAccount(target.wallet.publicKey);
  const before = (await getAccount(connection, ata, 'finalized', TOKEN_PROGRAM_ID)).amount;
  const desired = BigInt(target.desiredTokens) * scale;
  if (before < desired) plans.push({ ...target, ata, before, amount: desired - before });
}
const total = plans.reduce((sum, plan) => sum + plan.amount, 0n);
assert(total <= 70_000n * scale, 'QA transfer exceeds the 70,000 $FUNDED cap.');
assert(sourceBefore - total >= 998_000_000n * scale, 'Do not deplete the retired Devnet supply.');
assert(await connection.getBalance(targets[0].wallet.publicKey, 'finalized') >= 50_000_000, 'Creator needs Devnet SOL to pay transaction fees.');
const tierResponse = await fetch('http://127.0.0.1:8788/api/launch-tier-quote', { signal: AbortSignal.timeout(15_000) });
assert.equal(tierResponse.status, 200, 'Live paid-tier pricing is unavailable.');
const tierQuote = await tierResponse.json();
assert.equal(tierQuote.cluster, 'devnet');
assert.equal(tierQuote.fundedMint, mint.toBase58());
assert(tierQuote.amounts.pro + tierQuote.amounts.premier <= targets[0].desiredTokens, 'Creator target does not cover both current paid-tier quotes.');

console.log(JSON.stringify({ stage: 'preview', cluster: 'devnet', execute, mint: mint.toBase58(),
  source: source.publicKey.toBase58(), sourceBeforeBaseUnits: String(sourceBefore),
  totalBaseUnits: String(total), paidTierAmounts: tierQuote.amounts,
  targets: plans.map(plan => ({ role: plan.role, wallet: plan.wallet.publicKey.toBase58(), beforeBaseUnits: String(plan.before), transferBaseUnits: String(plan.amount), desiredTokens: plan.desiredTokens })) }));
if (!execute || !plans.length) process.exit(0);

const transaction = new Transaction({ feePayer: targets[0].wallet.publicKey });
for (const plan of plans) transaction.add(createTransferCheckedInstruction(
  sourceAta, mint, plan.ata, source.publicKey, plan.amount, mintState.decimals,
));
const signature = await sendAndConfirmTransaction(connection, transaction, [targets[0].wallet, source], {
  commitment: 'finalized', preflightCommitment: 'confirmed',
});
const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
assert.equal(status.value?.confirmationStatus, 'finalized');
assert.equal(status.value?.err, null);
for (const plan of plans) {
  const after = (await getAccount(connection, plan.ata, 'finalized', TOKEN_PROGRAM_ID)).amount;
  assert.equal(after - plan.before, plan.amount, `${plan.role} token balance delta mismatch.`);
}
assert.equal(sourceBefore - (await getAccount(connection, sourceAta, 'finalized', TOKEN_PROGRAM_ID)).amount, total, 'Source token balance delta mismatch.');
assert.equal((await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID)).supply, mintState.supply, 'Token supply changed during transfer.');
console.log(JSON.stringify({ stage: 'verified', cluster: 'devnet', signature, transferredBaseUnits: String(total),
  targets: plans.map(plan => ({ role: plan.role, wallet: plan.wallet.publicKey.toBase58(), receivedBaseUnits: String(plan.amount), finalBaseUnits: String(plan.before + plan.amount) })),
  mintSupplyUnchanged: true }));
