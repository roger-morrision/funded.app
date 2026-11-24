import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertReviewCandidate} from '../../scripts/verify-mainnet-review-candidate.mjs';

const candidate = JSON.parse(readFileSync(new URL('../../config/mainnet-review-candidate.json', import.meta.url)));
const actual = {
  ...structuredClone(candidate), selectedProgramId:candidate.programId,
  currentRevision:'1'.repeat(40), sourceRevision:'1'.repeat(40),
  currentTree:'2'.repeat(40), sourceTree:'2'.repeat(40), sourceStatus:'',
  lockfileSha256:'3'.repeat(64), currentLockfileSha256:'3'.repeat(64),
};
test('current candidate accepts identical contract bytes with current full source provenance', () => {
  assert.doesNotThrow(()=>assertReviewCandidate(candidate,actual));
  assert.equal(candidate.deployEligible,false);
});
test('candidate verifier rejects source, compiler, binary, identity and build-input drift', () => {
  for (const [field,value] of Object.entries({contractTree:'4'.repeat(40),programId:'other',selectedProgramId:'other',
    conversionPools:'',binary:{...candidate.binary,sha256:'0'.repeat(64)},compilerSha256:'0'.repeat(64),
    buildSettings:[],sourceRevision:'0'.repeat(40),sourceTree:'0'.repeat(40),sourceStatus:' M changed',lockfileSha256:'0'.repeat(64)}))
    assert.throws(()=>assertReviewCandidate(candidate,{...actual,[field]:value}),undefined,field);
  assert.throws(()=>assertReviewCandidate({...candidate,deployEligible:true},actual));
});
