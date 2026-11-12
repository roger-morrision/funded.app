import { readLaunchJournal, journalRecovery } from '../../../launch-journal.js';
import { readTradeRecovery } from './trade-recovery-store.js';
import { tradeRecoveryCopy } from './trade-progress.js';
import { progressView } from './transaction-progress-view.js';
import { recordFlowTiming } from './flow-timing.js';
import { el, panel, link, button, address, signature, utc, portfolioTools } from './view-utils.js';
const NET = String(import.meta.env?.VITE_SOLANA_CLUSTER || 'devnet').trim();
export function recoveryItems(wallet, launches, trades) {
  if (!address(wallet)) return [];
  return [...launches.filter(row => row.cluster === NET && row.payer === wallet && row.state !== 'completed')
    .map(row => ({...row,kind:'launch',label:`Launch ${row.symbol || row.name || ''}`,detail:journalRecovery(row),at:row.updatedAt})),
  ...trades.filter(row => row.walletAddress === wallet && row.state === 'pending').map(row => ({...row,kind:'trade',
    label:`${row.side === 'buy' ? 'Buy' : 'Sell'} ${row.symbol}`,detail:tradeRecoveryCopy(row).detail}))];
}
export function initializeRecoveryInbox(app) {
  const parent = document.querySelector('#my-launches'); if (!parent) return;
  const root = panel('recovery-inbox', 'Transactions to review', 'Saved on this device. Check before retrying; timeouts do not mean failure.');
  root.tabIndex=-1;
  const status = el('p'); status.setAttribute('role', 'status'); const list = el('div'); root.append(status,list); portfolioTools(parent).append(root);
  function render() {
    const wallet = app.connectedWalletAddress || '';
    const owned=root.contains(document.activeElement); list.replaceChildren();
    const launches=readLaunchJournal(),trades=readTradeRecovery();
    const items = recoveryItems(wallet, launches, trades);
    const savedPending=launches.some(row=>row.cluster===NET&&row.state!=='completed')||trades.some(row=>row.state==='pending');
    root.hidden=wallet?items.length===0:!savedPending;
    if(owned&&root.hidden){const heading=parent.querySelector(':scope > .section-heading :is(h1,h2)');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
    root.classList.toggle('is-empty',items.length===0);
    status.textContent = wallet ? `${items.length} unresolved recorded actions for ${wallet}.` : 'Connect the wallet used for these transactions.';
    for (const item of items) {
      const row = el('article', null, 'flow-activity-row'); row.append(el('h3', item.label),el('p',item.detail),el('small',`${wallet} · ${utc(item.at)}`));
      row.prepend(progressView(document,item.kind,item));
      if(item.kind==='trade'&&!item.persisted)row.append(el('p','Browser storage is unavailable. This record remains in this tab only; preserve its transaction signature before closing.'));
      if (signature(item.signature)) row.append(link('Inspect transaction ↗',`https://explorer.solana.com/tx/${item.signature}${import.meta.env?.VITE_SOLANA_CLUSTER==='mainnet-beta'?'':'?cluster=devnet'}`,true));
      if (item.kind === 'trade') row.append(button(tradeRecoveryCopy(item).action,async event => {
        if (wallet !== app.connectedWalletAddress) return;
        const control = event.currentTarget; control.disabled = true; const started=performance.now();
        if(!app.pendingTradeVerifications.has(item.signature))app.pendingTradeVerifications.set(item.signature, item);
        try { await app.verifyPendingTrade(null,item.signature); render(); }
        catch { status.textContent = 'Verification unavailable. The recorded transaction is preserved; try checking it again later.'; }
        finally { control.disabled = false; recordFlowTiming('recovery', performance.now()-started, app.pendingTradeVerifications.has(item.signature) ? 'pending' : 'verified'); }
      }));
      else if (address(item.mint)) row.append(link('Inspect coin and registration',`/token/${item.mint}`));
      else row.append(link('Open launch form','#launch'));
      list.append(row);
    }
  }
  for (const name of ['funded:journal','funded:trade-recovery','funded:reward-identity-change','funded:route-change','storage']) window.addEventListener(name,render);
  render();
}
