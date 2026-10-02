import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID, TokenAccountNotFoundError } from '@solana/spl-token';

assert.equal(process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER, 'devnet', 'QA budget provisioning is Devnet only.');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false', 'Mainnet must be disabled.');
assert.equal(process.env.DEVNET_TEST_MODE, 'true', 'DEVNET_TEST_MODE=true is required.');

const secret = name => {
  const encoded = String(process.env[name] || '').trim();
  if (!encoded) throw new Error(`${name} is required.`);
  return Keypair.fromSecretKey(bs58.decode(encoded));
};
const appRoles = JSON.parse(readFileSync('.secrets/devnet-app-roles-20260930/public.json', 'utf8'));
const qaWallets = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
const expectedAddress = (manifest, role) => manifest.find(item => item.role === role && item.cluster === 'devnet')?.address;
const sourceRole = String(process.env.FUNDED_QA_SOURCE_ROLE || 'funded_holder');
assert(['funded_holder', 'referrer'].includes(sourceRole), 'Choose an isolated Devnet funded_holder or rotated referrer funding source.');
const source = sourceRole === 'referrer' ? secret('SOLANA_DEVNET_REFERRER_SECRET_KEY') : secret('QA_DEVNET_FUNDED_HOLDER_SECRET_KEY');
assert.equal(source.publicKey.toBase58(), expectedAddress(sourceRole === 'referrer' ? qaWallets : appRoles, sourceRole), 'Funding signer differs from its Devnet QA manifest.');
const targets = [
  { role:'creator', wallet:secret('SOLANA_DEVNET_CREATOR_SECRET_KEY'), tokens:Number(process.env.FUNDED_QA_CREATOR_BUDGET_TOKENS || '10') },
  { role:'claimant', wallet:secret('SOLANA_DEVNET_CLAIMANT_SECRET_KEY'), tokens:Number(process.env.FUNDED_QA_CLAIMANT_BUDGET_TOKENS || '2') },
];
const holderBudget = Number(process.env.FUNDED_QA_HOLDER_BUDGET_TOKENS || '0');
assert(Number.isSafeInteger(holderBudget) && holderBudget >= 0 && holderBudget <= 250_000, 'Holder QA budget must be 0-250,000 tokens.');
if (holderBudget > 0) targets.push({ role:'funded_holder', wallet:secret('QA_DEVNET_FUNDED_HOLDER_SECRET_KEY'), tokens:holderBudget });
for (const target of targets) {
  assert.equal(target.wallet.publicKey.toBase58(), expectedAddress(target.role === 'funded_holder' ? appRoles : qaWallets, target.role), `${target.role} signer differs from its Devnet QA manifest.`);
  assert(Number.isSafeInteger(target.tokens) && target.tokens > 0 && target.tokens <= 250_000, `${target.role} QA budget must be 1-250,000 tokens.`);
}
assert(targets.every(target => !target.wallet.publicKey.equals(source.publicKey)), 'QA funded holder must remain separate from participant wallets.');

const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const mint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
const mintState = await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID);
const sourceSol = await connection.getBalance(source.publicKey, 'finalized');
assert(sourceSol >= 10_000_000, 'Funding source needs at least 0.01 Devnet SOL for transaction fees.');
const scale = 10n ** BigInt(mintState.decimals);
const sourceAta = getAssociatedTokenAddressSync(mint, source.publicKey);
const sourceBefore = await getAccount(connection, sourceAta, 'finalized', TOKEN_PROGRAM_ID);
const plans = [];
for (const target of targets) {
  const ata = getAssociatedTokenAddressSync(mint, target.wallet.publicKey);
  let before = 0n;
  try { before = (await getAccount(connection, ata, 'finalized', TOKEN_PROGRAM_ID)).amount; }
  catch (error) { if (!(error instanceof TokenAccountNotFoundError)) throw error; }
  const desired = BigInt(target.tokens) * scale;
  if (before < desired) plans.push({ ...target, ata, before, amount:desired - before });
}
const total = plans.reduce((sum, plan) => sum + plan.amount, 0n);
assert(sourceBefore.amount >= total, 'The selected Devnet QA source cannot cover the requested budget.');
if (sourceRole === 'referrer') assert(sourceBefore.amount - total >= 10_000n * scale, 'Keep at least 10,000 $FUNDED in the referrer QA wallet.');
const preview = { status:'planned', cluster:'devnet', mint:mint.toBase58(), sourceRole, source:source.publicKey.toBase58(), sourceBalanceBaseUnits:String(sourceBefore.amount), sourceSol:sourceSol / 1e9, transferBaseUnits:String(total), targets:plans.map(plan => ({ role:plan.role, wallet:plan.wallet.publicKey.toBase58(), baseUnits:String(plan.amount) })) };
if (!process.argv.includes('--execute')) { console.log(JSON.stringify(preview)); process.exit(0); }
if (!plans.length) {
  console.log(JSON.stringify({ status:'already-funded', cluster:'devnet', source:source.publicKey.toBase58(), targets:targets.map(row => ({ role:row.role, wallet:row.wallet.publicKey.toBase58(), tokens:row.tokens })) }));
  process.exit(0);
}
const transaction = new Transaction();
for (const plan of plans) transaction.add(
  createAssociatedTokenAccountIdempotentInstruction(source.publicKey, plan.ata, plan.wallet.publicKey, mint),
  createTransferCheckedInstruction(sourceAta, mint, plan.ata, source.publicKey, plan.amount, mintState.decimals),
);
const supplyBefore = mintState.supply;
const signature = await sendAndConfirmTransaction(connection, transaction, [source], { commitment:'finalized', preflightCommitment:'confirmed' });
const status = await connection.getSignatureStatus(signature, { searchTransactionHistory:true });
assert.equal(status.value?.confirmationStatus, 'finalized'); assert.equal(status.value?.err, null);
for (const plan of plans) assert.equal((await getAccount(connection, plan.ata, 'finalized', TOKEN_PROGRAM_ID)).amount - plan.before, plan.amount, `${plan.role} balance delta mismatch.`);
assert.equal(sourceBefore.amount - (await getAccount(connection, sourceAta, 'finalized', TOKEN_PROGRAM_ID)).amount, total, 'Funding-source delta mismatch.');
assert.equal((await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID)).supply, supplyBefore, 'Transfer changed the $FUNDED supply.');
console.log(JSON.stringify({ status:'verified', cluster:'devnet', signature, source:source.publicKey.toBase58(), transferredBaseUnits:String(total), targets:plans.map(plan => ({ role:plan.role, wallet:plan.wallet.publicKey.toBase58(), baseUnits:String(plan.amount) })) }));
