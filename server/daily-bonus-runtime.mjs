import { Connection } from '@solana/web3.js';
import { DAILY_BONUS_POLICY } from '../config/daily-bonus.js';
import { createDailyBonusService } from './daily-bonus-service.mjs';
import { latestBonusDay } from './daily-bonus.mjs';

export function createDailyBonusRuntime({ store, rewardStore, solanaCluster, solanaRpcUrl,
  v3AuthorityKeypair, env = process.env, logger = console }) {
  let service, unavailable = 'Daily bonus requires a configured reviewed Devnet V3 program and authority.';
  try {
    if (solanaCluster === 'devnet' && env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID
      && /^[a-f0-9]{64}$/i.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || ''))) {
      service = createDailyBonusService({ store, rewardStore,
        connection:new Connection(solanaRpcUrl, 'finalized'), cluster:solanaCluster,
        programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID, authority:v3AuthorityKeypair(),
        expectedProgramDataSha256:env.FUNDED_V3_PROGRAM_DATA_SHA256,
        payoutEnabled:env.FUNDED_DAILY_BONUS_PAYOUT_ENABLED === 'true' });
    }
  } catch { service = null; }
  let running = false;
  async function tick() {
    if (!service || running) return;
    running = true;
    try {
      const day = latestBonusDay();
      const app = await store.read();
      if (!Object.values(app.launches || {}).some(row => row.cluster === 'devnet' && row.onchainVerified === true
        && row.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version === 1)) {
        await rewardStore.transaction(state => { state.dailyBonusServiceStatus = { status:'waiting-for-eligible-launch', checkedAt:new Date().toISOString() }; });
        return;
      }
      const saved = (await rewardStore.read()).dailyBonusSnapshots?.[day];
      if (!saved) await service.capture(day);
      if (env.FUNDED_DAILY_BONUS_PAYOUT_ENABLED === 'true') {
        const status = await service.status();
        for (const row of status.snapshots.filter(row => row.status !== 'reconciliation-required'
          && row.sources.some(source => !['paid', 'no-eligible-winners'].includes(source.status))).slice(0, 3))
          await service.execute(row.day);
      }
      await rewardStore.transaction(state => { state.dailyBonusServiceStatus = { status:'active', checkedAt:new Date().toISOString() }; });
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
      if (req.method === 'GET' && url.pathname === '/api/daily-bonus') {
        const health = (await rewardStore.read()).dailyBonusServiceStatus || { status:'not-started' };
        respond(res, 200, service ? { ...await service.status(), worker:health, snapshotEnabled:env.FUNDED_DAILY_BONUS_ENABLED === 'true' }
          : { cluster:solanaCluster, policy:DAILY_BONUS_POLICY, snapshots:[], payoutEnabled:false, snapshotEnabled:false,
            worker:{ status:'unavailable', reason:unavailable } });
        return true;
      }
      if (req.method === 'POST' && ['/api/daily-bonus/snapshot', '/api/daily-bonus/execute'].includes(url.pathname)) {
        if (!requireAuthorized(req, res)) return true;
        if (!service) { respond(res, 503, { error:unavailable }); return true; }
        const input = await body(req);
        try {
          const value = url.pathname.endsWith('/snapshot') ? await service.capture(input?.day)
            : await service.execute(input?.day);
          respond(res, 200, value);
        } catch (error) { respond(res, 409, { error:String(error.message || error) }); }
        return true;
      }
      return false;
    },
    start() {
      if (!service || env.FUNDED_DAILY_BONUS_ENABLED !== 'true') return false;
      const run = () => { void tick().catch(error => logger.error(JSON.stringify({ event:'daily_bonus_storage_failed', reason:String(error.message || error).slice(0, 180) }))); };
      setTimeout(run, 15_000).unref();
      setInterval(run, 5 * 60_000).unref();
      return true;
    },
  };
}
