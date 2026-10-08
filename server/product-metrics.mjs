import { createHash } from 'node:crypto';
import pg from 'pg';
import { pgPoolConfig } from './db-config.mjs';
import { PRODUCT_EVENTS } from '../product-events.js';
import { analyticsReceiptTotals } from './analytics-summary.mjs';
import { readJsonBody } from './request-body.mjs';

export function journeyEvent(input, cluster, now = new Date()) {
  if (!input || Object.keys(input).sort().join(',') !== 'consent,event,session' || input.consent !== true
    || !PRODUCT_EVENTS.has(input.event) || typeof input.session !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.session)
    || !['devnet','mainnet-beta'].includes(cluster)) throw Object.assign(new Error('Invalid anonymous journey event.'), {statusCode:400});
  const day = now.toISOString().slice(0,10);
  return {cluster, day, event:input.event, sessionHash:createHash('sha256').update(`${cluster}:${day}:${input.session}`).digest('hex')};
}

export function createProductMetricsStore(databaseUrl, injectedPool) {
  const pool = injectedPool || (databaseUrl ? new pg.Pool({...pgPoolConfig(databaseUrl), max:2, statement_timeout:5000}) : null);
  let lastPrune = 0;
  async function prune() {
    if (Date.now() - lastPrune < 60000) return;
    await pool.query("DELETE FROM product_journey_events WHERE day < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 29");
    lastPrune = Date.now();
  }
  const retentionTimer = pool ? setInterval(() => { void prune().catch(() => { console.error('Journey retention maintenance failed.'); }); }, 3600000) : null;
  retentionTimer?.unref();
  return {
    enabled:Boolean(pool),
    async record(row) {
      await prune();
      const result = await pool.query('INSERT INTO product_journey_events(cluster,day,session_hash,event) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [row.cluster,row.day,row.sessionHash,row.event]);
      return result.rowCount === 1;
    },
    async report(cluster) {
      await prune();
      const result = await pool.query(`SELECT day::text, event, count(*)::int AS sessions FROM product_journey_events
        WHERE cluster=$1 AND day >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 29 GROUP BY day,event ORDER BY day,event`, [cluster]);
      const sessions = await pool.query(`SELECT day::text, count(DISTINCT session_hash)::int AS sessions FROM product_journey_events
        WHERE cluster=$1 AND day >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 29 GROUP BY day ORDER BY day`, [cluster]);
      return {scope:'opted-in-browser-session-days', evidence:'browser-reported-not-onchain-proof', retentionDays:30,
        uniquePeople:null, crossDayRetention:null, dailySessions:sessions.rows, dailyEvents:result.rows};
    },
    async close() { clearInterval(retentionTimer); await pool?.end(); },
  };
}

export function confirmedProductTotals(state, evidence, cluster) {
  const fees = analyticsReceiptTotals(state, evidence, cluster);
  const signatures = new Set(), quotes = new Set();
  let boostLamports = 0n;
  for (const row of Object.values(state.boostReceipts || {})) {
    const quote = state.boostQuotes?.[row.quoteId];
    if (row.cluster !== cluster || row.status !== 'finalized' || !Number.isSafeInteger(row.slot) || row.slot < 1
      || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature || '') || !Number.isSafeInteger(row.lamports) || row.lamports <= 0
      || !quote || quote.id !== row.quoteId || ['mint','payer','recipient','packageId','cluster','lamports'].some(key => row[key] !== quote[key])
      || signatures.has(row.signature) || quotes.has(row.quoteId)) continue;
    signatures.add(row.signature); quotes.add(row.quoteId); boostLamports += BigInt(row.lamports);
  }
  const feesAvailable = ['indexed','partial','no-records'].includes(fees.status);
  return {scope:'stored-verified-registry-and-receipts', cluster,
    registeredLaunches:new Set(Object.values(state.launches || {}).filter(row => row.cluster === cluster && row.onchainVerified === true && row.mint).map(row => row.mint)).size,
    boostScope:'all-stored-finalized-receipts', boostPurchases:signatures.size, boostPaidLamports:boostLamports.toString(),
    feeReceiptStatus:fees.status, feeReceiptScope:fees.receiptScope, feeEvidenceAt:evidence?.generatedAt || null,
    collectedFeeLamports:feesAvailable ? fees.exactLamports.collectedLamports : null,
    finalizedPayoutLamports:feesAvailable ? fees.exactLamports.finalizedPaidLamports : null,
    tradingVolumeLamports:null, tradingVolumeStatus:'unavailable-without-a-complete-trade-index',
    monetaryValue:cluster === 'devnet' ? 'Devnet test SOL has no monetary value.' : 'Amounts are SOL base units; not USD.'};
}

export function createProductMetricsHandler({metrics, cluster, origin, authorized, charge, confirmedTotals}) {
  const enabled = metrics.enabled && Boolean(origin);
  const reply = (res, status, data) => { res.writeHead(status, {'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify(data)); };
  return async (req,res,url) => {
    if (!['/api/product-events','/api/product-events/config','/api/product-metrics'].includes(url.pathname)) return false;
    if (req.method === 'GET' && url.pathname === '/api/product-events/config') { reply(res,200,{enabled,retentionDays:30}); return true; }
    if (req.method === 'GET' && url.pathname === '/api/product-metrics') {
      if (!authorized(req)) {reply(res,401,{error:'Operator authorization required.'});return true;}
      if (!enabled) {reply(res,503,{error:'Journey measurement is unavailable.'});return true;}
      const [journeys,confirmed] = await Promise.all([metrics.report(cluster),confirmedTotals()]);
      reply(res,200,{schemaVersion:1,generatedAt:new Date().toISOString(),cluster,journeys,confirmed});return true;
    }
    if (req.method !== 'POST' || url.pathname !== '/api/product-events') {reply(res,405,{error:'Method not allowed.'});return true;}
    if (!enabled) {reply(res,503,{error:'Journey measurement is unavailable.'});return true;}
    if (req.headers.origin !== origin) {reply(res,403,{error:'Use the configured app origin.'});return true;}
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {reply(res,415,{error:'JSON required.'});return true;}
    if (!await charge(req)) {reply(res,429,{error:'Too many events. Try later.'});return true;}
    const row = journeyEvent(await readJsonBody(req,{maxBytes:512}),cluster);
    await metrics.record(row);
    reply(res,202,{accepted:true});return true;
  };
}
