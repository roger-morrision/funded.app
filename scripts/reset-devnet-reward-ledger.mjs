import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args[0] !== '--ledger' || !args[1]
  || args.length < 2 || args.length > 3
  || (args[2] && args[2] !== '--apply')) {
  throw new Error('Usage: node scripts/reset-devnet-reward-ledger.mjs --ledger <path> [--apply]');
}
const ledgerPath = resolve(args[1]);
const state = JSON.parse(await readFile(ledgerPath, 'utf8'));
if (![1, 2].includes(state.version)) throw new Error('Unsupported reward-ledger version.');
const buckets = ['obligations', 'batches', 'programs', 'schedules',
  'holderSnapshots', 'rewardPools', 'buyOrders', 'fundingRequests'];
const known = new Set(['version', 'serviceStatus', 'communityClaimIndex', ...buckets]);
if (Object.keys(state).some(key => !known.has(key))) {
  throw new Error('Reward-ledger schema changed; review the reset.');
}
const counts = Object.fromEntries(buckets.map(bucket => {
  const rows = state[bucket];
  if (!rows || Array.isArray(rows) || typeof rows !== 'object') {
    throw new Error(`Invalid reward-ledger bucket: ${bucket}`);
  }
  return [bucket, Object.keys(rows).length];
}));
if (Object.values(counts).some(Boolean)
  || (state.communityClaimIndex?.drops || []).length
  || (state.communityClaimIndex?.payments || []).length) {
  throw new Error('Uncleared reward obligations or claims require separate review.');
}
const empty = { version:2, ...Object.fromEntries(buckets.map(bucket => [bucket, {}])) };
console.log(JSON.stringify({ mode:args[2] === '--apply' ? 'apply' : 'dry-run', counts }));
if (args[2] === '--apply') {
  const temp = `${ledgerPath}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx');
    try { await file.writeFile(JSON.stringify(empty)); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, ledgerPath);
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
