// Alerts that bring people back: payouts received, entering a Daily bonus prize place,
// and a reminder one hour before the snapshot. In-app toasts always; browser
// notifications only after the person turns them on. Also registers the PWA worker.
import { el, sol, lamports, getJSON, nextUtcMidnight, safeStorage } from './format.js';

const OPT_KEY = 'richpad.alerts.enabled', SEEN_KEY = 'richpad.alerts.received';

function toast(document, message, href) {
  let stack = document.getElementById('growth-toasts');
  if (!stack) { stack = el(document, 'div', 'growth-toasts'); stack.id = 'growth-toasts'; stack.setAttribute('role', 'status'); document.body.append(stack); }
  const item = el(document, href ? 'a' : 'div', 'growth-toast', message);
  if (href) item.href = href;
  stack.append(item);
  setTimeout(() => item.remove(), 8000);
}

async function notify(document, title, body, url) {
  toast(document, `${title} — ${body}`, url);
  if (safeStorage.get(OPT_KEY) !== 'true' || globalThis.Notification?.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration) await registration.showNotification(title, { body, icon: '/richpad-mark.svg', data: { url } });
    else new Notification(title, { body, icon: '/richpad-mark.svg' });
  } catch { /* notifications unavailable */ }
}

export function alertsEnabled() { return safeStorage.get(OPT_KEY) === 'true'; }

export async function enableAlerts() {
  if (!globalThis.Notification) return 'unsupported';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  safeStorage.set(OPT_KEY, permission === 'granted' ? 'true' : 'false');
  return permission;
}

export function mountAlerts(app, document = globalThis.document) {
  if (document.body.dataset.growthAlerts) return true;
  document.body.dataset.growthAlerts = 'true';
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link'); link.rel = 'manifest'; link.href = '/manifest.webmanifest'; document.head.append(link);
  }

  // Toggle in Profile → Notification preferences.
  const prefs = document.getElementById('notification-preferences-details');
  if (prefs && !prefs.querySelector('.alerts-toggle')) {
    const row = el(document, 'div', 'alerts-toggle');
    const label = el(document, 'span', null, 'Browser alerts for payouts, prize places and the snapshot reminder');
    const button = el(document, 'button', 'secondary-button'); button.type = 'button';
    const sync = () => { button.textContent = alertsEnabled() ? 'Alerts on · Turn off' : 'Turn on alerts'; };
    button.addEventListener('click', async () => {
      if (alertsEnabled()) safeStorage.set(OPT_KEY, 'false');
      else { const result = await enableAlerts(); if (result !== 'granted') toast(document, result === 'unsupported' ? 'This browser does not support notifications.' : 'Notifications are blocked in this browser’s site settings.'); }
      sync();
    });
    sync(); row.append(label, button); prefs.append(row);
  }

  // Payouts: compare verified totals with the last value seen in this browser.
  async function checkPayouts() {
    const wallet = app.connectedWalletAddress; if (!wallet) return;
    const data = await getJSON(`/api/rewards/totals?wallet=${encodeURIComponent(wallet)}`);
    if (app.connectedWalletAddress !== wallet) return;
    const rewards = lamports(data?.rewardsLamports), bonus = lamports(data?.bonusLamports);
    const total = rewards == null && bonus == null ? null : (rewards ?? 0n) + (bonus ?? 0n);
    if (total == null) return;
    const key = `${SEEN_KEY}.${wallet}`, seen = lamports(safeStorage.get(key));
    if (seen != null && total > seen) await notify(document, 'You received a payout', `+${sol(total - seen)} verified on Solana`, '/#payments');
    safeStorage.set(key, String(total));
  }

  // Snapshot reminder: once per UTC day, within the last hour before 00:00 UTC.
  function checkSnapshot() {
    if (!app.connectedWalletAddress) return;
    const cutoff = nextUtcMidnight(), left = cutoff - Date.now(), key = `richpad.alerts.snapshot.${cutoff}`;
    if (left > 0 && left <= 3_600_000 && safeStorage.get(key) !== 'sent') {
      safeStorage.set(key, 'sent');
      void notify(document, 'Daily bonus snapshot in under an hour', 'Rankings lock at 00:00 UTC.', '/#bonuses');
    }
  }

  // Prize places: the rank card emits this when the wallet enters the top 3.
  globalThis.addEventListener?.('richpad:bonus-prize', event => {
    const { category, rank } = event.detail || {};
    const key = `richpad.alerts.prize.${nextUtcMidnight()}.${category}`;
    if (safeStorage.get(key) === String(rank)) return;
    safeStorage.set(key, String(rank));
    void notify(document, `You're #${rank} in ${category}`, 'You are in a Daily bonus prize place right now.', '/#bonuses');
  });

  void checkPayouts(); checkSnapshot();
  globalThis.setInterval?.(() => { void checkPayouts(); checkSnapshot(); }, 120_000);
  globalThis.addEventListener?.('funded:reward-identity-change', () => void checkPayouts());
  return true;
}
