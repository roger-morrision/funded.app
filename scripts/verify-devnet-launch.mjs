import assert from 'node:assert/strict';
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
import { getAccount, getMint } from '@solana/spl-token';
import { buildLaunchTransaction, normalizeLaunchInput, devnetExplorer } from '../launch-core.js';

const devnetRpcUrl = clusterApiUrl('devnet');
const connection = new Connection(devnetRpcUrl, 'confirmed');

async function requestAirdropOnce(publicKey, lamports) {
  const response = await fetch(devnetRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [publicKey.toBase58(), lamports] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Devnet faucet request failed (${response.status}).`);
  return payload.result;
}
const payer = Keypair.generate();
const input = normalizeLaunchInput({ name: 'Funded Verify', symbol: 'FVERIFY', supply: 1000, decimals: 6 });

let airdropSignature;
try {
  airdropSignature = await requestAirdropOnce(payer.publicKey, 1_000_000_000);
} catch (error) {
  if (/\b429\b|quota|faucet is closed/i.test(String(error?.message || ''))) {
    console.error('Devnet faucet is unavailable. Rerun verification when the faucet is available; each run uses a new in-memory payer. No private key was written or printed.');
    process.exit(2);
  }
  throw error;
}
const airdropConfirmation = await connection.confirmTransaction(airdropSignature, 'confirmed');
assert.equal(airdropConfirmation.value.err, null, 'Devnet airdrop transaction failed');
assert.ok(await connection.getBalance(payer.publicKey, 'confirmed') >= 1_000_000_000, 'Devnet payer was not funded');
console.log(`devnet payer: ${payer.publicKey.toBase58()}`);
console.log(`airdrop confirmed: ${devnetExplorer(`tx/${airdropSignature}`)}`);

const plan = await buildLaunchTransaction({ connection, payer: payer.publicKey, supply: input.supply, decimals: input.decimals });
const latest = await connection.getLatestBlockhash('confirmed');
plan.transaction.recentBlockhash = latest.blockhash;
plan.transaction.feePayer = payer.publicKey;
plan.transaction.partialSign(plan.mint, payer);
const signature = await connection.sendRawTransaction(plan.transaction.serialize(), { skipPreflight: false });
const launchConfirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
assert.equal(launchConfirmation.value.err, null, 'Devnet launch transaction failed');

const mint = await getMint(connection, plan.mint.publicKey);
const account = await getAccount(connection, plan.ata);
assert.equal(mint.decimals, input.decimals);
assert.equal(mint.supply, plan.amount);
assert.equal(account.amount, plan.amount);
assert.equal(account.owner.toBase58(), payer.publicKey.toBase58());
console.log(`launch confirmed: ${devnetExplorer(`tx/${signature}`)}`);
console.log(`mint verified: ${devnetExplorer(`address/${plan.mint.publicKey.toBase58()}`)}`);
console.log('devnet launch verification passed');
