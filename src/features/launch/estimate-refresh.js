import { launchReviewNeedsRefresh } from '../../../launch-review.js';

export function launchEstimateRetry(error, previous = {}, now = Date.now()) {
  const message = String(error?.message || error || '');
  const retryable = /\b(?:429|502|503|504)\b|rate limit|too many requests|timed? ?out|timeout|failed to fetch|fetch failed|network.*(?:error|failed)|ECONN|BlockhashNotFound|blockhash not found|estimate took too long|RPC.*unavailable/i.test(message);
  if (!retryable) return { attempts: 0, nextAt: 0, retryable: false };
  const attempts = (previous.attempts || 0) + 1;
  const header = error?.response?.headers?.get?.('retry-after');
  const retryAfter = header == null ? 0 : Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - now;
  const delay = Math.max(Math.min(15_000 * 2 ** Math.min(attempts - 1, 3), 120_000),
    Number(error?.retryAfterMs) || 0, Number.isFinite(retryAfter) ? retryAfter : 0);
  return { attempts, nextAt: now + delay, retryable: true };
}

export function shouldAutoRefreshLaunchEstimate({ active, visible, online, wallet, loading, reviewing, submitting,
  validForm, review, error, retry }, now = Date.now()) {
  if (!active || !visible || !online || !wallet || loading || reviewing || submitting || !validForm) return false;
  if (retry?.retryable && now < retry.nextAt) return false;
  if (review) return launchReviewNeedsRefresh(review, now);
  return !error || retry?.retryable === true;
}

export function launchEstimateRefreshMessage({ wallet, loading, retry }, now = Date.now()) {
  if (!wallet) return 'Connect a wallet to calculate the launch estimate.';
  if (loading) return 'Refreshing the launch estimate automatically…';
  if (retry?.retryable) return `Estimate will refresh automatically in ${Math.max(0, Math.ceil((retry.nextAt - now) / 1000))}s while this page is active.`;
  return '';
}
