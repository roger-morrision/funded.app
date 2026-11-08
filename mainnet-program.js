import {PublicKey} from '@solana/web3.js';
import manifest from './config/mainnet-program-release.json' with {type:'json'};
import {DEVELOPER_TOKEN_LOCK_PERIODS} from './developer-lock-period.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const supplied=value=>typeof value==='string'&&value.trim().length>0&&!/REPLACE|PLACEHOLDER/i.test(value);
const forbidden=new Set(['EPywNBhXu8QEeukKfwKwo7WPBw6KoSbUGyKgcMFPH9pT',
  '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm','61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa',
  '3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh','11111111111111111111111111111111']);
const forbiddenAssets=new Set([...forbidden,'C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64',
  'EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32','3uWi9x2SRpmjztkpkr2WWeBoVq3exjXG2YfDWLvm8KsQ',
  '3yS1JFVT284y8z1LC9MRoWxZjzFrdoD5axKsZiyMsfC7']);
// Public, committed review evidence only. Environment flags cannot trust a new binary.
export function reviewedMainnetManifest(value=manifest){
  try{
    const program=new PublicKey(value.programId).toBase58(),authority=new PublicKey(value.upgradeAuthority).toBase58();
    const mint=new PublicKey(value.fundedMint).toBase58(),pool=new PublicKey(value.fundedPool).toBase58();
    const review=value.independentReview,binary=value.binary;
    if(value.schemaVersion!==1||value.cluster!=='mainnet-beta'||value.status!=='reviewed'
      ||forbidden.has(program)||forbidden.has(authority)||program===authority
      ||forbiddenAssets.has(mint)||forbiddenAssets.has(pool)||new Set([program,authority,mint,pool]).size!==4
      ||!hash(value.programDataSha256)||!revision(value.sourceRevision)
      ||!Number.isSafeInteger(binary?.bytes)||binary.bytes<4||!hash(binary.sha256)
      ||!supplied(review?.reviewer)||!supplied(review?.reference)
      ||review.sourceRevision!==value.sourceRevision||review.binarySha256!==binary.sha256
      ||JSON.stringify(value.developerLockPeriodsSeconds)!==JSON.stringify(DEVELOPER_TOKEN_LOCK_PERIODS))return null;
    return value;
  }catch{return null;}
}
export const MAINNET_REVIEWED_PROGRAM_ID=reviewedMainnetManifest()?.programId||null;
