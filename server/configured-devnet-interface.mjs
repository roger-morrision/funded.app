import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PublicKey} from '@solana/web3.js';
import {readProgramDataEvidence} from './program-data-evidence.mjs';

// Explicit input for the offline unsigned integration harness. No environment
// selector, HTTP request field or signing-service bootstrap enables this path.
const expected = Object.freeze(JSON.parse(readFileSync(new URL('../config/configured-devnet-interface.json', import.meta.url))));
const hash = value => createHash('sha256').update(JSON.stringify(Object.keys(value).sort().map(k => [k, value[k]]))).digest('hex');
const expectedHash = hash(expected);
export function configuredDevnetInterface() { return Object.freeze({...expected, contextHash:expectedHash}); }
export function requireConfiguredDevnet(context, {cluster, programId, programDataSha256, upgradeAuthority} = {}) {
  assert(cluster === 'devnet' && context?.contextHash === expectedHash, 'Unapproved offline interface context.');
  for (const name of Object.keys(expected)) assert(context[name] === expected[name], 'Changed interface context: ' + name);
  assert(String(programId) === expected.programId, 'Interface program differs.');
  if (programDataSha256 !== undefined) assert(programDataSha256 === expected.programDataSha256, 'Interface ProgramData differs.');
  if (upgradeAuthority !== undefined) assert(upgradeAuthority === expected.upgradeAuthority, 'Interface authority differs.');
  return context;
}
export async function verifyConfiguredDevnet(connection, context, programId) {
  requireConfiguredDevnet(context, {cluster:'devnet', programId});
  assert(await connection.getGenesisHash() === expected.genesisHash, 'Interface RPC genesis differs.');
  const evidence = await readProgramDataEvidence(connection, new PublicKey(programId), {cluster:'devnet', rpcUrl:''});
  assert(evidence.account?.executable && evidence.programDataAddress === expected.programDataAddress
    && evidence.sha256 === expected.programDataSha256, 'Interface deployed bytes differ.');
  return context;
}
