import assert from 'node:assert/strict';
import {readFile, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute, relative, resolve} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {inspectUpgradeability} from './program-upgradeability.mjs';
import {compareProgramInterfaces} from './program-upgrade-compatibility.mjs';

export const UPGRADE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const publicKey = value => {
  assert(typeof value === 'string' && new PublicKey(value).toBase58() === value
    && value !== PublicKey.default.toBase58(), 'Expected an explicit nonzero public key.');
  return new PublicKey(value);
};

async function loadRelease(root, release) {
  assert(revision(release?.sourceRevision), 'Release needs a full source revision.');
  const load = async entry => {
    assert(typeof entry?.file === 'string' && entry.file.length > 0 && hash(entry.sha256), 'Missing artifact file/hash.');
    const file = await realpath(resolve(root, entry.file)), part = relative(root, file);
    assert(part && part !== '..' && !part.startsWith('../') && !part.startsWith('..\\') && !isAbsolute(part),
      'Artifact must stay inside the selected artifact directory, including symlinks.');
    const bytes = await readFile(file);
    assert.equal(sha256(bytes), entry.sha256, 'Artifact hash differs from the release manifest.');
    return bytes;
  };
  const binary = await load(release.binary), idlBytes = await load(release.idl);
  assert(Number.isSafeInteger(release.binary.bytes) && release.binary.bytes >= 64
    && release.binary.bytes <= 10 * 1024 * 1024 && release.binary.bytes === binary.length, 'Invalid binary size.');
  assert(binary.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])), 'Expected compiled ELF bytes.');
  return {binary, idl:JSON.parse(idlBytes.toString('utf8'))};
}

// Reads both accounts from one finalized RPC context; no cache or signer lookup.
export async function readUpgradeSnapshot(connection, {cluster, programId}) {
  assert(['devnet', 'mainnet-beta'].includes(cluster), 'Select Devnet or Mainnet explicitly.');
  assert.equal(await connection.getGenesisHash(), SOLANA_GENESIS[cluster], 'RPC network differs from upgrade plan.');
  const key = publicKey(programId), address = PublicKey.findProgramAddressSync([key.toBuffer()], UPGRADE_LOADER)[0];
  const minContextSlot = await connection.getSlot('finalized');
  assert(Number.isSafeInteger(minContextSlot) && minContextSlot > 0, 'Invalid finalized tip.');
  const result = await connection.getMultipleAccountsInfoAndContext([key, address], {commitment:'finalized', minContextSlot});
  assert(Number.isSafeInteger(result?.context?.slot) && result.context.slot >= minContextSlot
    && Array.isArray(result.value) && result.value.length === 2, 'Invalid finalized RPC context.');
  const [account, programData] = result.value;
  return {account, programData, programDataAddress:address.toBase58(), finalizedSlot:result.context.slot,
    sha256:programData ? sha256(programData.data) : null};
}

function matchesExecutable(programData, binary) {
  const bytes = programData?.data;
  return Boolean(bytes && bytes.length >= 45 + binary.length
    && Buffer.from(bytes.subarray(45,45 + binary.length)).equals(binary)
    && bytes.subarray(45 + binary.length).every(byte => byte === 0));
}

export async function assessProgramUpgrade(plan, {artifactDir, connection, phase='before', now=()=>new Date()}={}) {
  assert.equal(plan?.schemaVersion, 1);
  assert.equal(plan.upgradeable, true, 'Full code upgradeability must be retained.');
  assert(['before', 'after'].includes(phase), 'Phase must be before or after.');
  assert(['devnet', 'mainnet-beta'].includes(plan.cluster), 'Select Devnet or Mainnet explicitly.');
  publicKey(plan.programId); publicKey(plan.upgradeAuthority);
  assert(hash(plan.baseline?.programDataSha256), 'Pin the complete baseline ProgramData hash.');
  assert(typeof plan.baseline.deploymentSlot === 'string' && /^\d+$/.test(plan.baseline.deploymentSlot)
    && BigInt(plan.baseline.deploymentSlot) <= BigInt(Number.MAX_SAFE_INTEGER), 'Pin the baseline deployment slot as a decimal string.');
  const root = await realpath(resolve(artifactDir));
  const [baseline, candidate] = await Promise.all([loadRelease(root, plan.baseline), loadRelease(root, plan.candidate)]);
  assert.equal(baseline.idl.address, plan.programId, 'Baseline IDL has the wrong program identity.');
  assert.equal(candidate.idl.address, plan.programId, 'Candidate IDL has the wrong program identity.');
  const compatibility = compareProgramInterfaces(baseline.idl, candidate.idl);
  const report = {schemaVersion:1, status:'local-only', ready:false, deploymentAuthorized:false, phase,
    checkedAt:now().toISOString(), cluster:plan.cluster, programId:plan.programId, upgradeAuthority:plan.upgradeAuthority,
    baseline:plan.baseline, candidate:plan.candidate, compatibility, chain:null,
    remainingGates:[
      'Bind ELF and IDL to the same reproducible build, feature flags, source revision and program identity; manifest declarations are not build provenance.',
      'Review raw router headers, PDA seeds, account sizes, saved policies, balances, escrow times and economic/authorization changes; IDL does not describe all program state.',
      'Execute old-state compatibility, custody and financial-path tests against the exact candidate, then rehearse the upgrade with synthetic local/Devnet fixtures.',
      'Review exact upgrade messages, authority custody, capacity, rent and fees; obtain deployment approval separately.',
      'After upgrade, verify finalized bytes and expected state/balance deltas, refresh the release ProgramData hash and align clients/workers before resuming writes.',
    ]};
  if (compatibility.breaking.length) report.status = 'blocked';
  if (!connection) return report;
  const evidence = await readUpgradeSnapshot(connection, plan);
  // After upgrade the header contains a new slot. Its full hash is an OUTPUT
  // for release admission; executable bytes and authority are independently pinned.
  const inspection = inspectUpgradeability(evidence, {programId:plan.programId, authority:plan.upgradeAuthority,
    hash:phase === 'before' ? plan.baseline.programDataSha256 : evidence.sha256});
  const deployedSlot = evidence.programData?.data?.length >= 12
    ? Buffer.from(evidence.programData.data).readBigUInt64LE(4) : null;
  const allocatedBytes = Math.max(0, (evidence.programData?.data?.length || 0) - 45);
  const checks = {...inspection.checks,
    executableMatches:matchesExecutable(evidence.programData, phase === 'before' ? baseline.binary : candidate.binary),
    sufficientCapacity:allocatedBytes >= candidate.binary.length,
    deploymentSlotMatches:deployedSlot !== null && (phase === 'before'
      ? deployedSlot === BigInt(plan.baseline.deploymentSlot) : deployedSlot > BigInt(plan.baseline.deploymentSlot)),
    finalizedDeployment:deployedSlot !== null && deployedSlot < BigInt(evidence.finalizedSlot)};
  report.chain = {checks, finalizedSlot:evidence.finalizedSlot, deploymentSlot:deployedSlot?.toString() ?? null,
    programDataAddress:evidence.programDataAddress, programDataSha256:evidence.sha256,
    allocatedBytes, additionalBytesRequired:Math.max(0, candidate.binary.length - allocatedBytes),
    observedUpgradeAuthority:inspection.upgradeAuthority};
  report.status = compatibility.breaking.length || !Object.values(checks).every(Boolean) ? 'blocked'
    : phase === 'before' ? 'preflight-passed' : 'post-upgrade-bytes-verified';
  return report;
}
