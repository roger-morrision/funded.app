const amount=(raw,fallback)=>{
  const value=String(raw??fallback);
  if(!/^[1-9]\d{0,15}$/.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Buyback spend caps must be positive safe lamport amounts.');
  return BigInt(value);
};
export function buybackExecutionPolicy(env=process.env) {
  const maxWaitSeconds=Number(env.FUNDED_V3_BUYBACK_MAX_WAIT_SECONDS||0);
  const minimumWait=env.SOLANA_CLUSTER==='devnet'&&env.FUNDED_DEVNET_QA_MINIMUMS_ENABLED==='true'?300:3600;
  if(!Number.isSafeInteger(maxWaitSeconds)||maxWaitSeconds!==0&&(maxWaitSeconds<minimumWait||maxWaitSeconds>604800))
    throw new Error('Buyback maximum wait is disabled or between the supported minimum and seven days.');
  return {maxWaitSeconds,ageMinimumLamports:amount(env.FUNDED_V3_BUYBACK_AGE_MIN_LAMPORTS,10_000_000),
    maxOrderLamports:amount(env.FUNDED_V3_BUYBACK_MAX_ORDER_LAMPORTS,1_000_000_000),
    dailyCapLamports:amount(env.FUNDED_V3_BUYBACK_DAILY_CAP_LAMPORTS,5_000_000_000)};
}
export function buybackAgeEligible(state,row,policy,now=Date.now()) {
  if(!policy.maxWaitSeconds||!/^[1-9]\d*$/.test(String(row.amountLamports||''))
    ||BigInt(row.amountLamports)<policy.ageMinimumLamports)return false;
  const settlements=row.sourceCollectionSignature==='aggregate'
    ? Object.values(state.v3Settlements||{}).filter(item=>item.mint===row.mint&&item.status==='finalized')
    : [state.v3Settlements?.[row.sourceCollectionSignature]];
  return settlements.length>0&&settlements.every(item=>{
    const at=Date.parse(item?.finalizedAt);
    return item?.status==='finalized'&&Number.isFinite(at)&&now>=at&&now-at>=policy.maxWaitSeconds*1000;
  });
}
export function remainingBuybackDailyBudget(state,programId,policy,now=Date.now()) {
  const start=Math.floor(now/86400_000)*86400_000;let used=0n;
  for(const row of Object.values(state.v3BuybackOrders||{})) {
    if(row.programId!==programId||!row.signature)continue;
    if(row.status==='finalized') {
      if(row.finalized!==true||row.vaultDebitVerified!==true||row.burnInstructionVerified!==true)
        throw new Error('A finalized buyback is missing its spending proof.');
      const at=Date.parse(row.burnedAt||row.finalizedAt);
      if(!Number.isFinite(at)||at>=start)used+=BigInt(row.spentLamports);
    }else used+=BigInt(row.maxTotalDebit);
  }
  return used>=policy.dailyCapLamports?0n:policy.dailyCapLamports-used;
}
