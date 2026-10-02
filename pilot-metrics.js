import { summarizePilot } from './pilot-metrics-model.js';
import './pilot-metrics.css';

const KEY = 'funded.vip.pilot.v1';
const section = document.createElement('section');
section.className = 'pilot-panel';
section.innerHTML = `<h2>Optional creator and visitor pilot</h2><p>Help measure whether the basic launch path and verified rewards are useful. Events stay on this device until you export them. No wallet address, post text, or browsing URL is recorded.</p><label>How did you arrive?<select data-pilot-source><option value="organic">Organic visit</option><option value="creator-invite">Creator invite</option><option value="other">Other</option><option value="test">Test wallet or synthetic fixture</option></select></label><label><input type="checkbox" data-pilot-consent> Record pilot events on this device</label><div class="pilot-actions"><button type="button" data-pilot-export disabled>Export pilot record</button><button type="button" data-pilot-clear>Delete pilot record</button></div><p data-pilot-status role="status">Pilot recording is off.</p><small>Day-7 and second-update results require a full observation window. A single device cannot identify the same person across devices; exports require consent before any research use.</small>`;
document.querySelector('#community-preferences')?.after(section);
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
let record = read();
if (record?.version !== 1 || record?.consented !== true || !Array.isArray(record.events)
  || !/^[0-9a-f-]{36}$/i.test(String(record.participantId || ''))) record = null;
const consent = section.querySelector('[data-pilot-consent]');
const source = section.querySelector('[data-pilot-source]');
const status = section.querySelector('[data-pilot-status]');
const exportButton = section.querySelector('[data-pilot-export]');
if (record?.consented === true) { consent.checked = true; source.value = record.source; exportButton.disabled = false; }
const render = () => {
  const counts = record?.consented ? summarizePilot([record]) : null;
  status.textContent = counts ? `Local pilot on · ${record.events.length} events · draft review ${counts.draftReviewed}/${counts.draftStarters} · day-7 eligible ${counts.d7Eligible} · second-update eligible ${counts.creatorFollowThroughEligible}.` : 'Pilot recording is off.';
};
function recordEvent(name) {
  if (!record?.consented || !consent.checked) return;
  const at = new Date().toISOString();
  const duplicate = record.events.some(row => row.name === name && row.at.slice(0, 10) === at.slice(0, 10));
  if (duplicate && name !== 'creator-update-published') return;
  record.events.push({ name, at });
  record.events = record.events.slice(-300);
  try { localStorage.setItem(KEY, JSON.stringify(record)); render(); } catch { status.textContent = 'Device storage unavailable. Recording stopped.'; consent.checked = false; }
}
consent.addEventListener('change', () => {
  if (consent.checked) {
    record = { version:1, participantId:crypto.randomUUID(), consented:true, source:source.value,
      startedAt:new Date().toISOString(), events:[] };
    try { localStorage.setItem(KEY, JSON.stringify(record)); exportButton.disabled = false; }
    catch { consent.checked = false; record = null; status.textContent = 'Device storage unavailable. Recording was not enabled.'; return; }
  } else {
    localStorage.removeItem(KEY); record = null; exportButton.disabled = true;
  }
  render();
});
source.addEventListener('change', () => {
  if (!record?.consented) return;
  record.source = source.value;
  try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { status.textContent = 'Source could not be saved.'; }
});
section.querySelector('[data-pilot-clear]').addEventListener('click', () => {
  localStorage.removeItem(KEY); record = null; consent.checked = false; exportButton.disabled = true; render();
});
exportButton.addEventListener('click', () => {
  if (!record?.consented) return;
  const blob = new Blob([JSON.stringify(record, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `funded-pilot-${record.participantId}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});
document.querySelector('#token-name')?.addEventListener('input', event => { if (event.target.value.trim()) recordEvent('draft-started'); });
window.addEventListener('funded:launch-step', event => { if (event.detail?.step === 3) recordEvent('draft-reviewed'); });
window.addEventListener('funded:watchlist-added', () => recordEvent('save-coin'));
const followingCount = () => {
  try { return JSON.parse(localStorage.getItem('funded.creator.following') || '[]').length; }
  catch { return 0; }
};
let priorFollowingCount = followingCount();
window.addEventListener('funded:following', () => {
  const next = followingCount();
  if (next > priorFollowingCount) recordEvent('follow-creator');
  priorFollowingCount = next;
});
window.addEventListener('funded:verified-reward-view', () => recordEvent('verified-reward-view'));
window.addEventListener('funded:creator-update-published', () => recordEvent('creator-update-published'));
window.addEventListener('funded:jackpot-pilot', event => {
  if (['jackpot-home-view', 'jackpot-rewards-view', 'jackpot-open', 'jackpot-rules-view']
    .includes(event.detail?.name)) recordEvent(event.detail.name);
});
function trackUsefulView() {
  const token = location.pathname.match(/^\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1];
  const creator = location.hash.match(/^#creator\/(\d{1,24})$/)?.[1]
    || location.pathname.match(/^\/creator\/x\/(\d{1,24})\/?$/)?.[1];
  try {
    if (token && JSON.parse(localStorage.getItem('funded.app.community.watchlist') || '[]').includes(token)) recordEvent('watched-coin-view');
    if (creator && document.querySelector('#creator-support-page .creator-updates article')
      && JSON.parse(localStorage.getItem('funded.creator.following') || '[]').includes(creator)) recordEvent('followed-creator-view');
  } catch { /* No local following list. */ }
}
window.addEventListener('popstate', trackUsefulView);
window.addEventListener('hashchange', trackUsefulView);
const creatorPage = document.querySelector('#creator-support-page');
if (creatorPage) new MutationObserver(trackUsefulView).observe(creatorPage, { childList:true, subtree:true });
render(); trackUsefulView();
