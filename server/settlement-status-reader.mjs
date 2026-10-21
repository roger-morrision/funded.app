import { allocationAuditHash } from './allocation-audit-hash.mjs';

const scope = 'all-recorded-v3-collections';
const reasons = new Set(['no-v3-collections','verification-budget-exceeded','approved-program-unavailable',
  'approved-program-unverified','record-mismatch-or-pending','collection-proof-unavailable',
  'settlement-proof-unavailable','settlement-authorization-mismatch','finalized-evidence-unavailable',
  'v3-settlement-disabled','verification-timeout','invalid-verification-result']);
const evidence = (recorded, reason, extra = {}) => ({
  verified: false, scope, recorded, checked: 0, reason, ...extra,
});

// The cache belongs to one server instance. Only the existing proof verifier
// can produce a verified result; requests never wait for its full RPC budget.
export function createSettlementStatusReader({ readSnapshot, verify,
  now = Date.now, responseWaitMs = 250, verificationTimeoutMs = 30_000,
  maxAgeMs = 60_000, snapshotTimeoutMs = 6_000 }) {
  for (const [value,limit] of [[responseWaitMs,500],[verificationTimeoutMs,30_000],
    [snapshotTimeoutMs,6_000],[maxAgeMs,60_000]])
    if (!Number.isSafeInteger(value) || value <= 0 || value > limit)
      throw new RangeError('Status timing budgets must stay within their supported limits.');
  let reading, running, completed, latestKey;
  // Include aborted dependencies that have not acknowledged cancellation. A
  // healthy replacement is allowed, but uncooperative providers cannot cause
  // an unbounded accumulation of retired work across successive timeouts.
  const inventoryReads = new Set(), verificationJobs = new Set();
  function tracked(work, active) {
    const promise = Promise.resolve().then(work); active.add(promise);
    void promise.then(() => active.delete(promise), () => active.delete(promise));
    return promise;
  }

  function readInputs() {
    if (!reading) {
      if (inventoryReads.size >= 2) {
        completed = null; latestKey = null;
        return Promise.reject(new Error('Status inventory capacity unavailable.'));
      }
      const controller = new AbortController(); let timer, task;
      task = Promise.race([
        tracked(() => readSnapshot({signal:controller.signal}),inventoryReads),
        new Promise((_,reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('Status inventory read timed out.'));
        },snapshotTimeoutMs); }),
      ]).then(input => {
        const collections = Object.fromEntries(Object.entries(input.state?.collections || {})
          .filter(([, row]) => row?.scope === 'per-mint-v3' && row.cluster === 'devnet'));
        const launches = {}, v3Settlements = {};
        for (const row of Object.values(collections)) {
          if (input.state?.launches?.[row.mint]) launches[row.mint] = input.state.launches[row.mint];
          if (input.state?.v3Settlements?.[row.signature])
            v3Settlements[row.signature] = input.state.v3Settlements[row.signature];
        }
        // Freeze the verification inputs even if a fixture/store reuses objects.
        const snapshot = structuredClone({ identity: input.identity,
          state: { collections, launches, v3Settlements } });
        return { ...snapshot, recorded: Object.keys(collections).length,
          key: allocationAuditHash(snapshot) };
      }).catch(error => { completed = null; latestKey = null; throw error; })
        .finally(() => {
          clearTimeout(timer); controller.abort(); if (reading === task) reading = null;
        });
      reading = task;
    }
    return reading;
  }

  const pending = context => evidence(context?.recorded ?? null,
    context ? 'verification-pending' : 'snapshot-pending', { status: 'pending' });
  const present = (entry, cached) => structuredClone({ ...entry.proof,
    status: entry.proof.verified ? 'verified' : 'unavailable',
    checkedAt: new Date(entry.checkedAt).toISOString(),
    expiresAt: new Date(entry.checkedAt + maxAgeMs).toISOString(), cached });

  function start(context) {
    if (verificationJobs.size >= 2)
      return evidence(context.recorded,'verification-capacity-unavailable',{status:'unavailable'});
    const controller = new AbortController();
    const slot = { key: context.key, controller };
    running = slot;
    let timer;
    const raw = tracked(async () => {
      const proof = await verify({ ...context, signal: controller.signal });
      if (controller.signal.aborted) return evidence(context.recorded, 'verification-timeout');
      // Observe the inventory again even if no other request arrived while the
      // scan ran. Its completion must not certify an input that has since changed.
      const current = await readInputs();
      if (controller.signal.aborted) return evidence(context.recorded, 'verification-timeout');
      if (current.key !== context.key) {
        latestKey = current.key;
        return evidence(context.recorded, 'verification-inputs-changed');
      }
      return proof;
    },verificationJobs);
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(evidence(context.recorded, 'verification-timeout'));
      }, verificationTimeoutMs);
    });
    slot.promise = Promise.race([raw, deadline]).catch(() =>
      evidence(context.recorded, 'finalized-evidence-unavailable')).then(proof => {
      clearTimeout(timer); controller.abort();
      if (!proof || proof.scope !== scope || typeof proof.verified !== 'boolean'
        || proof.recorded !== context.recorded || !Number.isSafeInteger(proof.checked)
        || proof.checked < 0 || proof.checked > context.recorded
        || (proof.verified && (!context.recorded || context.recorded > 100 || proof.checked !== context.recorded
          || proof.failed || proof.failures?.length)))
        proof = evidence(context.recorded, 'invalid-verification-result');
      if (latestKey !== context.key || running !== slot) {
        if (running === slot) running = null;
        return pending(context);
      }
      const safe = {verified:proof.verified,scope,recorded:proof.recorded,checked:proof.checked};
      if (Number.isSafeInteger(proof.recoveredRecords) && proof.recoveredRecords >= 0
        && proof.recoveredRecords <= proof.checked) safe.recoveredRecords = proof.recoveredRecords;
      if (!proof.verified) {
        safe.reason = reasons.has(proof.reason) ? proof.reason : 'finalized-evidence-unavailable';
        if (Number.isSafeInteger(proof.verifiedRecords) && proof.verifiedRecords >= 0
          && proof.verifiedRecords <= proof.checked) safe.verifiedRecords = proof.verifiedRecords;
        if (Number.isSafeInteger(proof.failed) && proof.failed >= 0
          && proof.failed <= context.recorded) safe.failed = proof.failed;
        if (Array.isArray(proof.failures)) safe.failures = proof.failures.slice(0,context.recorded).map(row => ({
          ...(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row?.mint) ? {mint:row.mint} : {}),
          ...(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row?.collectionSignature)
            ? {collectionSignature:row.collectionSignature} : {}),
          reason:reasons.has(row?.reason) ? row.reason : 'finalized-evidence-unavailable',
        }));
      }
      completed = { key: context.key, proof: safe, checkedAt: now() };
      if (running === slot) running = null;
      return present(completed, false);
    });
    return slot.promise;
  }

  return async function read(expectedIdentity) {
    let context, timer;
    const refresh = async () => {
      context = await readInputs();
      if (expectedIdentity && allocationAuditHash(context.identity) !== allocationAuditHash(expectedIdentity))
        return pending(context);
      latestKey = context.key;
      const age = completed ? now() - completed.checkedAt : Infinity;
      if (completed?.key === context.key && age >= 0 && age < maxAgeMs)
        return present(completed, true);
      completed = null;
      if (running) {
        if (running.key !== context.key) return pending(context);
        return running.promise;
      }
      return start(context);
    };
    try {
      return await Promise.race([refresh(), new Promise(resolve => {
        timer = setTimeout(() => resolve(pending(context)), responseWaitMs);
      })]);
    } catch { return evidence(null, 'snapshot-unavailable', { status: 'unavailable' }); }
    finally { clearTimeout(timer); }
  };
}
