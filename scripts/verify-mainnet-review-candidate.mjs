import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function assertReviewCandidate(candidate, actual) {
  assert.equal(candidate.schemaVersion, 1);
  assert.equal(candidate.deployEligible, false);
  assert.equal(candidate.status, 'awaiting-independent-review');
  assert.match(candidate.sourceRevision, /^[a-f0-9]{40}$/);
  assert.equal(actual.contractTree, candidate.contractTree, 'Contract source differs from the candidate');
  assert.equal(actual.programId, candidate.programId, 'Program identity differs');
  assert.equal(actual.selectedProgramId, candidate.programId, 'Deployment plan selects a different identity');
  assert.equal(actual.conversionPools, candidate.conversionPools, 'Conversion pools differ');
  assert.deepEqual(actual.binary, candidate.binary, 'Compiled bytecode differs');
  assert.equal(actual.compilerSha256, candidate.compilerSha256, 'Compiler differs');
  assert.deepEqual(actual.buildSettings, candidate.buildSettings, 'Build settings differ');
  assert.equal(actual.sourceRevision, actual.currentRevision, 'Artifact is from another revision');
  assert.equal(actual.sourceTree, actual.currentTree, 'Artifact is from another full source tree');
  assert.equal(actual.sourceStatus, '', 'Build source was dirty');
  assert.equal(actual.lockfileSha256, actual.currentLockfileSha256, 'Lockfile differs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, ...extra] = process.argv.slice(2);
  assert(directory && !extra.length, 'Usage: node scripts/verify-mainnet-review-candidate.mjs ARTIFACT_DIRECTORY');
  const root = resolve(import.meta.dirname, '..');
  const read = name => readFileSync(resolve(directory, name), 'utf8').trim();
  const git = ref => execFileSync('git', ['-C', root, 'rev-parse', ref], {encoding:'utf8'}).trim();
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const candidate = JSON.parse(readFileSync(resolve(root, 'config/mainnet-review-candidate.json')));
  const plan = JSON.parse(readFileSync(resolve(root, 'config/mainnet-deployment-plan.json')));
  const bytes = readFileSync(resolve(directory, 'funded_fee_router.so'));
  assert.equal(bytes.subarray(0,4).toString('hex'), '7f454c46', 'Expected ELF bytecode');
  assertReviewCandidate(candidate, {
    contractTree:git('HEAD:contracts/funded-fee-router'), selectedProgramId:plan.mainnetProgramId,
    programId:read('program-id.txt'), conversionPools:read('conversion-pools.txt'),
    binary:{bytes:bytes.length,sha256:sha(bytes)}, compilerSha256:read('compiler.sha256').split(/\s/)[0],
    buildSettings:read('build-settings.txt').split(/\r?\n/), sourceRevision:read('source-revision.txt'),
    sourceTree:read('source-tree.txt'), sourceStatus:read('source-status.txt'),
    currentRevision:git('HEAD'), currentTree:git('HEAD^{tree}'),
    lockfileSha256:read('lockfile.sha256').split(/\s/)[0],
    currentLockfileSha256:sha(readFileSync(resolve(root, 'contracts/funded-fee-router/Cargo.lock'))),
  });
  console.log('Current contract candidate reproduced with exact build provenance. Independent review and deployment authorization remain pending.');
}
