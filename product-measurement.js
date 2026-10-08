import { apiRequest } from './client.js';
import { PRODUCT_EVENTS } from './product-events.js';

const consentKey = 'funded.journeys.consent.v1';
const sessionKey = 'funded.journeys.session.v1';
const panel = document.querySelector('#community-preferences details');
if (panel) {
  const section = document.createElement('section');
  section.className = 'journey-preferences';
  section.innerHTML = '<h3>Help improve funded.vip</h3><label><input id="journey-consent" type="checkbox" aria-describedby="journey-privacy">Share anonymous app usage</label><p id="journey-privacy">Optional. Shares which app steps you use, with a random session code that changes daily. No wallet addresses, X accounts, page URLs, or amounts are included. Counts are kept for 30 days. You can turn this off at any time; previously shared counts remain until they expire.</p><p id="journey-status" role="status" aria-live="polite"></p>';
  panel.append(section);
  const checkbox = section.querySelector('input');
  const status = section.querySelector('#journey-status');
  let stopped = true, controller = null, session = null;
  const sent = new Set(), pending = new Set();
  function stop(message) {
    stopped = true; checkbox.checked = false; controller?.abort(); controller = null;
    session = null; sent.clear(); pending.clear();
    try {sessionStorage.removeItem(sessionKey);} catch { /* No further events are sent. */ }
    status.textContent = message;
  }
  try {checkbox.checked = localStorage.getItem(consentKey) === 'true'; stopped = !checkbox.checked; status.textContent = stopped ? 'Anonymous usage sharing is off.' : 'Anonymous usage sharing is on for future actions.';}
  catch {stop('Sharing is off because your privacy setting could not be read.');}
  checkbox.addEventListener('change', () => {
    const enabled = checkbox.checked;
    if (!enabled) stop('Anonymous usage sharing is off.');
    try {
      localStorage.setItem(consentKey,String(enabled));
      if (localStorage.getItem(consentKey) !== String(enabled)) throw new Error();
      stopped = !enabled; checkbox.checked = enabled;
      status.textContent = enabled ? 'Anonymous usage sharing is on for future actions.' : 'Anonymous usage sharing is off.';
    } catch {stop('Sharing stopped in this tab. Your privacy setting could not be saved; allow browser storage and try again.');}
  });
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === consentKey && event.newValue !== 'true') stop('Anonymous usage sharing is off.');
  });
  window.addEventListener('funded:product-event', async event => {
    const name = event.detail?.name;
    if (stopped || !checkbox.checked || !PRODUCT_EVENTS.has(name)) return;
    try {
      if (localStorage.getItem(consentKey) !== 'true') return stop('Anonymous usage sharing is off.');
      const day = new Date().toISOString().slice(0,10);
      if (session?.day !== day) {
        const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
        session = saved?.day === day && /^[a-f0-9-]{36}$/i.test(saved.id || '') ? saved : {day,id:crypto.randomUUID()};
        sessionStorage.setItem(sessionKey,JSON.stringify(session)); sent.clear();
      }
      const key = `${day}:${name}`;
      if (sent.has(key) || pending.has(key)) return;
      if (localStorage.getItem(consentKey) !== 'true') return stop('Anonymous usage sharing is off.');
      controller ||= new AbortController();
      pending.add(key);
      try {
        const response = await apiRequest('/api/product-events',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal,
          body:{consent:true,event:name,session:session.id}});
        if (response.available && response.data.accepted) {sent.add(key); status.textContent = 'Anonymous app steps are being shared.';}
      } finally {pending.delete(key);}
    } catch (error) {
      if (!stopped && error.name !== 'AbortError') stop('Usage sharing paused in this tab because it could not be saved. Turn it on again to retry.');
    }
  });
}
