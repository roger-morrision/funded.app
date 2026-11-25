import {createHash} from 'node:crypto';
import {mainnetReleaseVerified} from './mainnet-program.mjs';
import {configuredDevnetProgram} from '../configured-devnet-program.js';

// Source-built with platform-tools v1.54 and the devnet-v3-program feature.
// The loader header/upgrade slot is excluded from this binary commitment;
// callers separately pin the complete finalized ProgramData account hash.
// 2026-11-25: Latest Devnet build, reproduced by CI run 45339137899.
// The app must pin this exact compiled artifact before enabling its payout worker.
export const AGENCY_REVIEWED_BINARY=Object.freeze({bytes:1170056,
  sha256:'8846d6e61644db50a941b11a8dafc9b6eb6da5c91578f6a116605ff4048d55aa'});
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
  const configured=configuredDevnetProgram(cluster,programId);
  if(configured)return approvedHash===configured.programDataSha256&&evidence?.sha256===approvedHash
    &&evidence.account?.executable===true&&matchesAgencyBinary(evidence.programData?.data,configured);
  return String(programId)===AGENCY_DEVNET_PROGRAM&&/^[a-f0-9]{64}$/.test(String(approvedHash))
    &&evidence?.sha256===approvedHash&&evidence.account?.executable===true
    &&matchesAgencyBinary(evidence.programData?.data);
}
