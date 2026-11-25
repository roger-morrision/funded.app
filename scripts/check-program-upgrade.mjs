// Read-only: this command does not load a signer or build/send transactions.
import {readFile, writeFile, mkdir, realpath} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Connection} from '@solana/web3.js';
import {assessProgramUpgrade} from './program-upgrade-plan.mjs';

export const UPGRADE_USAGE = 'npm run program:upgrade:check -- --plan PATH --artifact-dir PATH [--online] [--phase before|after] [--output NEW_PATH]';
export async function checkProgramUpgrade(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(UPGRADE_USAGE); return null; }
  const options = {};
  for (let i=0; i<args.length; i++) {
    const key = args[i];
    assert(!Object.hasOwn(options, key), 'Duplicate argument.');
    if (key === '--online') { options[key] = true; continue; }
    assert(['--plan', '--artifact-dir', '--phase', '--output'].includes(key)
      && args[i+1] && !args[i+1].startsWith('--'), UPGRADE_USAGE);
    options[key] = args[++i];
  }
  assert(options['--plan'] && options['--artifact-dir'], UPGRADE_USAGE);
  const planPath = await realpath(resolve(options['--plan']));
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  let connection;
  if (options['--online']) {
    // Explicit variable only; do not inherit deployment keys or app RPC defaults.
    const url = new URL(process.env.FUNDED_UPGRADE_RPC_URL || '');
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Set an HTTPS FUNDED_UPGRADE_RPC_URL.');
    connection = new Connection(url.href, {commitment:'finalized', disableRetryOnRateLimit:true,
      fetch:(target, init)=>fetch(target, {...init, signal:AbortSignal.timeout(15000)})});
  }
  const report = await assessProgramUpgrade(plan, {artifactDir:options['--artifact-dir'], connection, phase:options['--phase'] || 'before'});
  const json = JSON.stringify(report, null, 2) + '\n';
  if (options['--output']) {
    const output = resolve(options['--output']);
    await mkdir(dirname(output), {recursive:true});
    // Never overwrite a baseline, artifact, review or previous evidence report.
    await writeFile(output, json, {flag:'wx'});
  }
  console.log(json);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkProgramUpgrade(process.argv.slice(2)).then(report=>{
    if (report?.status === 'blocked') process.exitCode = 1;
  }).catch(()=>{
    console.error('Upgrade check failed: verify arguments, pinned artifacts/IDLs and the selected read-only RPC. No transactions were sent.');
    process.exitCode = 1;
  });
}
