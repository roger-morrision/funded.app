import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {matchesAgencyBinary,agencyReleaseVerified,AGENCY_DEVNET_PROGRAM} from '../server/agency-release.mjs';
test('reviewed agency binary commitment ignores loader slot and zero padding, rejecting any executable-byte or trailing mutation',()=>{
  const code=Buffer.from('synthetic reviewed bytecode'),manifest={bytes:code.length,sha256:createHash('sha256').update(code).digest('hex')};
  const data=Buffer.alloc(45+code.length+64);data.writeUInt32LE(3);data[12]=1;code.copy(data,45);
  assert.equal(matchesAgencyBinary(data,manifest),true);data.writeBigUInt64LE(123456n,4);assert.equal(matchesAgencyBinary(data,manifest),true);
  data[45]^=1;assert.equal(matchesAgencyBinary(data,manifest),false);data[45]^=1;
  data[data.length-1]=1;assert.equal(matchesAgencyBinary(data,manifest),false);
  assert.equal(agencyReleaseVerified({sha256:'a'.repeat(64),account:{executable:true},programData:{data}},AGENCY_DEVNET_PROGRAM,'a'.repeat(64)),false);
});
