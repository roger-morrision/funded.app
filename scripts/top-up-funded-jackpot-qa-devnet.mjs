import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAccount, getAssociatedTokenAddressSync,
  getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false');
assert.equal(process.env.DEVNET_TEST_MODE, 'true');
const manifest = JSON.parse(readFileSync('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
const address = role => new PublicKey(manifest.find(row =>
  row.role === role && row.cluster === 'devnet')?.address);
const source = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY || ''));
assert(source.publicKey.equals(address('referrer')), 'Only the rotated Devnet QA referrer can fund this check.');
const connection = new Connection('https://api.devnet.solana.com', 'finalized');
assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
const mint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
const mintBefore = await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID);
assert.equal(mintBefore.mintAuthority, null, 'The test $FUNDED mint must have revoked mint authority.');
const scale = 10n ** BigInt(mintBefore.decimals);
const sourceAta = getAssociatedTokenAddressSync(mint, source.publicKey);
const sourceBefore = await getAccount(connection, sourceAta, 'finalized', TOKEN_PROGRAM_ID);
assert(sourceBefore.owner.equals(source.publicKey) && sourceBefore.mint.equals(mint));
const plans = [];
for (const [role, desiredTokens] of [['creator', 1_000n], ['claimant', 1_100n]]) {
  const wallet = address(role);
  const ata = getAssociatedTokenAddressSync(mint, wallet);
  const before = await getAccount(connection, ata, 'finalized', TOKEN_PROGRAM_ID);
  assert(before.owner.equals(wallet) && before.mint.equals(mint), `${role} token account mismatch.`);
  const desired = desiredTokens * scale;
  const amount = before.amount < desired ? desired - before.amount : 0n;
  plans.push({ role, wallet, ata, before:before.amount, amount, desiredTokens });
}
const total = plans.reduce((sum, plan) => sum + plan.amount, 0n);
assert(sourceBefore.amount >= total, 'QA referrer lacks $FUNDED for the planned top-ups.');
assert(await connection.getBalance(source.publicKey, 'finalized') > 100_000_000,
  'Keep at least 0.1 Devnet SOL in the QA referrer for future test fees.');
const preview = { mode:process.argv.includes('--execute') ? 'execute' : 'read-only',
  cluster:'devnet', mint:mint.toBase58(), source:source.publicKey.toBase58(),
  sourceBalanceBaseUnits:String(sourceBefore.amount), totalBaseUnits:String(total),
  targets:plans.map(plan => ({ role:plan.role, wallet:plan.wallet.toBase58(),
    beforeBaseUnits:String(plan.before), topUpBaseUnits:String(plan.amount),
    desiredTokens:String(plan.desiredTokens) })) };
console.log(JSON.stringify(preview));
if (!process.argv.includes('--execute') || total === 0n) process.exit(0);
const latest = await connection.getLatestBlockhash('finalized');
const transaction = new Transaction({ recentBlockhash:latest.blockhash,
  feePayer:source.publicKey });
for (const plan of plans) if (plan.amount > 0n) transaction.add(
  createTransferCheckedInstruction(sourceAta, mint, plan.ata,
    source.publicKey, plan.amount, mintBefore.decimals));
transaction.sign(source);
const signature = bs58.encode(transaction.signature);
try { await connection.sendRawTransaction(transaction.serialize()); }
catch (error) { console.error(`Submission outcome uncertain for ${signature}: ${error.message}. Reconciling without resending.`); }
for (;;) {
  let finalized; let status; let height;
  try {
    [finalized, status, height] = await Promise.all([
      connection.getParsedTransaction(signature,
        { commitment:'finalized', maxSupportedTransactionVersion:0 }),
      connection.getSignatureStatuses([signature], { searchTransactionHistory:true })
        .then(result => result.value[0]),
      connection.getBlockHeight('finalized'),
    ]);
  } catch (error) {
    console.error(`RPC reconciliation pending for ${signature}: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 2_000));
    continue;
  }
  if (finalized?.meta?.err || status?.err) throw new Error(`$FUNDED top-up ${signature} failed on Devnet.`);
  if (finalized) break;
  if (height > latest.lastValidBlockHeight && !status)
    throw new Error(`$FUNDED top-up ${signature} expired without a confirmed signature.`);
  await new Promise(resolve => setTimeout(resolve, 2_000));
}
const sourceAfter = await getAccount(connection, sourceAta, 'finalized', TOKEN_PROGRAM_ID);
assert.equal(sourceBefore.amount - sourceAfter.amount, total, 'Source $FUNDED balance delta mismatch.');
for (const plan of plans) {
  const after = await getAccount(connection, plan.ata, 'finalized', TOKEN_PROGRAM_ID);
  assert.equal(after.amount - plan.before, plan.amount, `${plan.role} $FUNDED balance delta mismatch.`);
}
assert.equal((await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID)).supply,
  mintBefore.supply, '$FUNDED transfer changed mint supply.');
console.log(JSON.stringify({ status:'finalized-devnet-funded-transfer', signature,
  mint:mint.toBase58(), source:source.publicKey.toBase58(),
  transferredBaseUnits:String(total), targets:plans.map(plan => ({
    role:plan.role, wallet:plan.wallet.toBase58(), amountBaseUnits:String(plan.amount) })) }));
