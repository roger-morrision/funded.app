// Share one wallet-ownership session across pages and serialize cookie changes.
export function createWalletSignIn({ request, assertCurrent, encodeSignature, now = Date.now }) {
  let authenticated = null;
  let pending = null;
  const same = (a, b) => a?.address === b?.address && a?.provider === b?.provider && a?.version === b?.version;
  const ready = session => Boolean(session && same(authenticated, session) && authenticated.expiresAt > now() + 5000);
  const remember = (session, data) => {
    if (!data?.authenticated || data.wallet !== session.address) return false;
    const expiresAt = Number(data.expiresAt);
    authenticated = { ...session, expiresAt: Number.isFinite(expiresAt) ? expiresAt : now() + 60_000 };
    return true;
  };
  async function ensure(session, { interactive = false } = {}) {
    assertCurrent(session);
    if (ready(session)) return true;
    if (pending) {
      const prior = pending;
      try {
        const result = await prior.promise;
        assertCurrent(session);
        if (same(prior.session, session) && (result || !interactive || prior.interactive)) return result;
      } catch (error) {
        assertCurrent(session);
        if (same(prior.session, session)) throw error;
      }
      return ensure(session, { interactive });
    }
    const task = { session, interactive };
    task.promise = (async () => {
      const current = await request('/api/referrals/session').catch(() => null);
      assertCurrent(session);
      if (remember(session, current?.data)) return true;
      authenticated = null;
      if (!interactive) return false;
      if (typeof session.provider?.signMessage !== 'function') throw new Error('This wallet does not support message sign-in.');
      const prepared = await request('/api/referrals/session/prepare', { method:'POST', body:{ wallet:session.address } });
      assertCurrent(session);
      if (!prepared.available || !prepared.data?.statement || !prepared.data?.challengeId) throw new Error('Wallet sign-in is temporarily unavailable.');
      const signed = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
      assertCurrent(session);
      const verified = await request('/api/referrals/session/verify', { method:'POST', body:{ challengeId:prepared.data.challengeId, wallet:session.address, signature:encodeSignature(signed.signature || signed) } });
      assertCurrent(session);
      if (!remember(session, verified?.data)) throw new Error('Wallet sign-in could not be completed.');
      return true;
    })();
    pending = task;
    try { return await task.promise; }
    finally { if (pending === task) pending = null; }
  }
  function clear() { authenticated = null; }
  async function logout() {
    clear();
    const prior = pending;
    const task = { session:null, interactive:false };
    task.promise = (async () => {
      try { await prior?.promise; } catch {}
      clear();
      await request('/api/referrals/session/logout', { method:'POST' });
      return false;
    })();
    pending = task;
    try { await task.promise; }
    finally { if (pending === task) pending = null; }
  }
  return { ensure, ready, clear, logout };
}
