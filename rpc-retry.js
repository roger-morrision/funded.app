export function retryableRpcError(error) {
  const detail = String(error?.message || error || '');
  return /(?:\b429\b|rate limit|too many requests|failed to fetch|networkerror|econnrefused|timed out|temporarily unavailable)/i.test(detail);
}

export async function withRpcRetry(operation, {
  attempts = 3,
  delaysMs = [200, 600],
  onRetry = () => {},
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (typeof operation !== 'function') throw new Error('An RPC operation is required.');
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('RPC retry attempts must be between 1 and 5.');
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      if (!retryableRpcError(error) || attempt + 1 >= attempts) throw error;
      onRetry({ attempt: attempt + 1, error });
      await wait(Number(delaysMs[attempt] ?? delaysMs.at(-1) ?? 0));
    }
  }
  throw lastError;
}
