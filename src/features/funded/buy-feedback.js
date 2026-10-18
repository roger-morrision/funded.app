// Provider bodies can contain HTML, endpoint credentials, or internal details.
// Show actionable messages without forwarding upstream text into the interface.
export function fundedBuyFailureMessage(error, phase = 'preview') {
  const detail = String(error?.message || error || '');
  const subject = phase === 'preview' ? 'Buy preview' : 'Buy';
  if (error?.code === 4001 || /user rejected|user denied/i.test(detail))
    return 'Wallet approval was cancelled.';
  if (/\b429\b|rate limit|too many requests|max usage reached/i.test(detail))
    return `${subject} is temporarily unavailable because Solana RPC is rate limited. Try again shortly.`;
  if (/\b50[0234]\b|failed to fetch|networkerror|econnrefused|timed out|timeout|<!doctype|<html/i.test(detail))
    return `${subject} is temporarily unavailable. The Solana connection could not be verified. Try again shortly.`;
  return phase === 'preview'
    ? 'Buy preview is unavailable because the pool could not be verified. Try again shortly.'
    : 'Buy could not be completed. Refresh the quote and try again.';
}
