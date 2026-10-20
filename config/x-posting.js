// Application policy, not an X-endorsed safe threshold. Payouts and agency
// promotion share one persisted account budget; no catch-up bursts on restart.
export const X_POSTING_DEFAULTS=Object.freeze({
  minIntervalMs:6*60*60*1000,maxHourlyPosts:1,maxDailyPosts:4,pollIntervalMs:5*60*1000,
  authCooldownMs:6*60*60*1000,rateLimitCooldownMs:15*60*1000,
});
export function xPostingRetryWait(error,baseMs){
  if([401,402,403].includes(error?.status))return Math.max(baseMs,X_POSTING_DEFAULTS.authCooldownMs);
  if(error?.status===429){
    const requested=Number.isSafeInteger(error.retryAfterMs)&&error.retryAfterMs>0?Math.min(error.retryAfterMs,86400000):0;
    return Math.max(baseMs,X_POSTING_DEFAULTS.rateLimitCooldownMs,requested);
  }
  return baseMs;
}
