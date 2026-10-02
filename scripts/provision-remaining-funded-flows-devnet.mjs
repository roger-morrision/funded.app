import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildVerifiedPoolTradeTransaction, describeTradeQuote, fetchVerifiedPoolSnapshot } from '../pump-trading.js';

assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
assert.equal(process.env.DEVNET_TEST_MODE, 'true');
const execute = process.argv.includes('--execute');
const buy = process.argv.includes('--buy');
const transfer = process.argv.includes('--transfer');
assert.notEqual(buy, transfer, 'Choose exactly one of --buy or --transfer.');

const appRoles = JSON.parse(readFileSync('.secrets/devnet-app-roles-20260930/public.json', 'utf8'));
const qaWallets = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
const signer = (role, name, manifest) => {
  const secret = String(process.env[name] || '').trim();
  assert(secret, `${name} is required.`);
  const wallet = Keypair.fromSecretKey(bs58.decode(secret));
  assert.equal(wallet.publicKey.toBase58(), manifest.find(row => row.role === role && row.cluster === 'devnet')?.address, `${role} differs from the Devnet QA manifest.`);
  return wallet;
};
const creator = signer('creator', 'SOLANA_DEVNET_CREATOR_SECRET_KEY', qaWallets);
const claimant = signer('claimant', 'SOLANA_DEVNET_CLAIMANT_SECRET_KEY', qaWallets);
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const mint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
const initialMint = await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID);
assert.equal(initialMint.mintAuthority, null, 'Devnet mint must have revoked mint authority.');
const scale = 10n ** BigInt(initialMint.decimals);
const ata = owner => getAssociatedTokenAddressSync(mint, owner);
const balance = async owner => (await getAccount(connection, ata(owner), 'finalized', TOKEN_PROGRAM_ID)).amount;
const finalized = async signature => {
  const status = await connection.getSignatureStatus(signature, { searchTransactionHistory:true });
  assert.equal(status.value?.confirmationStatus, 'finalized');
  assert.equal(status.value?.err, null);
};

if (buy) {
  const solAmount = 0.21;
  const before = await balance(claimant.publicKey);
  const requiredBefore = 25_000n * scale;
  if (before >= requiredBefore) {
    console.log(JSON.stringify({ status:'already-funded', stage:'buy', claimant:claimant.publicKey.toBase58() }));
    process.exit(0);
  }
  const snapshot = await fetchVerifiedPoolSnapshot({ connection, mint, poolAddress:process.env.VITE_FUNDED_SWAP_POOL });
  const quote = await buildVerifiedPoolTradeTransaction({ connection, side:'buy', mint, poolAddress:process.env.VITE_FUNDED_SWAP_POOL,
    user:claimant.publicKey, amount:solAmount, slippagePercent:1, feeOwner:process.env.VITE_FUNDED_TRADE_FEE_OWNER });
  const summary = describeTradeQuote(quote, 1);
  assert(summary.maximumSpendSol <= 0.2121 && summary.expected > 4_000, 'Pool quote cannot safely fill the QA gap.');
  const solBefore = await connection.getBalance(claimant.publicKey, 'finalized');
  assert(solBefore >= 300_000_000, 'Claimant needs at least 0.3 Devnet SOL.');
  const poolAta = new PublicKey(snapshot.poolBaseTokenAccount);
  const poolBefore = BigInt((await connection.getTokenAccountBalance(poolAta, 'finalized')).value.amount);
  console.log(JSON.stringify({ stage:'buy-preview', cluster:'devnet', wallet:claimant.publicKey.toBase58(), solAmount, quote:summary, execute }));
  if (!execute) process.exit(0);
  const block = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ feePayer:claimant.publicKey, recentBlockhash:block.blockhash }).add(...quote.instructions);
  transaction.sign(claimant);
  assert(transaction.serialize().length <= 1232);
  const signature = await sendAndConfirmTransaction(connection, transaction, [claimant], { commitment:'finalized', preflightCommitment:'confirmed' });
  await finalized(signature);
  const delta = (await balance(claimant.publicKey)) - before;
  const poolAfter = BigInt((await connection.getTokenAccountBalance(poolAta, 'finalized')).value.amount);
  assert(delta >= BigInt(quote.minimumOutputAmount.toString()), 'Claimant received fewer tokens than the minimum quote.');
  assert.equal(poolBefore - poolAfter, delta, 'Pool and claimant token deltas differ.');
  assert.equal((await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID)).supply, initialMint.supply, 'Buy changed mint supply.');
  console.log(JSON.stringify({ status:'verified', stage:'buy', signature, wallet:claimant.publicKey.toBase58(), acquiredBaseUnits:String(delta), solBefore:solBefore / 1e9, solAfter:(await connection.getBalance(claimant.publicKey, 'finalized')) / 1e9 }));
  process.exit(0);
}

