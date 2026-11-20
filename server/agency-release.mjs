import {createHash} from 'node:crypto';
import {mainnetReleaseVerified} from './mainnet-program.mjs';

// Source-built with platform-tools v1.54 and the devnet-v3-program feature.
// The loader header/upgrade slot is excluded from this binary commitment;
// callers separately pin the complete finalized ProgramData account hash.
// 2026-11-20: Devnet-only category-5 paired-token conversion for SOL Daily bonuses.
// The app must pin this exact compiled artifact before enabling its payout worker.
export const AGENCY_REVIEWED_BINARY=Object.freeze({bytes:1168496,
  sha256:'c320a6139dbcba2daa9ab3e04e0e13435b6ea6ba9a80538097c7c25681298a15'});
export const AGENCY_DEVNET_PROGRAM='9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
export function matchesAgencyBinary(data,manifest=AGENCY_REVIEWED_BINARY){
  const bytes=Buffer.from(data||[]);
  return Number.isSafeInteger(manifest.bytes)&&manifest.bytes>0&&bytes.length>=45+manifest.bytes
    &&bytes.readUInt32LE(0)===3&&bytes[12]===1
    &&createHash('sha256').update(bytes.subarray(45,45+manifest.bytes)).digest('hex')===manifest.sha256
    &&bytes.subarray(45+manifest.bytes).every(byte=>byte===0);
}
export function agencyReleaseVerified(evidence,programId,approvedHash,{cluster='devnet'}={}){
  if(cluster==='mainnet-beta')return mainnetReleaseVerified(evidence,programId,approvedHash);
  if(cluster!=='devnet')return false;
  return String(programId)===AGENCY_DEVNET_PROGRAM&&/^[a-f0-9]{64}$/.test(String(approvedHash))
    &&evidence?.sha256===approvedHash&&evidence.account?.executable===true
    &&matchesAgencyBinary(evidence.programData?.data);
}
