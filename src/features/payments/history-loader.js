// Payment history must not wait for unrelated analytics requests to finish.
export function createPaymentHistoryLoader(appState, {timeoutMs = 20_000} = {}) {
  let pending;
  return function loadPaymentHistory(signal) {
    if (pending) return pending;
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    pending = Promise.resolve().then(async () => {
      try {
        const result = await appState.apiRequest('/api/evidence/payment-history', {signal:requestSignal});
        requestSignal.throwIfAborted();
        if (!result?.available || result.data?.cluster !== appState.EXPLORE_CLUSTER
          || !Array.isArray(result.data.verifiedPayouts) || result.data.status === 'unavailable') throw Error('History unavailable');
        appState.paymentHistoryEvidence = result.data;
      } catch (error) {
        if (signal?.aborted) return;
        const previous = appState.paymentHistoryEvidence;
        appState.paymentHistoryEvidence = previous?.cluster === appState.EXPLORE_CLUSTER
          && previous.verifiedPayouts?.length
          ? {...previous, status:'partial', refreshFailed:true}
          : {cluster:appState.EXPLORE_CLUSTER, status:'unavailable', verifiedPayouts:[], refreshFailed:true};
      } finally {
        pending = null;
        if (!signal?.aborted) {
          appState.renderVerifiedReceiptEvidence();
          appState.renderCoinSummary?.();
        }
      }
    });
    return pending;
  };
}
