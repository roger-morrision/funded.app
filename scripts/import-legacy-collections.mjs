import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Connection, PublicKey } from '@solana/web3.js';
import { createPostgresStore } from '../server/postgres-store.mjs';

const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported. Omit it for a read-only dry run.');
if (!process.env.DATABASE_URL || !process.env.SOLANA_RPC_URL) throw new Error('DATABASE_URL and SOLANA_RPC_URL are required.');
if (process.env.FUNDED_STORE_PATH) throw new Error('Refusing to import while FUNDED_STORE_PATH is set.');
const cluster = process.env.SOLANA_CLUSTER || process.env.VITE_SOLANA_CLUSTER || 'devnet';
if (cluster !== 'devnet') throw new Error('Legacy collections can only be imported into the Devnet profile.');

const legacy = JSON.parse(await readFile(resolve(process.cwd(), 'data', 'funded-store.json'), 'utf8'));
const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
const verified = [];
for (const item of Object.values(legacy.collections || {})) {
  if (item.cluster !== cluster || item.status !== 'collected' || item.id !== item.signature) throw new Error('Unexpected legacy collection format.');
  const router = new PublicKey(item.router).toBase58();
  const requestedMint = new PublicKey(item.mint).toBase58();
  const transaction = await connection.getTransaction(item.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!transaction || transaction.meta?.err !== null) throw new Error(`Unconfirmed or failed transaction: ${item.signature}`);
  const keys = transaction.transaction.message.accountKeys.map(key => key.toBase58());
  const routerIndex = keys.indexOf(router);
  if (routerIndex < 0) throw new Error(`Router missing from transaction: ${item.signature}`);
  const beforeLamports = transaction.meta.preBalances[routerIndex];
  const afterLamports = transaction.meta.postBalances[routerIndex];
  const collectedLamports = afterLamports - beforeLamports;
  if (beforeLamports !== item.beforeLamports || afterLamports !== item.afterLamports || collectedLamports !== item.collectedLamports || collectedLamports < 0) {
    throw new Error(`Router balance proof does not match legacy record: ${item.signature}`);
  }
  if (!transaction.meta.logMessages?.some(log => /Instruction: Collect(?:Coin)?CreatorFee/.test(log))) {
    throw new Error(`Pump fee-collection instruction missing: ${item.signature}`);
  }
  verified.push({ id: item.id, signature: item.signature, mint: null, requestedMint, attribution: 'router', router, beforeLamports, afterLamports, collectedLamports, cluster, status: collectedLamports > 0 ? 'collected' : 'no-fees', recordedAt: item.recordedAt });
}

const store = createPostgresStore(process.env.DATABASE_URL);
try {
  const current = await store.read();
  const pending = verified.filter(item => !current.collections[item.id]);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', verified: verified.length, positive: verified.filter(item => item.collectedLamports > 0).length, noFees: verified.filter(item => item.collectedLamports === 0).length, pending: pending.length }));
  if (apply && pending.length) {
    const imported = await store.update(state => {
      let count = 0;
      for (const item of pending) {
        if (state.collections[item.id]) continue;
        state.collections[item.id] = item;
        count += 1;
      }
      return count;
    });
    console.log(JSON.stringify({ imported }));
  }
} finally {
  await store.close();
}
