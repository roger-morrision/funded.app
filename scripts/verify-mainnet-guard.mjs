import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { assessMainnetConfig, mainnetReadinessPreflight } from './mainnet-readiness-preflight.mjs';

// This is a release regression gate. It deliberately uses no RPC endpoint,
// wallet, private key, or transaction. Mainnet activation requires a separate
// review and must not happen by changing an environment flag alone.
let called = false;
const poison = new Proxy({}, {
  get() { called = true; throw new Error('Mainnet guard was bypassed before RPC or wallet use.'); },
});
await assert.rejects(
  submitPumpDevnetLaunch({ cluster:'mainnet-beta', connection:poison, provider:poison, payer:poison, input:poison }),
  /Mainnet coin launching is not enabled\. No transaction was prepared or sent\./,
);
assert.equal(called, false, 'Mainnet launch touched a wallet or RPC before rejection.');

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
const keeperRoutes = await readFile(new URL('../server/routes/keeper-collection.mjs', import.meta.url), 'utf8');
const launchRoutes = await readFile(new URL('../server/routes/launch-registration.mjs', import.meta.url), 'utf8');
const marketRoutes = await readFile(new URL('../server/routes/token-market.mjs', import.meta.url), 'utf8');
const launchHandler = app.slice(app.indexOf('async function launchToken(){'), app.indexOf('async function launchToken(){') + 500);
assert.match(launchHandler, /if\s*\(APP_CLUSTER\s*!==\s*'devnet'\)\s*\{[\s\S]*?return;/,
  'The browser launch handler must reject Mainnet before wallet use.');

function routeGuard(route, guard, source = server) {
  const at = source.indexOf(route);
  assert.ok(at >= 0, `Missing server route: ${route}`);
  assert.match(source.slice(at, at + 400), guard, `Missing Devnet guard near ${route}`);
}
routeGuard("url.pathname === '/api/devnet-metadata'", /solanaCluster\s*!==\s*'devnet'/);
routeGuard("url.pathname === '/api/keeper/collect'", /solanaCluster\s*!==\s*'devnet'/, keeperRoutes);
routeGuard("req.method === 'POST' && url.pathname === '/api/launches'", /solanaCluster\s*!==\s*'devnet'/, launchRoutes);
routeGuard('if (creatorClaimMatch) {', /solanaCluster\s*!==\s*'devnet'/);
routeGuard('if (tokenMarketMint) {', /solanaCluster\s*!==\s*'devnet'/, marketRoutes);

const mainnetFixture = {
  VITE_SOLANA_CLUSTER:'mainnet-beta', SOLANA_CLUSTER:'mainnet-beta', VITE_ALLOW_MAINNET:'false',
  SOLANA_RPC_URL:'https://private-rpc.example.org/?api-key=do-not-log',
  FUNDED_FEE_ROUTER_PROGRAM_ID:'2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik',
  VITE_FUNDED_FEE_ROUTER_PROGRAM_ID:'2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik',
  FUNDED_REWARD_PROGRAM_DATA_SHA256:'a'.repeat(64),
  MAINNET_APPROVED_UPGRADE_AUTHORITY:'11111111111111111111111111111111',
  DATABASE_URL:'postgres://user:do-not-log@database.example.org/funded_mainnet',
};
assert.equal(assessMainnetConfig(mainnetFixture).configurationComplete, true);
assert.equal(assessMainnetConfig({ ...mainnetFixture, MAINNET_APPROVED_UPGRADE_AUTHORITY:'', MAINNET_APPROVED_IMMUTABLE_PROGRAM:'true' }).configurationComplete, true);
for (const changes of [
  { VITE_SOLANA_CLUSTER:'devnet' }, { SOLANA_CLUSTER:'devnet' }, { VITE_ALLOW_MAINNET:'true' },
  { SOLANA_RPC_URL:'https://api.devnet.solana.com' }, { SOLANA_RPC_URL:'https://api.mainnet.solana.com' },
  { SOLANA_RPC_URL:'https://api.mainnet-beta.solana.com' },
  { VITE_FUNDED_FEE_ROUTER_PROGRAM_ID:'11111111111111111111111111111111' },
  { FUNDED_REWARD_PROGRAM_DATA_SHA256:'bad' }, { MAINNET_APPROVED_UPGRADE_AUTHORITY:'bad' },
  { MAINNET_APPROVED_IMMUTABLE_PROGRAM:'true' },
  { FUNDED_STORE_PATH:'local.json' },
]) assert.equal(assessMainnetConfig({ ...mainnetFixture, ...changes }).configurationComplete, false);
const offline = await mainnetReadinessPreflight(mainnetFixture);
assert.equal(offline.ready, false);
assert.equal(offline.onchain.status, 'unavailable');
assert.ok(!JSON.stringify(offline).includes('do-not-log'), 'Preflight report leaked credentials.');

console.log('Mainnet guards verified: launch rejected before RPC/wallet use; browser launch, metadata, registration, fee collection, creator claims, and trade scanning remain Devnet-only. Offline preflight stays no-go without leaking credentials (local-only).');
