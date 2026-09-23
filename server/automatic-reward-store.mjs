import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Dedicated ledger; existing immutable launches are never rewritten. A crashed
// lock needs operator investigation rather than unsafe automatic lock expiration.
export function createAutomaticRewardStore(path) {
  async function readState() {
    try {
      const state = JSON.parse(await readFile(path, 'utf8'));
      if (![1, 2].includes(state.version)) throw new Error('Unsupported ledger version.');
      return state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { version: 2, obligations: {}, batches: {}, programs: {}, schedules: {}, holderSnapshots: {}, rewardPools: {}, buyOrders: {}, fundingRequests: {} };
    }
  }
  return { async read() { return structuredClone(await readState()); }, async transaction(mutator) {
    await mkdir(dirname(path), { recursive: true });
    const lock = await open(`${path}.lock`, 'wx');
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      const state = await readState();
      if (![1, 2].includes(state.version)) throw new Error('Unsupported ledger version.');
      if (state.version === 1) state.version = 2;
      const result = await mutator(state);
      const file = await open(temp, 'wx');
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(temp, path);
      return result;
    } finally {
      try { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      finally { await lock.close(); await unlink(`${path}.lock`); }
    }
  } };
}
