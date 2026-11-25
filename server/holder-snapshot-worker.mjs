// Sampling has its own process so app restarts and slow payout signing cannot
// create holes in finalized holder history. This worker never signs or pays.
export function createHolderSnapshotWorker({store,indexer,now=Date.now}) {
  let running=null;
  async function capture() {
    const state=await store.read(),captured=[],failures=[];
    for(const config of Object.values(state.programs||{}).filter(row=>row.enabled)) {
      const at=Math.floor(now()/1000),last=state.holderSnapshots?.[config.mint]?.at(-1);
      if(last&&at-last.at<config.sampleIntervalSeconds)continue;
      try {captured.push(await indexer.capture(config.mint,now()));}
      catch {failures.push({mint:config.mint,reason:'finalized-holder-indexing-unavailable'});}
    }
    const result={status:failures.length?'degraded':'active',checkedAt:new Date(now()).toISOString(),
      captured:captured.length,failures};
    await store.transaction(current=>{current.holderIndexerStatus=result;});
    return result;
  }
  return {tick(){if(!running)running=capture().finally(()=>{running=null;});return running;}};
}
