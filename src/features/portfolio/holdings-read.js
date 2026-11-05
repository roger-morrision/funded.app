const transient = error => /429|502|503|504|rate.limit|busy|timeout|timed.out|fetch failed|failed to fetch|network/i.test(String(error?.message || ''));

export function portfolioLookupReason(error) {
  const message=String(error?.message||'');
  if(/429|rate.limit|busy/i.test(message))return 'The network is busy. Wait a moment, then refresh.';
  if(/timeout|timed.out|fetch failed|failed to fetch|network|502|503|504/i.test(message))return 'The network did not respond. Check your connection and refresh.';
  return 'Balances could not be verified. This does not mean your wallet is empty. Select Refresh to retry.';
}

export async function readPortfolioTokenAccounts(rpc,owner,programs,isCurrent,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  return Promise.allSettled(programs.map(async programId=>{
    const read=()=>rpc.getParsedTokenAccountsByOwner(owner,{programId},'confirmed');
    try { return await read(); }
    catch(error) {
      if(!transient(error)||!isCurrent())throw error;
      await wait(1200);
      if(!isCurrent())throw error;
      return read(); // One retry per failed program; never re-read a successful one.
    }
  }));
}
