export async function estimateBuybackComputeBudget(connection,transaction,{maxPriorityLamports=10000}={}) {
  if(!Number.isSafeInteger(maxPriorityLamports)||maxPriorityLamports<0||maxPriorityLamports>100000)
    throw new Error('Priority fee cap is outside the supported range.');
  const simulated=await connection.simulateTransaction(transaction,{sigVerify:false,replaceRecentBlockhash:true,
    commitment:'confirmed'});
  const units=simulated?.value?.unitsConsumed;
  if(simulated?.value?.err||!Number.isSafeInteger(units)||units<=0||Math.ceil(units*1.15)>1400000)
    throw new Error('Buyback simulation did not establish a safe compute budget.');
  const computeUnitLimit=Math.max(10000,Math.ceil(units*1.15));
  const writable=transaction.message.staticAccountKeys.filter((_,index)=>transaction.message.isAccountWritable(index)).slice(0,128);
  const observations=await connection.getRecentPrioritizationFees({lockedWritableAccounts:writable});
  const fees=observations.map(row=>row.prioritizationFee).filter(value=>Number.isSafeInteger(value)&&value>=0).sort((a,b)=>a-b);
  const observed=fees.length?fees[Math.floor((fees.length-1)*0.75)]:0;
  const computeUnitPriceMicroLamports=Math.min(observed,Math.floor(maxPriorityLamports*1e6/computeUnitLimit));
  return {computeUnitLimit,computeUnitPriceMicroLamports};
}
