import { creatorPayoutActions } from '../fees/creator-payout-actions.js';
const address = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''));
const signature = value => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(value || ''));
export const unsigned = value => /^(0|[1-9]\d*)$/.test(String(value));
export function solText(value) {
  if (!unsigned(value)) return 'Unavailable';
  const n = BigInt(value), fraction = String(n % 1000000000n).padStart(9, '0').replace(/0+$/, '');
  return `${n / 1000000000n}${fraction ? '.' + fraction : ''} SOL`;
}
// Open items (no timestamp) stay on top; dated records follow newest first. Sort is stable for ties.
export function newestFirst(rows) {
  const time = row => { const at = Date.parse(row?.at || ''); return Number.isFinite(at) ? at : Infinity; };
  return [...rows].sort((a, b) => time(b) - time(a) || 0);
}
export function financialRows({ experience, buybacks, overviews = [], wallet }) {
  const rows = [];
  const validExperience = experience?.cluster === 'devnet' && ['recorded-finalized-v3', 'onchain-indexed', 'partial', 'no-records'].includes(experience.evidence?.status);
  if (validExperience && experience.wallet?.address === wallet && address(wallet)) {
    for (const token of experience.wallet.rows || []) for (const payout of token.payouts || []) {
      if (!address(token.mint) || payout.wallet !== wallet || payout.feeSourceVerified !== true
        || !signature(payout.signature) || !unsigned(payout.amountLamports)) continue;
      rows.push({ id:`paid:${payout.kind}:${payout.signature}:${token.mint}`, mint:token.mint,
        title:`${payout.kind} SOL received`, stage:'Verified', amount:solText(payout.amountLamports),
        detail:'Finalized recipient transfer and balance delta verified.', wallet,
        signature:payout.signature, at:payout.paidAt, href:`/wallet/${wallet}` });
    }
  }
  for (const overview of overviews) {
    if (!overview?.available || overview.scope !== 'per-mint-v3' || overview.creatorWallet !== wallet || !address(overview.mint)) continue;
    if (overview.pump?.status === 'confirmed' && unsigned(overview.pump.accruedLamports) && BigInt(overview.pump.accruedLamports) > 0n) rows.push({
      id:`accrued:${overview.mint}`, mint:overview.mint, title:'Uncollected creator fees', stage:'Accrued', amount:solText(overview.pump.accruedLamports),
      wallet, href:`/token/${overview.mint}`, action:'Review fee collection', detail:'Confirmed Pump vault snapshot. Collection and settlement are still required.' });
    for (const collection of overview.collections || []) {
      const href = `/token/${overview.mint}`;
      if (collection.settlement !== 'finalized') {
        const automatic=overview.automaticSettlementEnabled===true;
        rows.push({ id:`settle:${collection.signature}`, mint:overview.mint, title:'Settle collected creator fees', stage:automatic?'Processing':'Awaiting approval',automatic,ready:!automatic&&overview.gates?.settlement === true,
          amount:solText(collection.amountLamports), wallet, href, action:automatic?'Check automation':'Review settlement',
          detail:automatic?'Automatic saved-policy settlement is pending. Inspect service readiness and receipts; no creator signature is required.'
            :overview.gates?.settlement === true ? 'Launch creator must review and sign settlement.' : 'Settlement is unavailable under the current service configuration.' });
        continue;
      }
      for (const action of creatorPayoutActions(collection)) {
        if (!unsigned(action.amount) || BigInt(action.amount) === 0n) continue;
        const funding = action.action.endsWith('funding');
        if (action.finalized && !funding) continue; // Payment receipts come from the verified recipient projection above.
        const funded = action.finalized && collection[`${action.gate}Verified`] === true;
        const feeLocked = action.action === 'creator-wallet-payout' && overview.creatorFeeLock?.locked === true
          && collection[action.gate] !== 'verification-pending' && !action.finalized;
        if (feeLocked) {
          rows.push({ id:`${collection.signature}:${action.action}`, mint:overview.mint, title:action.label,
            stage:'Locked', ready:false, amount:solText(action.amount), wallet, href, action:'View fee lock',
            detail:overview.creatorFeeLock.unlockAt
              ? `Creator SOL fees unlock ${new Date(overview.creatorFeeLock.unlockAt).toLocaleString()} (12 hours after launch).`
              : 'Creator SOL fees remain locked while the launch timestamp is verified.' });
          continue;
        }
        const automatic=overview.automaticDisbursementEnabled===true;
        const processing = automatic&&!funded || collection[action.gate] === 'verification-pending' || action.finalized && !funded;
        rows.push({ id:`${collection.signature}:${action.action}`, mint:overview.mint, title:action.label,
          stage:funded ? 'Funded' : processing ? 'Processing' : 'Awaiting approval',automatic,ready:!funded && !processing && overview.gates?.[action.gate] === true,
          amount:solText(action.amount), wallet, href, action:action.finalized ? 'Inspect funding' : processing ? 'Check outcome' : 'Review approval',
          detail:funded ? 'Recorded vault funding and balance delta verified. Eligibility and the payout window still apply; this is not recipient delivery.'
            : processing ? automatic?'Automatic funding or payout is pending. Check service readiness and the existing receipt; no creator signature is required.':'Outcome needs reconciliation before another approval.'
              : overview.gates?.[action.gate] === true ? 'Launch creator approval required. Network costs apply.' : 'This action is blocked by the current service configuration.' });
      }
    }
  }
  if (buybacks?.cluster === 'devnet') {
    for (const row of buybacks.pending || []) {
      if (!address(row.mint) || !unsigned(row.amountLamports) || BigInt(row.amountLamports) === 0n) continue;
      rows.push({ id:`burn:${row.mint}`, mint:row.mint, title:'Protocol $FUNDED buyback',
        stage:['queued','verification-pending'].includes(row.status) ? 'Processing' : 'Accrued',
        amount:solText(row.amountLamports), href:'#buybacks', action:'Inspect vault and trigger',
        detail:row.status === 'below-minimum-order' ? 'Below the execution minimum; retained in this mint’s vault.'
          : 'Recorded unspent allocation. Execution depends on verified vault funds, trigger, quote, and worker readiness.' });
    }
    for (const row of buybacks.receipts || []) {
      if (row.status !== 'finalized' || row.vaultDebitVerified !== true || row.burnInstructionVerified !== true
        || !signature(row.signature) || !address(row.mint)) continue;
      rows.push({ id:`burned:${row.signature}`, mint:row.mint, title:'Protocol $FUNDED burned', stage:'Verified',
        amount:`${row.boughtAndBurnedBaseUnits || row.burnedBaseUnits || 'Unknown'} $FUNDED base units`,
        detail:'Supply burn instruction and source-vault debit verified. Locked balances are excluded.',
        signature:row.signature, at:row.finalizedAt, href:'#buybacks',receiptView:row.sourceKind==='onchain-policy'?'explorer':'exact' });
    }
  }
  return [...new Map(rows.map(row => [row.id, row])).values()];
}
