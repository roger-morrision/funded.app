const retryable = new Set([408, 429, 502, 503, 504]);

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, {once:true});
  });
}

// Only called for explicitly allowlisted, anonymous GETs. One retry is shared by
// all subscribers; its deadline includes the response body and retry delay.
export async function recoverPublicRead(transport, input, options, {timeoutMs=20_000, retryDelayMs=350}={}) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Public data request timed out', 'TimeoutError')), timeoutMs);
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  try {
    for (let attempt=0; attempt<2; attempt++) {
      let response;
      try {
        response = await transport(input, {...options, signal});
        signal.throwIfAborted();
      } catch (error) {
        if (signal.aborted || attempt || !(error instanceof TypeError)) throw error;
        await pause(retryDelayMs, signal);
        continue;
      }
      let delay = retryDelayMs;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter != null) {
        const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter)*1000 : Date.parse(retryAfter)-Date.now();
        delay = Number.isFinite(seconds) ? Math.max(delay, seconds) : Infinity;
      }
      if (!attempt && retryable.has(response.status) && delay <= 2000) {
        await response.body?.cancel();
        await pause(delay, signal);
        continue;
      }
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      return new Response([204,205,304].includes(response.status) ? null : bytes,
        {status:response.status, statusText:response.statusText, headers:response.headers});
    }
  } finally { clearTimeout(timer); }
}
