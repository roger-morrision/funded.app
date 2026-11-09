const amount=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)?BigInt(value):null;

// Reserve is available operating capital, not authorization to spend more.
// Unknown setup/liquidity/canary amounts are never silently counted as zero.
export function assessMainnetFunding(plan,{lockedLamports,feeAllowanceLamports,marginLamports}) {
  const cap=amount(plan.maximumTotalSpendLamports),reserve=amount(plan.minimumOperatingReserveLamports);
  const missing=[];
  let known=BigInt(lockedLamports)+BigInt(feeAllowanceLamports)+BigInt(marginLamports);
  for(const field of ['initializationBudgetLamports','tokenLaunchAndLiquidityBudgetLamports','canaryBudgetLamports']) {
    const value=amount(plan[field]);
    if(value===null)missing.push(field);else known+=value;
  }
  if(cap===null)missing.push('maximumTotalSpendLamports');
  if(reserve===null)missing.push('minimumOperatingReserveLamports');
  const fits=cap===null?null:known<=cap;
  return {status:fits===false?'over-approved-cap':missing.length?'incomplete':'estimated-within-cap',
    approvedSpendCapLamports:cap===null?null:String(cap),knownMaximumSpendLamports:String(known),
    knownCostsWithinCap:fits,remainingUnderCapLamports:cap===null?null:String(cap-known),
    minimumOperatingReserveLamports:reserve===null?null:String(reserve),
    minimumFundingIncludingReserveLamports:reserve===null?null:String(known+reserve),
    missingEstimates:missing,finalTransactionFeesVerified:false,payerBalanceVerified:false,
    deploymentAuthorized:false};
}
