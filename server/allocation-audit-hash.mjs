import {createHash} from 'node:crypto';

// PostgreSQL jsonb reorders object keys. Audit identities must survive that
// persistence boundary while preserving array order and every exact value.
// Keep this separate from historical file-ledger bonus snapshot hashing.
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export const allocationAuditHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
