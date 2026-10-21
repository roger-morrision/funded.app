import {Buffer} from 'buffer';
import {DEFAULT_AGENCY_RULES,validateAgencyRules} from './config/agency-rules.js';
export const AGENCY_RULES_BYTES=40;
const MAGIC=Buffer.from('FUNDRUL1');
export function encodeAgencyRules(input=DEFAULT_AGENCY_RULES){
  const rules=validateAgencyRules(input),data=Buffer.alloc(40);MAGIC.copy(data);
  rules.marketCapUsd.forEach((value,i)=>data.writeBigUInt64LE(BigInt(value)*1000000n,8+i*8));
  data.writeBigInt64LE(BigInt(rules.communityWindowSeconds),24);data.writeBigInt64LE(BigInt(rules.promotionIntervalSeconds),32);
  return data;
}
export function decodeAgencyRules(data,base){
  if(data.length===base)return{...validateAgencyRules(DEFAULT_AGENCY_RULES),source:'legacy-defaults'};
  if(data.length!==base+40||!data.subarray(base,base+8).equals(MAGIC))throw new Error('Invalid on-chain agency settings extension.');
  const caps=[data.readBigUInt64LE(base+8),data.readBigUInt64LE(base+16)];
  if(caps.some(n=>n%1000000n!==0n))throw new Error('Agency thresholds must use exact whole USD values.');
  return{...validateAgencyRules({marketCapUsd:caps.map(n=>Number(n/1000000n)),
    communityWindowSeconds:Number(data.readBigInt64LE(base+24)),promotionIntervalSeconds:Number(data.readBigInt64LE(base+32))}),source:'on-chain-snapshot'};
}
