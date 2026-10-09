import { buildRewardCycle, validateRewardConfig } from '../../reward-policy.js';
import { analyzeLaunchActivity } from '../../anti-sniper-policy.js';
import { immutableLaunchReview, normalizeXIntake } from '../../stonk-features.js';
import { validateInput } from '../http-policy.mjs';

// Preview and record handlers retain their slots after shared request policy.
export function createLaunchSupportRoutes({ store, body, id, respond }) {
  const json = (...args) => { respond(...args); return true; };
  async function handleLaunchPreview(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/rewards/preview') {
      const input = await body(req);
      const config = validateInput(() => validateRewardConfig(input));
      if (!config.valid) return json(res, 400, { error: 'Unsupported reward configuration.', config });
      return json(res, 200, validateInput(() => buildRewardCycle(input)));
    }
    if (req.method === 'POST' && url.pathname === '/api/anti-sniper/analyze') {
      const input = await body(req);
      return json(res, 200, analyzeLaunchActivity(input));
    }
    return false;
  }
  async function handleLaunchSupport(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/launch-reviews') {
      const input = await body(req);
      const review = validateInput(() => immutableLaunchReview(input));
      if (!review.mint || !review.creatorWallet) return json(res, 400, { error: 'mint and creatorWallet are required.' });
      const result = await store.update(state => { const existing = state.launchReviews[review.mint]; if (existing) return existing; state.launchReviews[review.mint] = review; return review; });
      return json(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/alerts') {
      const input = await body(req); const wallet = String(input.wallet || '').trim(); const mint = String(input.mint || '').trim(); const type = String(input.type || 'graduation').trim();
      if (!wallet || !mint || !['graduation', 'risk-change', 'volume-spike'].includes(type)) return json(res, 400, { error: 'wallet, mint, and a supported alert type are required.' });
      const alert = { id: id('alert'), wallet, mint, type, threshold: Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : null, status: 'active', createdAt: new Date().toISOString() };
      await store.update(state => { state.alerts[alert.id] = alert; return alert; }); return json(res, 201, alert);
    }
    if (req.method === 'POST' && url.pathname === '/api/x-intake') {
      const input = await body(req);
      const intake = validateInput(() => normalizeXIntake(input));
      const record = { id: id('x_intake'), ...intake };
      await store.update(state => { state.xIntake[record.id] = record; return record; });
      return json(res, 201, record);
    }

    return false;
  }
  return { handleLaunchPreview, handleLaunchSupport };
}
