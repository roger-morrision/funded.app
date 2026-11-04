// Workers retain their periodic recovery scan and additionally react to durable
// verified-trade revisions. Read before the scan to avoid losing mid-scan trades.
export function createTradeWakePoll({intervalMs,now=Date.now}) {
  let revision=-1,lastRun=0;
  return async function shouldRun(read) {
    try {
      const result=await read();
      if(result.cluster!=='devnet'||!Number.isSafeInteger(result.revision)||result.revision<0)
        throw new Error('Invalid trade wake-up state.');
      const due=result.revision!==revision||now()-lastRun>=intervalMs;
      if(due){revision=result.revision;lastRun=now();}
      return due;
    } catch {const due=now()-lastRun>=intervalMs;if(due)lastRun=now();return due;}
  };
}
