import { readFile } from 'node:fs/promises';
import { SOLANA_GENESIS } from '../solana-network.js';
import { agencyProtocolSplit } from '../agency-mint-router-v3.js';
import { build, preview } from 'vite';

// Only the compiled browser assets are served. No application backend, signing
// roles, database, or Devnet proxy is started or attached.
const outDir = 'dist-mainnet-readonly';
const mode = process.argv[2];
if (mode === 'build') {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VITE_')) delete process.env[key];
  }
  Object.assign(process.env, {
    VITE_SOLANA_CLUSTER: 'mainnet-beta', VITE_EXPLORE_CLUSTER: 'mainnet-beta',
    VITE_MAINNET_READ_ONLY: 'true', VITE_ALLOW_MAINNET: 'false',
    VITE_DEV_MODE: 'false', VITE_DEV_AUTOCONNECT: 'false',
    VITE_API_BASE_URL: '/', VITE_FUNDED_TRADE_FEE_BPS: '100',
  });
  await build({ mode: 'mainnet-preview', envDir: false, build: { outDir } });
} else if (mode === 'serve') {
  const settings = JSON.parse(await readFile(outDir + '/build-settings.json', 'utf8'));
  if (settings.cluster !== 'mainnet-beta' || settings.exploreCluster !== settings.cluster ||
      settings.mainnetReadOnly !== true || settings.mainnetEnabled !== false || settings.devWalletEnabled !== false) {
    throw new Error('Build a read-only Mainnet artifact before starting staging.');
  }
  const rpcFile = process.env.MAINNET_PREVIEW_RPC_URL_FILE;
  const rpc = new URL(rpcFile ? (await readFile(rpcFile, 'utf8')).trim() : 'https://api.mainnet-beta.solana.com');
  if (rpc.protocol !== 'https:' || rpc.username || rpc.password) throw new Error('Use an HTTPS Mainnet RPC endpoint.');
  async function chainRead(method, params) {
    const response = await fetch(rpc, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!response.ok) throw new Error('RPC unavailable');
    return (await response.json()).result;
  }
  async function chainStatus() {
    const [genesis, slot] = await Promise.all([chainRead('getGenesisHash', []), chainRead('getSlot', [{ commitment: 'finalized' }])]);
    if (genesis !== SOLANA_GENESIS['mainnet-beta'] || !Number.isSafeInteger(slot) || slot < 1) throw new Error('Mainnet state unavailable');
    return { cluster: 'mainnet-beta', genesis, finalizedSlot: slot, readOnly: true, mainnetActivationAuthorized: false };
  }
  let statusRequest, expires = 0;
  const server = await preview({ configFile: false, envDir: false, publicDir: false, build: { outDir },
    preview: { host: '127.0.0.1', port: 4186, strictPort: true, cors: false,
      headers: { 'Content-Security-Policy': "connect-src 'self'; form-action 'none'; object-src 'none'; base-uri 'self'" } },
    plugins: [{ name: 'readonly-staging', configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url.split('?', 1)[0];
        function json(status, data) {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify(data));
        }
        if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Read-only staging.' });
        if (path === '/api/fee-policy') return json(200, { cluster: 'mainnet-beta', source: 'preview-defaults', split: agencyProtocolSplit() });
        if (path === '/api/status') {
          if (!statusRequest || Date.now() >= expires) {
            expires = Date.now() + 15000;
            statusRequest = chainStatus();
          }
          try { return json(200, await statusRequest); }
          catch { return json(503, { error: 'Cannot verify finalized Mainnet state.' }); }
        }
        if (/^\/(api(?:\/|$)|devnet-)/.test(path)) return json(404, { error: 'Unavailable in read-only staging.' });
        next();
      });
    } }] });
  server.printUrls();
} else {
  throw new Error('Use build or serve.');
}
