#!/usr/bin/env node
// Prints one unsigned protocol-guard instruction as JSON, for import into the
// program upgrade owner wallet or the offline guardian to sign. It loads no
// key, makes no RPC call and sends nothing.
//
//   node scripts/protocol-guard-instruction.mjs configure <program> <upgradeOwner> <guardian> <dailyCapLamports>
//   node scripts/protocol-guard-instruction.mjs pause     <program> <guardianOrOwner>
//   node scripts/protocol-guard-instruction.mjs unpause   <program> <upgradeOwner>
//   node scripts/protocol-guard-instruction.mjs cancel    <program> <guardianOrOwner> <reserve> <cycle>
import { buildCancelRewardCycle, buildConfigureProtocolGuard, buildSetProtocolPause } from '../protocol-guard.js';

const [action, programId, signer, ...rest] = process.argv.slice(2);
const usage = () => { console.error('Usage: protocol-guard-instruction.mjs configure|pause|unpause|cancel <program> <signer> [...]'); process.exit(2); };
if (!action || !programId || !signer) usage();

let instruction;
if (action === 'configure' && rest.length === 2) {
  const [guardian, dailyCapLamports] = rest;
  if (!/^\d+$/.test(dailyCapLamports)) usage();
  instruction = buildConfigureProtocolGuard({ programId, upgradeOwner: signer, guardian, dailyCapLamports });
} else if ((action === 'pause' || action === 'unpause') && rest.length === 0) {
  instruction = buildSetProtocolPause({ programId, signer, paused: action === 'pause' });
} else if (action === 'cancel' && rest.length === 2) {
  instruction = buildCancelRewardCycle({ programId, signer, reserve: rest[0], cycle: rest[1] });
} else usage();

console.log(JSON.stringify({
  action,
  programId: instruction.programId.toBase58(),
  accounts: instruction.keys.map(key => ({ pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable })),
  dataBase64: instruction.data.toString('base64'),
  note: 'Unsigned. Review the accounts and data before the upgrade owner or guardian signs.',
}, null, 2));
