import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresStore } from './postgres-store.mjs';
import { coinFeeActivity, routerFeeActivity } from './fee-activity.mjs';

export function createStore(filePath = resolve(process.cwd(), 'data', 'funded-store.json'), databaseUrl = process.env.DATABASE_URL) {
  if (databaseUrl) return createPostgresStore(databaseUrl);
  let state = { version: 3, launches: {}, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {}, launchReviews: {}, alerts: {}, xIntake: {}, marketActivity: {}, referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} } };
  let loaded = false;
  let updateQueue = Promise.resolve();
  const rpcRates = new Map();

  async function load() {
    if (loaded) return state;
    try { state = { ...state, ...JSON.parse(await readFile(filePath, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    state.referralClaims ||= {};
    state.collections ||= {};
    state.launchReviews ||= {};
    state.alerts ||= {};
    state.xIntake ||= {};
    state.marketActivity ||= {};
    state.referrals ||= { codes: {}, wallets: {}, attributions: {}, challenges: {} };
    state.referrals.codes ||= {};
    state.referrals.wallets ||= {};
    state.referrals.attributions ||= {};
    state.referrals.challenges ||= {};
    state.version = Math.max(3, Number(state.version) || 1);
    loaded = true;
    return state;
  }

  async function save() {
    await mkdir(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
    await rename(temp, filePath);
  }

  return {
    async read() { return structuredClone(await load()); },
    async readCoinFeeActivity(mint, cluster) { const current = await load(); return coinFeeActivity(current.collections, current.settlements, mint, cluster); },
    async readRouterFeeActivity(router, cluster) { const current = await load(); return routerFeeActivity(current.collections, router, cluster); },
    async update(mutator) {
      const operation = updateQueue.then(async () => { await load(); const draft = structuredClone(state); const result = await mutator(draft); state = draft; await save(); return result; });
      updateQueue = operation.catch(() => {});
      return operation;
    },
    async readMarketActivity(mint, cluster) { return (await load()).marketActivity[`${cluster}:${mint}`] || null; },
    async writeMarketActivity(mint, cluster, data) { await this.update(current => { current.marketActivity[`${cluster}:${mint}`] = data; }); },
    async chargeRpcRate(clientKey, units, limit, windowStart) {
      for (const key of rpcRates.keys()) if (!key.endsWith(`:${windowStart}`)) rpcRates.delete(key);
      const key = `${clientKey}:${windowStart}`;
      const used = rpcRates.get(key) || 0;
      if (used + units > limit) return false;
      rpcRates.set(key, used + units);
      return true;
    },
    filePath,
  };
}
