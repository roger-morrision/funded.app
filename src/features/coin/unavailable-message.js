// Product copy only. Upstream bodies, provider URLs and diagnostics are never copy.
export function coinUnavailableMessage(message) {
  const detail=String(message || '');
  if (/\b429\b|rate limit|too many requests/i.test(detail)) return 'Solana RPC is rate limited. Wait a moment, then select Refresh.';
  if (/timed out|timeout/i.test(detail)) return 'Solana RPC timed out. Check your connection and select Refresh.';
  if (['Invalid public key input','Non-base58 character'].includes(detail)) return 'Enter a valid Solana token mint address, then try again.';
  if (['Choose a token from Explore to see its details.','Mint account was not returned by Solana RPC.','Enter a valid Solana token mint address, then try again.'].includes(detail)) return detail;
  return 'We could not load verified token details. Try Refresh in a moment.';
}
