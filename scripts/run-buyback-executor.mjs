import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { createStore } from '../server/store.mjs';
import { createDevnetBuybackExecutor } from '../server/buyback-executor.mjs';

function config(name) {
  const path = process.env[`${name}_FILE`];
  return String(process.env[name] || (path ? readFileSync(path, 'utf8') : '')).trim();
}

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const mintIndex = args.indexOf('--mint');
const selectedMint = mintIndex >= 0 ? args[mintIndex + 1] : null;
if (mintIndex >= 0 && !selectedMint) throw new Error('--mint requires a Devnet launch mint.');
const authoritySecret = config('FUNDED_ROUTER_AUTHORITY_SECRET_KEY');
const authority = authoritySecret ? Keypair.fromSecretKey(bs58.decode(authoritySecret)) : null;
if (!authority) throw new Error('Devnet router authority is not configured.');
if (config('FUNDED_REWARD_AUTHORITY') !== authority.publicKey.toBase58()) throw new Error('Router authority differs from the configured reward authority.');
const operatorSecret = config('FUNDED_BUYBACK_OPERATOR_SECRET_KEY');
const operator = operatorSecret ? Keypair.fromSecretKey(bs58.decode(operatorSecret)) : null;
if (!operator || operator.publicKey.equals(authority.publicKey)) throw new Error('A separate Devnet buyback operator is required.');
const store = createStore(process.env.FUNDED_STORE_PATH, config('DATABASE_URL'));
const executor = createDevnetBuybackExecutor({
  store,
  rpcUrl: config('SOLANA_RPC_URL'),
  programId: config('FUNDED_FEE_ROUTER_PROGRAM_ID'),
  programDataSha256: config('FUNDED_REWARD_PROGRAM_DATA_SHA256'),
  fundedMint: config('FUNDED_TOKEN_MINT'),
  poolAddress: config('FUNDED_SWAP_POOL'),
  authority,
  operator,
  lookupTableAddress: config('FUNDED_BUYBACK_LOOKUP_TABLE'),
  feeOwner: config('FUNDED_TRADE_FEE_OWNER'),
  feeBps: Number(config('FUNDED_TRADE_FEE_BPS') || '50'),
  enabled: config('FUNDED_BUYBACK_EXECUTOR_ENABLED') === 'true' && config('SOLANA_CLUSTER') === 'devnet',
});

async function tick() {
  const status = await executor.status();
  if (!status.enabled) throw new Error('Devnet buyback executor is disabled.');
  const refundPending = Object.values((await store.read()).buybackOrders || {}).filter(row => ['burn-finalized-refund-pending','finalized'].includes(row.status) && !row.refundVerified);
  for (const order of refundPending) {
    try {
      const result = await executor.refundUnspent(order);
      console.log(JSON.stringify({ mint:order.mint, id:order.id, status:result.status, returnedLamports:result.returnedLamports || null, refundSignature:result.refundSignature || null }));
    } catch (error) {
      console.error(JSON.stringify({ mint:order.mint, status:'refund-blocked', reason:String(error.message || error).slice(0,300) }));
      if (!watch) process.exitCode = 1;
    }
  }
  const refreshed = await executor.status();
  const selected = refreshed.pending.filter(row => (!selectedMint || row.mint === selectedMint) && (row.eligible || row.activeOrder));
  for (const row of selected) {
    try {
      const result = await executor.execute(row.mint);
      console.log(JSON.stringify({ mint: row.mint, id: result.id, status: result.status, signature: result.signature, reason: result.reason || null }));
    } catch (error) {
      console.error(JSON.stringify({ mint: row.mint, status: 'blocked', reason: String(error.message || error).slice(0, 300) }));
      if (!watch) process.exitCode = 1;
    }
  }
  if (!selected.length && !watch) console.log(JSON.stringify({ status: 'no-eligible-buybacks', pending: refreshed.pending.map(row => ({ mint: row.mint, pendingLamports: row.pendingLamports, reason: row.reason })) }));
}

await tick();
if (watch) setInterval(() => tick().catch(error => console.error(String(error.message || error))), Math.max(60_000, Number(process.env.FUNDED_BUYBACK_TICK_MS || 300_000)));
