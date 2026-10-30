// A trade is a wake-up hint, never an entitlement, settlement or payment proof.
// The durable revision lets independent workers recover missed notifications.
export const TRADE_WAKE_VERSION = 'finalized-trade-wakeup-v1';
export async function recordTradeWake(store, trade, now = Date.now()) {
  return store.transaction(state => {
    const ledger = state.tradeFinancialWake ||= { version:TRADE_WAKE_VERSION, revision:0, events:{} };
    const key = `${trade.signature}:${trade.mint}`;
    if (ledger.events[key]) return { recorded:false, revision:ledger.revision };
    for (const [id,event] of Object.entries(ledger.events))
      if (now-event.receivedAt > 7*86400_000) delete ledger.events[id];
    if (Object.keys(ledger.events).length >= 10_000)
      throw Object.assign(new Error('Trade processing queue is busy; retry later.'),{statusCode:503});
    ledger.revision += 1;
    ledger.events[key] = { signature:trade.signature, mint:trade.mint, slot:trade.slot,
      receivedAt:now, revision:ledger.revision };
    ledger.updatedAt = new Date(now).toISOString();
    return { recorded:true, revision:ledger.revision };
  });
}

export function tradeWakeStatus(state) {
  const row = state.tradeFinancialWake;
  return { version:TRADE_WAKE_VERSION, revision:row?.revision || 0,
    updatedAt:row?.updatedAt || null, trigger:'finalized-trade',
    semantics:'process-eligible-funded-obligations',
    changesRewardEligibility:false, atomicWithTrade:false };
}

// Coalesce bursts. A revision arriving during a run is handled on the next poll.
export function startTradeFinancialWakeWorker({ store, run, logger=console,
  scheduleInterval=setInterval }) {
  let running=false, seen=-1;
  const tick=async()=>{
    if(running)return;
    running=true;
    try {
      const revision=tradeWakeStatus(await store.read()).revision;
      if(revision===seen)return;
      await run(); seen=revision;
    } catch { logger.error(JSON.stringify({event:'trade_financial_wakeup_failed'})); }
    finally {running=false;}
  };
  const timer=scheduleInterval(()=>{void tick();},5000); timer.unref?.();
  void tick();
  return {tick,stop:()=>clearInterval(timer)};
}
