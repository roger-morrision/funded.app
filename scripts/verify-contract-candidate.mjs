import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {AGENCY_REVIEWED_BINARY} from '../server/agency-release.mjs';

// Candidate reproducibility is separate from deployment authorization. Do not
// change the runtime commitment merely to make a new contract build pass CI.
const manifest=JSON.parse(readFileSync(new URL('../config/contract-build-candidates.json',import.meta.url),'utf8'));
assert.equal(manifest.deployEligible,false);
assert.deepEqual(AGENCY_REVIEWED_BINARY,manifest.retainedDevnetRuntimeCommitment,
  'Runtime trust changed independently of the recorded candidate. Review the release explicitly.');
const [path,variant='devnet',...extra]=process.argv.slice(2);
assert(path && !extra.length && ['devnet','productionBuildCheck'].includes(variant),
  'Usage: node scripts/verify-contract-candidate.mjs BINARY [devnet|productionBuildCheck]');
const expected=manifest[variant],bytes=readFileSync(path);
assert.equal(bytes.subarray(0,4).toString('hex'),'7f454c46','Expected ELF bytecode');
assert.equal(bytes.length,expected.bytes,'Candidate size differs from recorded evidence');
assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,'Candidate bytecode differs from recorded evidence');
console.log(`${variant} candidate reproduced; deployed Devnet trust unchanged; deployment not authorized.`);
