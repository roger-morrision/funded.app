import { readLaunchJournal, journalRecovery } from '../../../launch-journal.js';
import { readTradeRecovery } from './trade-recovery-store.js';
import { el, panel, link, button, address, signature, utc, portfolioTools } from './view-utils.js';
export function recoveryItems(wallet, launches, trades) {
  if (!address(wallet)) return [];
  return [...launches.filter(row => row.cluster === 'devnet' && row.payer === wallet && row.state !== 'completed')
    .map(row => ({...row,kind:'launch',label:`Launch ${row.symbol || row.name || ''}`,detail:journalRecovery(row),at:row.updatedAt})),
  ...trades.filter(row => row.walletAddress === wallet && row.state === 'pending').map(row => ({...row,kind:'trade',
    label:`${row.side === 'buy' ? 'Buy' : 'Sell'} ${row.symbol}`,detail:'Check finalization, token balance changes, and indexed trade evidence before submitting another trade.'}))];
}
export function initializeRecoveryInbox(app) {
  const parent = document.querySelector('#my-launches'); if (!parent) return;
  const root = panel('recovery-inbox', 'Transactions to review', 'Saved transaction references from this device. Check the outcome before submitting the same action again. A timeout does not establish failure.');
  root.tabIndex=-1;
  const status = el('p'); status.setAttribute('role', 'status'); const list = el('div'); root.append(status,list); portfolioTools(parent).append(root);
  const shortcut=button('Review saved transactions',()=>{root.scrollIntoView({block:'start',behavior:'instant'});root.focus({preventScroll:true});});
  shortcut.className='secondary-button';
  parent.querySelector('[data-recovery-shortcut]')?.replaceWith(shortcut);
  shortcut.dataset.recoveryShortcut='';shortcut.hidden=true;parent.querySelector(':scope > .section-heading')?.append(shortcut);
  function render() {
    const wallet = app.connectedWalletAddress || ''; list.replaceChildren();
    const items = recoveryItems(wallet, readLaunchJournal(), readTradeRecovery());
    root.classList.toggle('is-empty',items.length===0);shortcut.hidden=items.length===0;shortcut.textContent=`Review ${items.length} saved transaction${items.length===1?'':'s'}`;
    status.textContent = wallet ? `${items.length} unresolved recorded actions for ${wallet}.` : 'Connect the wallet used for the action to see its recovery records.';
    for (const item of items) {
      const row = el('article', null, 'flow-activity-row'); row.append(el('h3', item.label),el('p',item.detail),el('small',`${wallet} · ${utc(item.at)}`));
      if(item.kind==='trade'&&!item.persisted)row.append(el('p','Browser storage is unavailable. This record remains in this tab only; preserve its transaction signature before closing.'));
      if (signature(item.signature)) row.append(link('Inspect transaction ↗',`https://explorer.solana.com/tx/${item.signature}?cluster=devnet`,true));
      if (item.kind === 'trade') row.append(button('Check recorded trade',async event => {
        if (wallet !== app.connectedWalletAddress) return;
        const control = event.currentTarget; control.disabled = true;
        app.pendingTradeVerifications.set(item.signature, item);
        try { await app.verifyPendingTrade(null,item.signature); render(); }
        catch { status.textContent = 'Verification unavailable. The recorded transaction is preserved; try checking it again later.'; }
        finally { control.disabled = false; }
      }));
      else if (address(item.mint)) row.append(link('Inspect coin and registration',`/token/${item.mint}`));
      else row.append(link('Return to launch draft','#launch'));
      list.append(row);
    }
  }
  for (const name of ['funded:journal','funded:trade-recovery','funded:reward-identity-change','funded:route-change','storage']) window.addEventListener(name,render);
  render();
}
