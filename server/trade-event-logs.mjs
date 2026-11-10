export class TradeHistoryGap extends Error {
  constructor(reason) { super(reason); this.reason=reason; }
}

// Commit event logs only when the emitting invocation and all its ancestors
// succeed. A caught inner-program failure still rolls back its events.
export function successfulEventLogs(logs) {
  if (!Array.isArray(logs)) throw new TradeHistoryGap('logs-unavailable');
  const stack=[], result=[];
  for (let index=0; index<logs.length; index++) {
    const log=logs[index];
    if (log.startsWith('Log truncated')) throw new TradeHistoryGap('logs-incomplete');
    const invocation=/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(log);
    if (invocation) {
      if (Number(invocation[2]) !== stack.length+1) throw new Error('Unbalanced program invocation.');
      stack.push({program:invocation[1],events:[]}); continue;
    }
    const end=/^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/.exec(log);
    if (end) {
      const frame=stack.pop();
      if (!frame || frame.program!==end[1]) throw new Error('Unbalanced program completion.');
      if (end[2]==='success') (stack.at(-1)?.events || result).push(...frame.events);
      continue;
    }
    if (log.startsWith('Program data: ') && stack.length) stack.at(-1).events.push({log,index,program:stack.at(-1).program});
  }
  if (stack.length) throw new TradeHistoryGap('logs-incomplete');
  return result;
}
