// Native SOL already in the canonical WSOL ATA is returned to the vault on
// close. It is a donation, not a reduction in the purchase charged to policy.
export function buybackVaultSpend({before,after,curve,quoteBefore,quoteAfter,quoteClosed}) {
  const valid=value=>Number.isSafeInteger(value)&&value>=0;
  if(!valid(before)||!valid(after))return null;
  if(!curve&&(!valid(quoteBefore)||quoteAfter!==0||!quoteClosed))return null;
  const spent=BigInt(before)+(curve?0n:BigInt(quoteBefore))-BigInt(after);
  return spent>0n?spent:null;
}
