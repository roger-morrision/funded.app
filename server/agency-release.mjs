import {createHash} from 'node:crypto';
import {mainnetReleaseVerified} from './mainnet-program.mjs';

// Source-built with platform-tools v1.54 and the devnet-v3-program feature.
// The loader header/upgrade slot is excluded from this binary commitment;
// callers separately pin the complete finalized ProgramData account hash.
// 2026-11-17: Devnet router rebuilt from commit 37675b6f (same behavior as the
// 2026-11-13 paired-coin build; only embedded source line numbers differ),
// upgraded in place at slot 523202478 at the owner's request. Devnet only.
export const AGENCY_REVIEWED_BINARY=Object.freeze({bytes:1066000,
  sha256:'7a324118e2d4202b7deeae31ad8673d4d48dd2e380e37da513b1cce8481f8d05'});
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