const sources = [
  { role:'buyback_operator', name:'QA_DEVNET_BUYBACK_OPERATOR_SECRET_KEY', manifest:appRoles },
  { role:'x_partner', name:'QA_DEVNET_X_PARTNER_SECRET_KEY', manifest:appRoles, reserveTokens:1 },
  { role:'funded_holder', name:'QA_DEVNET_FUNDED_HOLDER_SECRET_KEY', manifest:appRoles, reserveTokens:1 },
  { role:'coin_holder', name:'QA_DEVNET_COIN_HOLDER_SECRET_KEY', manifest:appRoles, reserveTokens:1 },
  { role:'referrer_level_2', name:'SOLANA_DEVNET_REFERRER_LEVEL_2_SECRET_KEY', manifest:qaWallets, reserveTokens:1 },
].map(row => ({ ...row, wallet:signer(row.role, row.name, row.manifest) }));
const desired = 25_000n * scale;
const targetRows = [
  { role:'creator', wallet:creator, balance:await balance(creator.publicKey) },
  { role:'claimant', wallet:claimant, balance:await balance(claimant.publicKey) },
];
assert(targetRows[1].balance >= 5_000n * scale, 'Buy $FUNDED for claimant before transfers.');
const plans = [];
for (const source of sources) {
  const owned = await balance(source.wallet.publicKey);
  const reserve = BigInt(source.reserveTokens || 0) * scale;
  source.balance = owned > reserve ? owned - reserve : 0n;
}
for (const target of targetRows) {
  let needed = target.balance >= desired ? 0n : desired - target.balance;
  for (const source of sources) {
    if (!needed) break;
    const amount = source.balance < needed ? source.balance : needed;
    if (!amount) continue;
    plans.push({ source, target, amount });
    source.balance -= amount;
    needed -= amount;
  }
  assert.equal(needed, 0n, `QA sources cannot fund ${target.role} to 25,000 $FUNDED.`);
}
console.log(JSON.stringify({ stage:'transfer-preview', cluster:'devnet', mint:mint.toBase58(), execute,
  plans:plans.map(row => ({ sourceRole:row.source.role, source:row.source.wallet.publicKey.toBase58(), targetRole:row.target.role,
    target:row.target.wallet.publicKey.toBase58(), baseUnits:String(row.amount) })) }));
if (!execute) process.exit(0);
for (const plan of plans) {
  const fromBefore = await balance(plan.source.wallet.publicKey);
  const toBefore = await balance(plan.target.wallet.publicKey);
  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(plan.source.wallet.publicKey, ata(plan.target.wallet.publicKey), plan.target.wallet.publicKey, mint),
    createTransferCheckedInstruction(ata(plan.source.wallet.publicKey), mint, ata(plan.target.wallet.publicKey), plan.source.wallet.publicKey, plan.amount, initialMint.decimals),
  );
  const signature = await sendAndConfirmTransaction(connection, transaction, [plan.source.wallet], { commitment:'finalized', preflightCommitment:'confirmed' });
  await finalized(signature);
  assert.equal(fromBefore - await balance(plan.source.wallet.publicKey), plan.amount, 'Source delta mismatch.');
  assert.equal(await balance(plan.target.wallet.publicKey) - toBefore, plan.amount, 'Target delta mismatch.');
  console.log(JSON.stringify({ status:'verified', stage:'transfer', signature, sourceRole:plan.source.role,
    targetRole:plan.target.role, baseUnits:String(plan.amount) }));
}
assert((await balance(creator.publicKey)) >= desired, 'Creator still lacks 25,000 $FUNDED.');
assert((await balance(claimant.publicKey)) >= desired, 'Claimant still lacks 25,000 $FUNDED.');
assert.equal((await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID)).supply, initialMint.supply, 'Transfers changed mint supply.');
console.log(JSON.stringify({ status:'verified', stage:'complete', creator:creator.publicKey.toBase58(), claimant:claimant.publicKey.toBase58(),
  creatorBaseUnits:String(await balance(creator.publicKey)), claimantBaseUnits:String(await balance(claimant.publicKey)), mintSupplyUnchanged:true }));
