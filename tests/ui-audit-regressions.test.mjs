import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('Explore table uses the same migrated market-cap value as token cards', () => {
  const helper = source.match(/function exploreMarketCapUsd\(record\)\{[\s\S]*?\n\}/)?.[0];
  const format = new Function('record', `const EXPLORE_CLUSTER='devnet', coinSolUsdPrice=100;
    const formatDashboardUsd=value=>'$'+value; ${helper}; return exploreMarketCapUsd(record);`);
  assert.equal(format({ migrated:true, poolMarketCapSol:27, curveCapSol:99 }), '$2700');
  assert.equal(format({ migrated:false, curveCapSol:4 }), '$400');
  assert.equal(format({ migrated:true, curveCapSol:99 }), '$—');
  const registry = source.match(/function renderRegistry\(query = exploreQuery\)\{[\s\S]*?\n\}/)?.[0];
  assert.match(registry, /escapeHtml\(exploreMarketCapUsd\(item\)\)/);
});

test('failed balance refresh clears stale spendable SOL without affecting a new wallet session', async () => {
  const helper = source.match(/async function refreshWalletBalance\(\{ force = false \} = \{\}\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const run = new Function('current', `
    let walletBalanceLamports=1000000000, walletBalanceRequest=0, walletBalanceFetchedAt=1;
    const captureWalletSession=()=>({provider:{publicKey:'test'}}), isWalletSessionCurrent=()=>current;
    const renderWalletBalance=()=>{}, getSolana=async()=>{}, console={warn:()=>{}};
    const connection={getBalance:async()=>{throw new Error('RPC unavailable');}};
    const withRpcRetry=fn=>fn();
    ${helper}
    return refreshWalletBalance({force:true}).then(()=>({balance:walletBalanceLamports,fetchedAt:walletBalanceFetchedAt}));
  `);
  assert.deepEqual(await run(true), { balance:null, fetchedAt:0 });
  assert.deepEqual(await run(false), { balance:1000000000, fetchedAt:1 });
});
