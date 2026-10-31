import { el, button, link, utc } from './view-utils.js';
export function initializeReadyQueue(root, app) {
  const summary = el('section',null,'ready-queue'); summary.setAttribute('aria-label','Ready actions');
  summary.append(el('h3','Wallet actions')); const status = el('p'); status.setAttribute('role','status'); const actions = el('div'); summary.append(status,actions); root.querySelector('header')?.after(summary);
  const guide = el('details',null,'flow-guide'); guide.append(el('summary','How fees become verified payments'));
  for (const node of root.querySelectorAll(':scope > .flow-stages, :scope > .flow-note')) guide.append(node);
  summary.after(guide);
  return (rows,{checking=false,missing=[],cutoff=null}={}) => {
    actions.replaceChildren(); const mine = rows.filter(row => row.wallet === app.connectedWalletAddress);
    const ready = mine.filter(row => row.stage === 'Awaiting approval' && row.ready === true), uncertain = mine.filter(row => row.stage === 'Processing');
    status.textContent = checking ? 'Checking this wallet’s available actions…' : !app.connectedWalletAddress
      ? 'Connect your launch or recipient wallet to check personal actions.'
      : `${ready.length} available creator approvals · ${uncertain.length} outcomes need checking${missing.length ? ' · Some records are unavailable' : ''}. Amounts are checked allocations, not a wallet balance.`;
    if (!app.connectedWalletAddress) actions.append(button('Connect wallet',()=>void app.connectWallet({interactiveSignIn:false})));
    for (const row of [...ready,...uncertain].slice(0,4)) actions.append(link(`${row.action}: ${row.amount}`,row.href));
    if (!checking && app.connectedWalletAddress && !ready.length) actions.append(link('Check claims and eligibility','#airdrops'));
    if (cutoff) actions.append(el('p',`Next ranked bonus cutoff: ${utc(cutoff)}. Processing follows eligibility, funding and verification; this is not a payment promise.`));
  };
}
