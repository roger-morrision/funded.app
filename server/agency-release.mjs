import {createHash} from 'node:crypto';

// Source-built with platform-tools v1.54 and the devnet-v3-program feature.
// The loader header/upgrade slot is excluded from this binary commitment;
// callers separately pin the complete finalized ProgramData account hash.
export const AGENCY_REVIEWED_BINARY=Object.freeze({bytes:1043256,
  sha256:'5853367c900457e5314d423d1fb5fa70ab98606e1270ebda70dd21551d016905'});
export const AGENCY_DEVNET_PROGRAM='9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
export function matchesAgencyBinary(data,manifest=AGENCY_REVIEWED_BINARY){
  const bytes=Buffer.from(data||[]);
  return Number.isSafeInteger(manifest.bytes)&&manifest.bytes>0&&bytes.length>=45+manifest.bytes
    &&bytes.readUInt32LE(0)===3&&bytes[12]===1
    &&createHash('sha256').update(bytes.subarray(45,45+manifest.bytes)).digest('hex')===manifest.sha256
    &&bytes.subarray(45+manifest.bytes).every(byte=>byte===0);
}
export function agencyReleaseVerified(evidence,programId,approvedHash){
  return String(programId)===AGENCY_DEVNET_PROGRAM&&/^[a-f0-9]{64}$/.test(String(approvedHash))
    &&evidence?.sha256===approvedHash&&evidence.account?.executable===true
    &&matchesAgencyBinary(evidence.programData?.data);
}
