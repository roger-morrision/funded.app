// Share simultaneous public reads across independently mounted page modules.
// No response cache: quotes, refreshes and post-transaction reads stay fresh.
const publicPaths = /^\/api\/(?:launches|token-config|listings(?:\/config)?|pump\/explore|analytics\/summary|airdrops\/reserves|buyback\/status|rewards\/(?:automatic|experience)|x-fee\/status|evidence\/(?:receipts|payment-history)|tokens\/[1-9A-HJ-NP-Za-km-z]{32,44}\/(?:token-accounts|market-activity|fee-activity))$/;

export function createPublicReadFetch(transport = (...args) => fetch(...args)) {
  const flights = new Map();
  return function read(input, options = {}) {
    const url = new URL(input, globalThis.location?.origin || 'https://funded.invalid');
    const eligible = (options.method || 'GET').toUpperCase() === 'GET' && !options.body
      && ![...new Headers(options.headers).keys()].length && options.credentials !== 'include'
      && !url.searchParams.has('wallet') && !url.searchParams.has('address')
      && publicPaths.test(url.pathname);
    if (!eligible) return transport(input, options);
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(signal.reason);
    const key = url.href + '|' + (options.credentials || 'same-origin');
    let entry = flights.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, users:0 };
      entry.promise = Promise.resolve().then(async () => {
        const response = await transport(input, {...options, cache:'no-store', signal:controller.signal});
        // Retain subscriber cancellation until the whole JSON body arrives.
        const bytes = await response.arrayBuffer();
        return new Response([204,205,304].includes(response.status) ? null : bytes,
          {status:response.status, statusText:response.statusText, headers:response.headers});
      })
        .finally(() => { if (flights.get(key) === entry) flights.delete(key); });
      flights.set(key, entry);
    }
    entry.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback, value) => {
        if (done) return;
        done = true; signal?.removeEventListener('abort', abort);
        if (--entry.users === 0 && flights.get(key) === entry) {
          flights.delete(key); entry.controller.abort();
        }
        callback(value);
      };
      const abort = () => finish(reject, signal.reason);
      signal?.addEventListener('abort', abort, {once:true});
      entry.promise.then(response => { if (!done) finish(resolve, response.clone()); }, error => finish(reject, error));
    });
  };
}

export const publicReadFetch = createPublicReadFetch();
