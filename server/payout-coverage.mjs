const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const PAYOUT_COVERAGE_SCOPE = 'v3-sol-recipient-receipts';

// A receipt is one transaction/recipient balance change. Recovered reward PDAs
// bridge a saved account-only record to its subsequently discovered transaction.
export function payoutCoverage(recorded, verified) {
  const parents = new Map();
  const root = key => {
    if (!parents.has(key)) parents.set(key,key);
    if (parents.get(key) !== key) parents.set(key,root(parents.get(key)));
    return parents.get(key);
  };
  const aliases = row => {
    const recipient = row.to || row.recipient;
    if (!address.test(String(recipient || ''))) return [];
    return [signature.test(String(row.signature || '')) ? `tx:${row.signature}:${recipient}` : null,
      address.test(String(row.paymentAccount || '')) ? `account:${row.paymentAccount}:${recipient}` : null].filter(Boolean);
  };
  const inputs = [...recorded,...verified].map(row=>({row,keys:aliases(row)}));
  for (const {keys} of inputs) for (const key of keys) parents.set(root(key),root(keys[0]));
  const recordedKeys = new Set(inputs.slice(0,recorded.length).flatMap(({keys})=>keys.length?[root(keys[0])]:[]));
  const verifiedRows = inputs.slice(recorded.length), amounts = new Map();
  let reason = inputs.some(({keys})=>!keys.length) ? 'A recorded or verified receipt has no stable payout identity.' : null;
  let totalValid = true;
  for (const {row,keys} of verifiedRows) {
    if (!keys.length) {totalValid=false;continue;}
    const id=root(keys[0]), amount=String(row.amountLamports);
    if (!recordedKeys.has(id)) reason ||= 'A verified receipt is outside the recorded payout scope.';
    if (!/^(0|[1-9]\d*)$/.test(amount) || amounts.has(id) && amounts.get(id) !== amount) {
      totalValid=false;
      reason ||= 'Duplicate receipt evidence has conflicting or unavailable amounts.';
    }
    amounts.set(id,amount);
  }
  return { scope:PAYOUT_COVERAGE_SCOPE, status:reason ? 'unavailable' : amounts.size === recordedKeys.size ? 'verified' : 'partial',
    recorded:reason ? null : recordedKeys.size, verified:reason ? null : amounts.size, reason,
    verifiedTotalLamports:totalValid ? String([...amounts.values()].reduce((sum,value)=>sum+BigInt(value),0n)) : null };
}
