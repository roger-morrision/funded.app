import { readNotifications, saveNotifications, notificationAllowed } from './notification-preferences.js';
import { activityRows, filterActivity, isActivityHidden } from './activity-model.js';
const REMINDERS = 'funded.return-reminders.v1';
const validMint = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''));
export function readReminders(storage = globalThis.localStorage) {
  const rows = JSON.parse(storage.getItem(REMINDERS) || '[]');
  if (!Array.isArray(rows) || rows.length > 50 || rows.some(row => !/^[a-f0-9-]{36}$/.test(row.id || '')
    || !Number.isFinite(row.at) || typeof row.label !== 'string' || row.label.length > 100
    || !/^\/(?:token\/[1-9A-HJ-NP-Za-km-z]{32,44}|creator\/x\/\d{1,24})$/.test(row.href))) throw new Error('Reminder storage unavailable.');
  return rows;
}
export function initializeCreatorActivity(app) {
  const dialog = document.querySelector('#notification-dialog');
  if (!dialog) return;
  const root = document.createElement('section'); root.className = 'flow-panel creator-activity';
  root.innerHTML = '<h3>Creator activity &amp; reminders</h3><label><input type="checkbox" data-creator-alerts>Show activity from followed creator wallets on this device</label><p>Public launches and recorded verified payouts and burns. Follow a creator wallet from its profile; X sign-in is optional.</p><div data-creator-notices></div><h3>Return reminders</h3><p>Shown in this app while open. Reminders never submit trades or move funds.</p><div data-reminders></div><p data-reminder-status role="status" aria-live="polite"></p>';
  dialog.querySelector('.notice-list')?.after(root);
  let data = null, activity = [], personal = null;
  const checkbox = root.querySelector('input'), message = root.querySelector('[data-reminder-status]');
  checkbox.checked = readNotifications().enabled;
  const anchor = (label, href) => Object.assign(document.createElement('a'), { textContent:label, href });
  function render() {
    const feed = root.querySelector('[data-creator-notices]'); feed.replaceChildren();
    const prefs=readNotifications();checkbox.checked=prefs.enabled;
    if (checkbox.checked) {
      const follows = new Set(app.getFollowedWallets().map(row => row.address));
      let creators=[];try{creators=JSON.parse(localStorage.getItem('funded.creator.following')||'[]');}catch{}
      const rows=filterActivity(activity.length?activity:activityRows(app.verifiedLaunchPolicies,data),'following',follows,new Set(Array.isArray(creators)?creators.map(String):[]));
      const grouped=new Set();
      for(const event of rows){
        const amount=event.amountLamports??(data?.events||[]).find(row=>row.signature===event.signature&&row.mint===event.mint)?.amountLamports;
        if(isActivityHidden(event)||!notificationAllowed(prefs,event.kind,amount))continue;
        const key=`${event.kind}:${event.mint||event.creatorId}`;if(prefs.frequency==='digest'&&grouped.has(key))continue;grouped.add(key);
        const row=document.createElement('p');row.append(anchor(`${event.title}${prefs.frequency==='digest'?' · latest in group':''}`,event.href||`/token/${event.mint}`));feed.append(row);if(feed.children.length>=12)break;
      }
      if(personal?.wallet===app.connectedWalletAddress){
        const ready=(personal.rows||[]).filter(row=>row.ready===true);
        if(ready.length&&notificationAllowed(prefs,'approval')){const row=document.createElement('p');row.append(anchor(`${ready.length} ready approvals · wallet ${personal.wallet.slice(0,6)}…`,'#payments/activity'));feed.append(row);}
        if(personal.cutoff&&Number.isFinite(Date.parse(personal.cutoff))&&notificationAllowed(prefs,'cutoff')){const row=document.createElement('p');row.append(anchor(`Published ranked bonus cutoff · ${new Date(personal.cutoff).toLocaleString()} · funding and eligibility still apply`,'#bonuses'));feed.append(row);}
      }
      if(!feed.children.length)feed.textContent='No matching activity now. Quiet hours and receipt thresholds can suppress notices; financial records remain available in Rewards.';
    } else feed.textContent = 'Creator activity notifications are off.';
    const reminders = root.querySelector('[data-reminders]'); reminders.replaceChildren();
    try {
      for (const row of readReminders().sort((a,b) => a.at - b.at)) {
        const item = document.createElement('p');
        item.append(anchor(`${row.at <= Date.now() ? 'Due · ' : ''}${row.label} · ${new Date(row.at).toLocaleString()}`, row.href));
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Dismiss';
        remove.setAttribute('aria-label', `Dismiss reminder ${row.label}`);
        remove.addEventListener('click', () => {
          try { localStorage.setItem(REMINDERS, JSON.stringify(readReminders().filter(other => other.id !== row.id))); render(); }
          catch { message.textContent = 'Reminder could not be dismissed. Check browser storage.'; }
        }); item.append(remove); reminders.append(item);
      }
      if (!reminders.children.length) reminders.textContent = 'No return reminders. Set one on a token or creator announcement.';
    } catch { message.textContent = 'Saved reminders are unavailable. Check browser storage.'; }
  }
  checkbox.addEventListener('change', () => { try { saveNotifications({...readNotifications(),enabled:checkbox.checked}); } catch { checkbox.checked = false; message.textContent = 'Preference could not be saved.'; } render(); });
  function save(at, href, label, status) {
    if (!Number.isFinite(at) || at <= Date.now() || at > Date.now() + 90 * 86400000) { status.textContent = 'Choose a time in the next 90 days.'; return; }
    try {
      const rows = readReminders(); if (rows.length >= 50) throw new Error();
      const row = { id:crypto.randomUUID(), at, href, label:label.slice(0, 100) };
      // Validate the same route allowlist on writes and reads.
      readReminders({ getItem:() => JSON.stringify([row]) });
      localStorage.setItem(REMINDERS, JSON.stringify([...rows, row])); status.textContent = 'Reminder saved on this device. Open Notifications to view or dismiss it.'; render();
    } catch { status.textContent = 'Reminder could not be saved. Check browser storage or dismiss old reminders (limit 50).'; }
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-activity]')) { render(); dialog.showModal(); }
    const button = event.target.closest('[data-announcement-reminder]');
    if (button) save(Date.parse(button.dataset.announcementReminder), button.dataset.reminderHref, 'Creator announcement', button.nextElementSibling);
  });
  for (const target of document.querySelectorAll('#financial-center nav, #profile')) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.openActivity = ''; button.textContent = 'Activity & reminders'; target.append(button);
  }
  window.addEventListener('funded:financial-experience', event => { data = event.detail; render(); });
  window.addEventListener('funded:feed-data',event=>{activity=event.detail;render();});
  window.addEventListener('funded:financial-center-data',event=>{personal=event.detail;render();});
  window.addEventListener('funded:reward-identity-change',()=>{personal=null;render();});
  window.addEventListener('funded:notification-preferences',render);
  window.addEventListener('funded:content-preferences',render);
  window.addEventListener('funded:following-changed', render);
  window.addEventListener('storage', render);
  document.querySelector('#notifications-button')?.addEventListener('click', render);
  setInterval(() => { if (dialog.open) render(); }, 30000); render();
}
