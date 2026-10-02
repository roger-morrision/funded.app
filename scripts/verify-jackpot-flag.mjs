import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const temp = await mkdtemp(join(tmpdir(), 'funded-jackpot-flag-'));
const freePort = () => new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolvePort(port));
  });
});

async function check(enabled) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd:process.cwd(),
    env:{ SystemRoot:process.env.SystemRoot, PATH:process.env.PATH,
      FUNDED_SKIP_LOCAL_ENV:'true', NODE_ENV:'development', HOST:'127.0.0.1', PORT:String(port),
      VITE_SOLANA_CLUSTER:'devnet', VITE_JACKPOT_ENABLED:String(enabled),
      FUNDED_STORE_PATH:join(temp, `store-${enabled}.json`),
      AUTOMATIC_REWARD_STORE_PATH:join(temp, `rewards-${enabled}.json`) },
    stdio:['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error('Local API startup timed out.')), 15000);
      child.stdout.on('data', chunk => {
        if (!String(chunk).includes('funded.vip app listening')) return;
        clearTimeout(timer);
        resolveReady();
      });
      child.once('exit', code => {
        clearTimeout(timer);
        rejectReady(new Error(`Local API exited before readiness: ${code}`));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/jackpots/status`,
      { signal:AbortSignal.timeout(5000) });
    assert.equal(response.status, enabled ? 200 : 404);
    const data = await response.json();
    if (enabled) {
      assert.equal(data.mode, 'devnet-prototype');
      assert.equal(data.creator.fundedLamports, '0');
      assert.equal(data.trader.payoutEnabled, false);
    } else assert.match(data.error, /disabled/);
  } finally {
    const exited = child.exitCode != null || child.signalCode != null
      ? Promise.resolve() : new Promise(resolveExit => child.once('exit', resolveExit));
    child.kill();
    await exited;
  }
}

try {
  await check(false);
  await check(true);
  console.log('Jackpot visibility flag passed: disabled API returns 404; enabled Devnet API remains inactive.');
} finally {
  if (!resolve(temp).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Temporary store path escaped the system temp directory.');
  await rm(temp, { recursive:true, force:true });
}
