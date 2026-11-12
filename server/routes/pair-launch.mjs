import { Connection, PublicKey } from '@solana/web3.js';

// Paired launches: a plain pump.fun create_v2 whose bonding curve is quoted in a
// token the Pump program accepts (SOL, USDC, xStocks, ...). The creator's wallet
// is Pump's creator; richpad.fun keeps its 1% app fee on trades placed here.
// The record route verifies the launch on-chain before the coin is listed.
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export function pairLaunchEnabled({ solanaCluster, env = process.env }) {
  if (solanaCluster === 'devnet') return true;
  return solanaCluster === 'mainnet-beta' && env.PAIR_LAUNCH_MAINNET === 'true' && env.METADATA_STORAGE === 'pinata';
}

export function createPairLaunchRoutes({ solanaCluster, solanaRpcUrl, store, pairQuotes, body, respond, env = process.env,
  connectionFactory = url => new Connection(url, 'confirmed'), loadSdk = () => import('@pump-fun/pump-sdk') }) {
  async function verify({ mint, signature }) {
    const connection = connectionFactory(solanaRpcUrl);
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) throw Object.assign(new Error('The launch transaction is not confirmed on Solana yet.'), { statusCode: 409 });
    const keys = tx.transaction.message.getAccountKeys?.({ accountKeysFromLookups: tx.meta?.loadedAddresses }) ?? null;
    const accounts = keys ? keys.staticAccountKeys.concat(keys.accountKeysFromLookups?.writable || [], keys.accountKeysFromLookups?.readonly || []) : tx.transaction.message.accountKeys;
    const signer = accounts[0]?.toBase58?.();
    if (!accounts.some(key => key.toBase58() === mint)) throw Object.assign(new Error('This transaction did not create that coin.'), { statusCode: 400 });
    const { OnlinePumpSdk } = await loadSdk();
    const curve = await new OnlinePumpSdk(connection).fetchBondingCurve(new PublicKey(mint)).catch(() => null);
    if (!curve) throw Object.assign(new Error('No Pump bonding curve exists for this coin.'), { statusCode: 400 });
    const WSOL = 'So11111111111111111111111111111111111111112';
    const rawQuote = curve.quoteMint?.toBase58?.() || '';
    const creator = curve.creator.toBase58(), quoteMint = !rawQuote || rawQuote === PublicKey.default.toBase58() ? WSOL : rawQuote;
    if (creator !== signer) throw Object.assign(new Error('The coin creator is not the wallet that sent the launch.'), { statusCode: 400 });
    const quotes = await pairQuotes.read().catch(() => ({ quotes: [] }));
    const quote = quoteMint === WSOL ? { symbol: 'SOL' } : quotes.quotes.find(row => row.mint === quoteMint) || null;
    return { mint, signature, creator, quoteMint, quoteSymbol: quote?.symbol || null, blockTime: tx.blockTime || null };
  }
  return async function handlePairLaunch(req, res, url) {
    if (url.pathname === '/api/pair-launch/status' && req.method === 'GET') {
      respond(res, 200, { cluster: solanaCluster, enabled: pairLaunchEnabled({ solanaCluster, env }) });
      return true;
    }
    if (url.pathname !== '/api/pair-launch/record' || req.method !== 'POST') return false;
    if (!pairLaunchEnabled({ solanaCluster, env })) { respond(res, 403, { error: 'Paired launches are not open on this network yet.' }); return true; }
    const input = await body(req);
    const mint = String(input?.mint || ''), signature = String(input?.signature || '');
    if (!MINT.test(mint) || !SIGNATURE.test(signature)) { respond(res, 400, { error: 'A coin address and launch signature are required.' }); return true; }
    try {
      const record = await verify({ mint, signature });
      const name = String(input?.name || '').slice(0, 32), symbol = String(input?.symbol || '').replace(/^\$/, '').slice(0, 10);
      const saved = await store.update(state => {
        state.pairLaunches ||= {};
        state.pairLaunches[mint] = { ...(state.pairLaunches[mint] || {}), ...record, name: name || null, symbol: symbol || null, cluster: solanaCluster, recordedAt: new Date().toISOString() };
        return state.pairLaunches[mint];
      });
      respond(res, 201, saved);
    } catch (error) { respond(res, error.statusCode || 503, { error: error.statusCode ? error.message : 'The launch could not be verified right now. Try again shortly.' }); }
    return true;
  };
}
