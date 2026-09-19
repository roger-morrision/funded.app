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

console.log(`devnet payer: ${payer.publicKey.toBase58()}`);
let airdropSignature;
try {
  airdropSignature = await requestAirdropOnce(payer.publicKey, 1_000_000_000);
} catch (error) {
  if (String(error?.message).includes('429')) {
    console.error('Devnet faucet quota is exhausted. Fund this temporary payer from https://faucet.solana.com, then rerun npm run verify:devnet. No private key was written or printed.');
    process.exit(2);
  }
  throw error;
}
await connection.confirmTransaction(airdropSignature, 'confirmed');
console.log(`airdrop confirmed: ${devnetExplorer(`tx/${airdropSignature}`)}`);

const plan = await buildLaunchTransaction({ connection, payer: payer.publicKey, supply: input.supply, decimals: input.decimals });
const latest = await connection.getLatestBlockhash('confirmed');
plan.transaction.recentBlockhash = latest.blockhash;
plan.transaction.feePayer = payer.publicKey;
plan.transaction.partialSign(plan.mint, payer);
const signature = await connection.sendRawTransaction(plan.transaction.serialize(), { skipPreflight: false });
await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');

const mint = await getMint(connection, plan.mint.publicKey);
const account = await getAccount(connection, plan.ata);
assert.equal(mint.decimals, input.decimals);
assert.equal(mint.supply, plan.amount);
assert.equal(account.amount, plan.amount);
assert.equal(account.owner.toBase58(), payer.publicKey.toBase58());
console.log(`launch confirmed: ${devnetExplorer(`tx/${signature}`)}`);
console.log(`mint verified: ${devnetExplorer(`address/${plan.mint.publicKey.toBase58()}`)}`);
console.log('devnet launch verification passed');
