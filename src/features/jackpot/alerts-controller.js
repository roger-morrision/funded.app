import { addressPattern, signaturePattern, validLamports, solAmount } from './round-state.js';

// Owns device alert preferences and seen receipts; callers own status refreshes.
export function createJackpotAlerts({ section, isLoaded, document = globalThis.document, localStorage = globalThis.localStorage }) {
  const alertKey = 'funded.vip.jackpot-alerts.v1';
  const alerts = section.querySelector('.jackpot-alerts');
  const alertToggle = section.querySelector('[data-jackpot-alert-toggle]');
  const alertStatus = section.querySelector('[data-jackpot-alert-status]');
  const alertList = section.querySelector('[data-jackpot-alert-list]');
  const readAlerts = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(alertKey) || '{}');
      return { enabled:stored.enabled === true,
        seen:Array.isArray(stored.seen) ? stored.seen.filter(value =>
          signaturePattern.test(String(value))).slice(-100) : [] };
    } catch { return { enabled:false, seen:[] }; }
  };
  let alertPrefs = readAlerts();
  let latestReceipts = [];
  alertToggle.checked = alertPrefs.enabled;
  if (alertPrefs.enabled) alertStatus.textContent = 'On · new finalized results will appear here while the page is open.';
  alertToggle.addEventListener('change', () => {
    alertPrefs.enabled = alertToggle.checked;
    if (alertPrefs.enabled) alertPrefs.seen = latestReceipts.map(row => row.signature).slice(-100);
    try { localStorage.setItem(alertKey, JSON.stringify(alertPrefs)); }
    catch {
      alertPrefs.enabled = false;
      alertToggle.checked = false;
      alertStatus.textContent = 'Device storage is unavailable; alerts could not be enabled.';
      return;
    }
    alertStatus.textContent = alertPrefs.enabled
      ? 'On · new finalized results will appear here while the page is open.'
      : 'Alerts are off.';
    if (!alertPrefs.enabled) alertList.replaceChildren();
  });

  function updateAlerts(data, enabled) {
    latestReceipts = ['creator', 'trader'].flatMap(kind =>
      (Array.isArray(data[kind].history) ? data[kind].history : [])
        .filter(row => row?.status === 'paid' && row?.cluster === 'devnet'
          && signaturePattern.test(String(row.signature || ''))
          && addressPattern.test(String(row.winner || ''))
          && validLamports(row.amountLamports) && BigInt(row.amountLamports) > 0n)
        .map(row => ({ ...row, kind })));
    alerts.hidden = !enabled && latestReceipts.length === 0;
    if (!alertPrefs.enabled) return;
    if (!isLoaded() && alertPrefs.seen.length === 0) {
      alertPrefs.seen = latestReceipts.map(row => row.signature).slice(-100);
      try { localStorage.setItem(alertKey, JSON.stringify(alertPrefs)); } catch {}
      return;
    }
    const seen = new Set(alertPrefs.seen);
    const fresh = latestReceipts.filter(row => !seen.has(row.signature));
    for (const row of fresh) {
      const item = document.createElement('li');
      item.textContent = `${row.kind === 'creator' ? 'Creator' : 'Trader'} result · ${row.winner.slice(0, 4)}…${row.winner.slice(-4)} · ${solAmount(row.amountLamports)} · `;
      const receipt = document.createElement('a');
      receipt.href = `https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}?cluster=devnet`;
      receipt.target = '_blank';
      receipt.rel = 'noopener noreferrer';
      receipt.textContent = 'Receipt';
      item.append(receipt);
      alertList.prepend(item);
    }
    if (fresh.length) {
      alertStatus.textContent = `${fresh.length} new finalized result${fresh.length === 1 ? '' : 's'}.`;
      alertPrefs.seen = [...new Set([...alertPrefs.seen, ...fresh.map(row => row.signature)])].slice(-100);
      try { localStorage.setItem(alertKey, JSON.stringify(alertPrefs)); }
      catch { alertStatus.textContent = 'Result shown, but this device could not save alert history.'; }
    }
  }
  return { update: updateAlerts };
}
