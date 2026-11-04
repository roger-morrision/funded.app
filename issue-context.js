const operations = new Set(['token-detail','launch','trade','claim','listing','migration','agent']);
const stages = new Set(['checking','verified','verification-unavailable','review','submission','recovery']);
export function issueOperationContext(input = {}) {
  return {operation:operations.has(input.operation) ? input.operation : null, stage:stages.has(input.stage) ? input.stage : null};
}
