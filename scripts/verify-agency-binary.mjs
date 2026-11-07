import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {AGENCY_REVIEWED_BINARY,matchesAgencyBinary} from '../server/agency-release.mjs';

const path=process.argv[2];
assert(path,'Provide the compiled Devnet agency binary path.');
const binary=readFileSync(path),header=Buffer.alloc(45);
header.writeUInt32LE(3);header[12]=1;
assert.equal(binary.length,AGENCY_REVIEWED_BINARY.bytes,'Reviewed agency byte count is stale.');
assert(matchesAgencyBinary(Buffer.concat([header,binary])), 'Reviewed agency binary hash is stale.');
console.log('Compiled agency binary matches the app release commitment.');
