// An allowlist is intentional: a new upstream RPC method must not silently
// become available through the review server. Batches are unsupported.
const METHODS = new Set(['getAccountInfo', 'getMultipleAccounts', 'getBalance',
  'getBlock', 'getBlockHeight', 'getBlockTime', 'getEpochInfo', 'getFeeForMessage',
  'getGenesisHash', 'getHealth', 'getLatestBlockhash', 'getMinimumBalanceForRentExemption',
  'getRecentPrioritizationFees', 'getSignatureStatuses', 'getSignaturesForAddress',
  'getSlot', 'getSupply', 'getTokenAccountBalance', 'getTokenAccountsByOwner',
  'getTokenLargestAccounts', 'getTokenSupply', 'getTransaction', 'getVersion',
  'isBlockhashValid', 'simulateTransaction']);

export function readOnlyRpcRequest(value) {
  return Boolean(value && !Array.isArray(value) && value.jsonrpc === '2.0'
    && METHODS.has(value.method) && (value.params === undefined || Array.isArray(value.params)));
}

export async function readReviewRpcBody(req) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw Object.assign(Error('RPC request too large.'), { status: 413 });
    parts.push(chunk);
  }
  let request;
  try { request = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(Error('Invalid JSON-RPC request.'), { status: 400 }); }
  if (!readOnlyRpcRequest(request)) throw Object.assign(Error('Read-only review RPC method required.'), { status: 403 });
  return JSON.stringify(request);
}
