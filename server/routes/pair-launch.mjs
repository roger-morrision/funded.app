import { Connection, PublicKey } from '@solana/web3.js';
import { PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { assertRpcNetwork } from '../../solana-network.js';
import { verifyPumpLaunch } from '../launch-verification.mjs';

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
  connectionFactory = url => new Connection(url, 'finalized') }) {
  async function verify({ mint, signature }) {
    const connection = connectionFactory(solanaRpcUrl);
    if (solanaCluster === 'devnet') await assertRpcNetwork(connection, solanaCluster);
    let proof;
    try { proof = await verifyPumpLaunch({ connection, mint, signature, commitment:'finalized', cluster:solanaCluster }); }
    catch (error) {
      if (String(error.message).includes('is not finalized'))
        throw Object.assign(new Error('The Pump creation transaction is not finalized yet.'), { statusCode:409 });
      if (String(error.message).includes('no matching Pump creation event'))
        throw Object.assign(new Error('This transaction did not create that coin.'), { statusCode:400 });
      throw error;
    }
    const account = await connection.getAccountInfo(bondingCurvePda(new PublicKey(mint)), 'finalized');
    const curve = account && PUMP_SDK.decodeBondingCurveNullable(account);
    if (!curve) throw Object.assign(new Error('No finalized Pump bonding curve exists for this coin.'), { statusCode: 409 });
    const WSOL = 'So11111111111111111111111111111111111111112';
    const rawQuote = curve.quoteMint?.toBase58?.() || '';
    const quoteMint = !rawQuote || rawQuote === PublicKey.default.toBase58() ? WSOL : rawQuote;
    // Pump can transfer fee ownership after creation. The finalized creation
    // event, rather than the curve's current creator field, binds the signer.
    if (proof.creator !== proof.feePayer)
      throw Object.assign(new Error('The coin creator did not sign its launch.'), { statusCode: 400 });
    const quotes = await pairQuotes.read().catch(() => ({ quotes: [] }));
    const quote = quoteMint === WSOL ? { symbol: 'SOL' } : quotes.quotes.find(row => row.mint === quoteMint) || null;
    return { ...proof, quoteMint, quoteSymbol: quote?.symbol || null };
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
      const saved = await store.update(state => {
        state.pairLaunches ||= {};
        state.pairLaunches[mint] = { ...record, recordedAt:state.pairLaunches[mint]?.recordedAt || new Date().toISOString() };
        return state.pairLaunches[mint];
      });
      respond(res, 201, saved);
    } catch (error) { respond(res, error.statusCode || 503, { error: error.statusCode ? error.message : 'The launch could not be verified right now. Try again shortly.' }); }
    return true;
  };
}
