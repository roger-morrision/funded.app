import { Connection } from '@solana/web3.js';
import { DAILY_BONUS_POLICY } from '../config/daily-bonus.js';
import { createDailyBonusService } from './daily-bonus-service.mjs';
import { dailyBonusWork } from './daily-bonus-queue.mjs';

export function createDailyBonusRuntime({ store, rewardStore, solanaCluster, solanaRpcUrl,
  v3AuthorityKeypair, env = process.env, logger = console,
  serviceFactory = createDailyBonusService, now = () => Math.floor(Date.now() / 1000) }) {
  let service, unavailable = 'Daily bonus requires a configured reviewed Devnet V3 program and authority.';
  try {
    if (solanaCluster === 'devnet' && env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID
      && /^[a-f0-9]{64}$/i.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || ''))) {
      service = serviceFactory({ store, rewardStore,
        connection:new Connection(solanaRpcUrl, 'finalized'), cluster:solanaCluster,
        programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID, authority:v3AuthorityKeypair(),
        expectedProgramDataSha256:env.FUNDED_V3_PROGRAM_DATA_SHA256,
        payoutEnabled:env.FUNDED_DAILY_BONUS_PAYOUT_ENABLED === 'true', now });
    }
  } catch { service = null; }
  let running = false;
  async function tick() {
    if (!service || running) return;
    running = true;
    try {
      const app = await store.read();
      let work = dailyBonusWork({ app, ledger:await rewardStore.read(), now:now() });
      if (!work.eligible) {
        await rewardStore.transaction(state => { state.dailyBonusServiceStatus = { status:'waiting-for-eligible-launch', checkedAt:new Date().toISOString() }; });
        return;
      }
      const failures = [];
      let indexing = false;
      let progressing = false;
      for (const day of work.missing) {
        try {
          const result = await service.capture(day); indexing ||= result.status === 'indexing';
          progressing ||= result.status === 'indexing' && (result.progress?.completedRoutes < result.progress?.routes
            || result.reason === 'Verifying finalized settlement coverage.');
        }
        catch (error) { failures.push({ day, reason:String(error.message || error).slice(0,180) }); }
        await rewardStore.transaction(state => { state.dailyBonusCaptureCursor = day; });
      }
      if (env.FUNDED_DAILY_BONUS_PAYOUT_ENABLED === 'true') {
        work = dailyBonusWork({ app, ledger:await rewardStore.read(), now:now() });
        for (const day of work.pending) {
          try { await service.execute(day); }
          catch (error) { failures.push({ day, reason:String(error.message || error).slice(0,180) }); }
          await rewardStore.transaction(state => { state.dailyBonusWorkCursor = day; });
        }
      }
      await rewardStore.transaction(state => { state.dailyBonusServiceStatus = {
        status:failures.length ? 'degraded' : indexing ? 'indexing' : 'active', failures,
        checkedAt:new Date(now() * 1000).toISOString() }; });
      return progressing;
    } catch (error) {
      const reason = String(error.message || error).slice(0, 180);
      await rewardStore.transaction(state => { state.dailyBonusServiceStatus = { status:'blocked', reason, checkedAt:new Date().toISOString() }; });
      logger.error(JSON.stringify({ event:'daily_bonus_blocked', reason }));
    } finally { running = false; }
  }
  return {
    async handle(req, res, url, { body, requireAuthorized, respond }) {
      if (!url.pathname.startsWith('/api/daily-bonus')) return false;
      res.setHeader('cache-control', 'no-store');
      if (req.method === 'GET' && url.pathname === '/api/daily-bonus/dashboard') {
        if (!service) { respond(res, 503, { error:unavailable }); return true; }
        try {
          const value = await service.dashboard({ category:url.searchParams.get('category') || 'all',
            page:Number(url.searchParams.get('page') || 1) });
          respond(res, 200, { ...value, snapshotEnabled:env.FUNDED_DAILY_BONUS_ENABLED === 'true',
            payoutEnabled:env.FUNDED_DAILY_BONUS_PAYOUT_ENABLED === 'true',
            worker:(await rewardStore.read()).dailyBonusServiceStatus || { status:'not-started' } });
        } catch (error) { respond(res, 400, { error:String(error.message || error) }); }
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/daily-bonus') {
        const health = (await rewardStore.read()).dailyBonusServiceStatus || { status:'not-started' };
        respond(res, 200, service ? { ...await service.status(), worker:health, snapshotEnabled:env.FUNDED_DAILY_BONUS_ENABLED === 'true' }
          : { cluster:solanaCluster, policy:DAILY_BONUS_POLICY, snapshots:[], payoutEnabled:false, snapshotEnabled:false,
            worker:{ status:'unavailable', reason:unavailable } });
        return true;
      }
      if (req.method === 'POST' && ['/api/daily-bonus/snapshot', '/api/daily-bonus/execute', '/api/daily-bonus/reconcile'].includes(url.pathname)) {
        if (!requireAuthorized(req, res)) return true;
        if (!service) { respond(res, 503, { error:unavailable }); return true; }
        const input = await body(req);
        try {
          const value = url.pathname.endsWith('/snapshot') ? await service.capture(input?.day)
            : url.pathname.endsWith('/reconcile') ? await service.reconcile(input?.day,{...input,actor:'api-token'})
              : await service.execute(input?.day);
          respond(res, 200, value);
        } catch (error) { respond(res, 409, { error:String(error.message || error) }); }
        return true;
      }
      return false;
    },
    tick,
    async operate(action, input, actor) {
      if (!service) throw new Error(unavailable);
      if (action === 'snapshot') return service.capture(input.day);
      if (action === 'review') return service.review(input.day,input.expectedHash);
      if (action === 'reconcile') return service.reconcile(input.day,{ ...input, actor });
      throw new Error('Unknown daily bonus operation.');
    },
    start() {
      if (!service || env.FUNDED_DAILY_BONUS_ENABLED !== 'true') return false;
      const run = async () => {
        let progressing = false;
        try { progressing = await tick(); }
        catch (error) { logger.error(JSON.stringify({ event:'daily_bonus_storage_failed', reason:String(error.message || error).slice(0,180) })); }
        setTimeout(run, progressing ? 10_000 : 5 * 60_000).unref();
      };
      setTimeout(run, 15_000).unref();
      return true;
    },
  };
}
