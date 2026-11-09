// Provider bodies can contain HTML, endpoint credentials, or internal details.
// Show actionable messages without forwarding upstream text into the interface.
function unavailableMessage(error, subject) {
  const detail = String(error?.message || error || '');
  if (error?.code === 4001 || /user rejected|user denied/i.test(detail))
    return 'Wallet approval was cancelled.';
  if (/\b429\b|rate limit|too many requests|max usage reached/i.test(detail))
    return `${subject} is temporarily unavailable because Solana RPC is rate limited. Try again shortly.`;
  if (/\b50[0234]\b|failed to fetch|networkerror|econnrefused|timed out|timeout|<!doctype|<html/i.test(detail))
    return `${subject} is temporarily unavailable. The Solana connection could not be verified. Try again shortly.`;
  return null;
}

export function fundedBuyFailureMessage(error, phase = 'preview') {
  const detail = String(error?.message || '');
  if (/invalid trade (transaction|signature)|changed the reviewed trade|returned a different transaction/i.test(detail))
    return 'The wallet response did not match the reviewed transaction. Nothing was submitted. Reconnect your wallet and preview again.';
  if (/insufficient (funds|lamports|SOL)|debit an account but found no record/i.test(detail))
    return 'Not enough Devnet SOL for the buy, fees and account rent. Add Devnet SOL to this wallet, then preview again.';
  if (/transaction expired|blockhash not found|block height exceeded/i.test(detail))
    return 'The transaction expired before completion. Check any submitted signature before previewing again.';
  if (/service fees.*unavailable/i.test(detail))
    return 'Current app fees could not be verified. Refresh and preview again before signing.';
  return unavailableMessage(error,phase === 'preview' ? 'Buy preview' : 'Buy') || (phase === 'preview'
    ? 'Buy preview is unavailable because the $RICH market could not be verified. Try again shortly.'
    : 'Buy could not be completed. Refresh the quote and try again.');
}

export function fundedBurnFailureMessage(error) {
  return unavailableMessage(error,'Burn verification') || 'Burn data could not be verified. Try again shortly.';
}
