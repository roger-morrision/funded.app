import { MARKETING_AGENCY_POLICY } from '../../../config/marketing-agency.js';
import { AGENCY_RECEIPT_PROGRAM, AGENCY_RECEIPT_SCOPE } from '../../../config/agency-history.js';
import { formatReviewSol } from '../../../launch-review.js';
import { address, signature, el, link, utc } from './view-utils.js';

const units = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);

export function mountCoinAgents(root, app) {
  const box = el('section');
  root.append(box);
  let serial = 0;
  async function refresh() {
    const request = ++serial, mint = app.getCoinMintAddress();
    box.replaceChildren();
    if (!root.open || !address(mint)) return;
    const launch = app.coinSummaryLaunch?.mint === mint && app.coinSummaryLaunch.onchainVerified ? app.coinSummaryLaunch : app.verifiedLaunchPolicies.find(row => row.onchainVerified && row.cluster === 'devnet' && row.mint === mint);
    const selected = launch?.marketingAgency?.selectedAgents;
    if (!Array.isArray(selected) || !selected.length) {
      box.append(el('p','No verified agent selection for this mint.'));
      return;
    }
    box.append(el('h3','Marketing agents'), el('p','Checking protected budgets and receipts…'));
    const result = await app.apiRequest('/api/marketing-agency?mint=' + mint, {signal:AbortSignal.timeout(10000)}).catch(() => null);
    if (request !== serial || mint !== app.getCoinMintAddress()) return;
    box.replaceChildren(el('h3','Marketing agents'));
    box.append(el('p','The launch package announcement and the recurring X agent are separate deliveries. Recurring posts use this coin’s protected agency budget and are billed after verified delivery.'));
    const data = result?.available ? result.data : null;
    const current = data?.active === true && data.verification?.scope === 'reviewed-devnet-program-and-fresh-worker'
      && data.verification.programId === launch.pumpFeeRoute?.programId;
    const historical = data?.historyVerification?.scope === AGENCY_RECEIPT_SCOPE
      && data.historyVerification.programId === AGENCY_RECEIPT_PROGRAM && data.historyVerification.programId === launch.pumpFeeRoute?.programId;
    const snapshot = current && data.launches?.find(row => row.mint === mint && row.status === 'worker-verified-snapshot');
    const blockers = {'below-threshold':'Verified market cap is below the saved milestone.', 'awaiting-funding':'Awaiting protected funding.', 'awaiting-migration':'Awaiting migration to the trading pool.', 'execution-unavailable':'Execution checks unavailable.'};
    const history = (current || historical) && data.historyStatus === 'worker-recorded-finalized' ? data.history || [] : [];
    for (const [i, agent] of MARKETING_AGENCY_POLICY.agents.entries()) {
      if (!selected.includes(agent.id)) continue;
      const entry = history.find(row => row.mint === mint && row.agent === i && (!i || row.ownCoinBurnVerified === true) && row.status === 'worker-recorded-finalized' && signature(row.signature));
      const remaining = snapshot?.agentRemaining?.[i];
      const target = snapshot?.rules?.marketCapUsd?.[i-1] ?? entry?.savedMarketCapUsd;
      const interval = snapshot?.rules?.promotionIntervalSeconds;
      box.append(el('h4', i ? 'Agent ' + (i+1) + ' · own-coin buyback' : 'Agent 1 · recurring X promotion'));
      const rule = i ? (target ? 'One burn at saved market cap $' + Number(target).toLocaleString() : 'Saved milestone unavailable')
        : (interval ? 'Minimum interval ' + interval / 3600 + ' hours' : 'Saved posting interval unavailable');
      box.append(el('p',rule + (i && target && Number(target) !== agent.marketCapUsd ? ' (custom Devnet threshold)' : '') + '. Protected balance: ' + (units(remaining) ? formatReviewSol(remaining) : 'unavailable') + '.'));
      if (snapshot?.checkedAt) box.append(el('p','Budget checked ' + utc(snapshot.checkedAt)));
      const check = snapshot?.milestoneChecks?.find(row => row.agent === i);
      const observed = check?.observation;
      const paused = !i && data?.publishingPaused === true;
      const status = paused ? 'X publishing paused. Unspent funds remain reserved.' : i && entry ? 'Completed once.' :
        blockers[check?.status] || (current && data.agents?.find(row=>row.id===agent.id)?.enabled ? 'Awaiting verified funding and execution conditions.' : 'Execution availability unverified.');
      box.append(el('p',status));
      if (entry) {
        const spent = units(entry.amountLamports) ? formatReviewSol(entry.amountLamports) : 'unavailable';
        const burned = i && units(entry.burnedBaseUnits) ? ' · ' + entry.burnedBaseUnits + ' launched-token base units burned' : '';
        box.append(el('p','Last recorded action ' + utc(entry.finalizedAt) + ' · spent ' + spent + burned),
          link(i ? 'Buyback and burn transaction ↗' : 'Verified promotion billing ↗','https://explorer.solana.com/tx/' + entry.signature + (import.meta.env?.VITE_SOLANA_CLUSTER==='mainnet-beta'?'':'?cluster=devnet'),true));
      }
      if (i) box.append(el('p',units(observed?.marketCapUsdMicros) ? 'Market cap at ' + utc(observed.observedAt) + ': $' + (Number(observed.marketCapUsdMicros)/1e6).toLocaleString() : units(entry?.observedMarketCapUsdMicros)
        ? 'Market cap observed at execution: $' + (Number(entry.observedMarketCapUsdMicros)/1e6).toLocaleString()
        : 'Verified market-cap observation unavailable.'));
    }
  }
  root.addEventListener('toggle', refresh);
  window.addEventListener('funded:coin-facts', refresh);
  window.addEventListener('funded:coin-facts-loading', () => { ++serial; box.replaceChildren(); });
}
