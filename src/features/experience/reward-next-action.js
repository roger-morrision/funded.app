export function rewardNextAction(row) {
  if (row.stage === 'Verified') return { label:'Receipt verified', detail:row.detail, action:'Inspect receipt' };
  if (row.stage === 'Locked') return { label:'Waiting for unlock', detail:row.detail, action:'View unlock details' };
  if (row.stage === 'Funded') return { label:'Waiting for eligibility and payout', detail:'Funding is verified. Recipient delivery still needs its own receipt.', action:'Check payout window' };
  if (row.stage === 'Processing') return row.automatic
    ? { label:'Automatic processing', detail:'No signature is needed. Check service readiness and the existing outcome.', action:'Check processing' }
    : { label:'Outcome needs verification', detail:'Check the existing transaction before approving again.', action:'Check existing outcome' };
  if (row.stage === 'Awaiting approval') return row.ready
    ? { label:'Creator approval needed', detail:'Review the amount and network costs with the launch wallet.', action:row.action || 'Review approval' }
    : { label:'Service check required', detail:row.detail, action:'View blocker' };
  return { label:'Waiting for collection or funding', detail:row.detail, action:row.action || 'Check funding' };
}
