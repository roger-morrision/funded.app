import { PublicKey } from '@solana/web3.js';
import { bondingCurvePda } from '@pump-fun/pump-sdk';

// Mint and bonding-curve accounts for the coins on the launch feed, read once
// on the server so every visitor's cards can show caps with the feed instead
// of waiting on their own RPC round trip. Trades still read the chain live.
export function createExploreAccountSnapshot({ getConnection, refreshAfterMs = 5_000, maxAgeMs = 60_000, firstWaitMs = 1_500, now = Date.now }) {
  const byMint = new Map();
  let pending = null;
  const encode = account => account ? { owner: account.owner.toBase58(), lamports: account.lamports, executable: Boolean(account.executable), data: Buffer.from(account.data).toString('base64') } : null;
  const load = mints => {
    const keys = mints.flatMap(mint => { try { const key = new PublicKey(mint); return [[mint, key, bondingCurvePda(key)]]; } catch { return []; } });
    if (!keys.length) return Promise.resolve(false);
    return getConnection().getMultipleAccountsInfo([...keys.map(row => row[1]), ...keys.map(row => row[2])], 'confirmed')
      .then(accounts => {
        const at = now();
        keys.forEach(([mint], index) => byMint.set(mint, { at, mint: encode(accounts[index]), curve: encode(accounts[keys.length + index]) }));
        return true;
      });
  };
  const refresh = mints => pending ||= Promise.resolve().then(() => load(mints)).finally(() => { pending = null; });
  return async function readSnapshot(mints) {
    const wanted = mints.filter(Boolean).slice(0, 100);
    if (!wanted.length) return null;
    const ages = wanted.map(mint => byMint.has(mint) ? now() - byMint.get(mint).at : Infinity);
    const oldest = Math.max(...ages);
    if (oldest >= refreshAfterMs) {
      const next = refresh(wanted).catch(() => false);
      // Without a usable read, wait briefly for this one; otherwise serve the
      // recent read now and let the refresh land for the next visitor.
      if (oldest >= maxAgeMs) await Promise.race([next, new Promise(resolve => setTimeout(resolve, firstWaitMs))]);
    }
    const accounts = {};
    let readAt = Infinity;
    for (const mint of wanted) {
      const row = byMint.get(mint);
      if (!row || now() - row.at >= maxAgeMs) return null;
      accounts[mint] = { mint: row.mint, curve: row.curve };
      readAt = Math.min(readAt, row.at);
    }
    return { readAt: new Date(readAt).toISOString(), accounts };
  };
}
