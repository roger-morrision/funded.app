const evidenceStates=['recorded-finalized-v3','onchain-indexed','partial','no-records'];

export function missingFinancialSources(experience,buybacks,overviews=[],wallet=''){
  const rewardsReady=experience?.available&&experience.data?.cluster==='devnet'&&evidenceStates.includes(experience.data.evidence?.status)&&(!wallet||experience.data.wallet?.address===wallet);
  const burnsReady=buybacks?.available&&buybacks.data?.cluster==='devnet'&&Array.isArray(buybacks.data.pending)&&Array.isArray(buybacks.data.receipts);
  const approvalsMissing=overviews.some(row=>!row?.available||row.data?.cluster!=='devnet'||row.data.overview?.available!==true||row.data.overview?.scope!=='per-mint-v3');
  return[!rewardsReady&&'rewards',!burnsReady&&'buybacks',approvalsMissing&&'creator approvals'].filter(Boolean);
}

export function financialEmptyMessage(hasRows,missing=[]){
  if(hasRows)return{kind:'filtered',title:'No records match these filters.',note:'Adjust the search, dates or status, or clear filters to see all loaded activity.'};
  if(missing.length)return{kind:'unavailable',title:'Activity data is unavailable.',note:'Unavailable data is not a zero balance. Refresh activity to try again.'};
  return{kind:'empty',title:'No recorded activity yet.',note:'The checked sources returned no payment or burn records. Check each program for eligibility and funding.'};
}
