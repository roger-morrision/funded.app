import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
if (args.some((arg, index) => arg.startsWith('--') && !['--mints-file', '--ledger', '--apply'].includes(arg))
  || !value('--mints-file') || !value('--ledger') || args.includes('--apply') && args.at(-1) !== '--apply') {
  throw new Error('Usage: node scripts/retire-v2-devnet-ledger.mjs --mints-file <path> --ledger <path> [--apply]');
}
const apply = args.includes('--apply');
const ledgerPath = resolve(value('--ledger'));
const mints = JSON.parse(await readFile(resolve(value('--mints-file')), 'utf8'));
if (!Array.isArray(mints) || mints.length !== 13 || new Set(mints).size !== 13
  || mints.some(mint => typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))) {
  throw new Error('The inventoried 13 funded.vip V2 Devnet mint addresses are required.');
}
const retired = new Set(mints);
const state = JSON.parse(await readFile(ledgerPath, 'utf8'));
if (![1, 2].includes(state.version)) throw new Error('Unsupported reward-ledger version.');
const expected = { obligations:0, batches:0, programs:1, schedules:4,
  holderSnapshots:1, rewardPools:1, buyOrders:0, fundingRequests:43 };
const counts = {};
for (const [bucket, count] of Object.entries(expected)) {
  const rows = state[bucket];
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) throw new Error(`Missing ${bucket} ledger bucket.`);
  const matches = Object.entries(rows).filter(([key, row]) => retired.has(row?.mint)
    || mints.some(mint => key.includes(mint)));
  counts[bucket] = { total:Object.keys(rows).length, retired:matches.length };
  if (matches.length !== count || Object.keys(rows).length !== count) {
    throw new Error(`${bucket} inventory changed or contains unrelated rows; inspect before deletion.`);
  }
  for (const [key] of matches) delete rows[key];
}
if ((state.communityClaimIndex?.drops || []).length || (state.communityClaimIndex?.payments || []).length) {
  throw new Error('Community claim index contains entries requiring separate review.');
}
console.log(JSON.stringify({ mode:apply ? 'apply' : 'dry-run', counts }));
if (apply) {
  const temp = `${ledgerPath}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx');
    try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, ledgerPath);
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
