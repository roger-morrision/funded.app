export const verifiedV3BuybackOrder = row => row?.status === 'finalized'
  && row.finalized === true && row.vaultDebitVerified === true
  && row.burnInstructionVerified === true;

export function v3BuybackSourceOrders(state, source) {
  return Object.entries(state.v3BuybackOrders || {})
    .filter(([key, row]) => key === source || row?.collectionSignature === source)
    .map(([key, row]) => ({ key, row, round:Number(row.round || (key === source ? 1 : 0)) }))
    .sort((a, b) => a.round - b.round);
}

export function v3BuybackSourceSpent(state, source, programId) {
  const direct=v3BuybackSourceOrders(state, source).reduce((sum, { row }) =>
    sum + (verifiedV3BuybackOrder(row) && row.programId === programId
      ? BigInt(row.spentLamports || '0') : 0n), 0n);
  return Object.values(state.v3BuybackOrders||{}).reduce((sum,row)=>{
    if(row.sourceKind!=='aggregate-collections'||!verifiedV3BuybackOrder(row)||row.programId!==programId)return sum;
    let remaining=BigInt(row.spentLamports||0),attributed=0n;
    for(const budget of row.sourceBudgets||[]){
      const take=remaining<BigInt(budget.amountLamports)?remaining:BigInt(budget.amountLamports);
      if(budget.source===source)attributed+=take;
      remaining-=take;
    }
    if(remaining!==0n)throw new Error('Aggregate buyback exceeds its frozen source budgets.');
    return sum+attributed;
  },direct);
}

export function v3BuybackNextOrder(state, source) {
  const orders = v3BuybackSourceOrders(state, source);
  const active = orders.find(({ row }) => row.status !== 'finalized');
  if (active) return { ...active, previous:orders.at(-1)?.row || null };
  const round = orders.length ? Math.max(...orders.map(item => item.round)) + 1 : 1;
  return { key:round === 1 ? source : `${source}:${round}`, round,
    row:null, previous:orders.at(-1)?.row || null };
}
