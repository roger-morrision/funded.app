// Dependencies and mutable application state are read live through appState.
export function createShareConsentController(appState) {
  // app-source: 250
  function renderShareInsights(dashboard = appState.lastShareDashboard){
    if (dashboard) appState.lastShareDashboard = dashboard;
    const panel = document.querySelector('#referral-command-center .referral-share-panel');
    if (!panel) return;
    let insight = panel.querySelector('.share-insights');
    if (!insight) { insight = document.createElement('div'); insight.className = 'share-insights'; panel.append(insight); }
    insight.replaceChildren();
    const visits = dashboard?.available ? dashboard.data.shareVisits : null;
    const heading = document.createElement('strong'); heading.textContent = 'Share insights';
    const metrics = document.createElement('div'); metrics.className = 'referral-share-metrics';
    const metric = (value, label) => {
      const item = document.createElement('span');
      const count = document.createElement('b'); count.textContent = String(value);
      const caption = document.createElement('small'); caption.textContent = label;
      item.append(count, caption); metrics.append(item);
    };
    metric(appState.localShareActions(), 'Shares on this device');
    metric(dashboard?.available ? Number(dashboard.data.qualifiedCreators || 0) : '—', 'Qualified creators');
    metric(visits ? visits.consentedBrowsers : '—', 'Opted-in browsers');
    const note = document.createElement('small'); note.className = 'referral-share-note';
    note.textContent = visits
      ? `${visits.consentedVisitDays} visit days in the last ${visits.windowDays} days · ${visits.returningBrowsers} returning browsers. Visits count consenting browsers, not people.`
      : 'Visitor and creator counts need wallet access and an available referral service. Share actions are stored on this device.';
    insight.append(heading, metrics, note);
    if (visits && Object.keys(visits.byChannel || {}).length) {
      const channels = document.createElement('small'); channels.className = 'referral-share-source';
      channels.textContent = `Visit days by source: ${Object.entries(visits.byChannel).map(([source, count]) => `${source} ${count}`).join(' · ')}`;
      insight.append(channels);
    }
    if (dashboard?.available && dashboard.data.directCreatorsBySource && Object.keys(dashboard.data.directCreatorsBySource).length) {
      const activations = document.createElement('small'); activations.className = 'referral-share-source';
      activations.textContent = `Signed direct creators by source: ${Object.entries(dashboard.data.directCreatorsBySource).map(([source, count]) => `${source} ${count}`).join(' · ')}`;
      insight.append(activations);
    }
  }
  // app-source-end

  // app-source: 252
  async function recordConsentedShareVisit(){
    let saved;
    try { saved = JSON.parse(localStorage.getItem(appState.SHARE_VISIT_KEY) || 'null'); } catch { return; }
    if (!saved?.consent || !saved.visitorId) return;
    const query = new URLSearchParams(location.search);
    const incomingCode = appState.normalizeReferralCode(query.get('ref'));
    const code = saved.code || incomingCode;
    if (!code) return;
    const source = saved.source || String(query.get('src') || 'direct').slice(0, 24);
    if (!saved.code) localStorage.setItem(appState.SHARE_VISIT_KEY, JSON.stringify({ ...saved, code, source }));
    try { await appState.apiRequest('/api/shares/visit', { method:'POST', body:{ code, source, visitorId:saved.visitorId } }); } catch { /* Optional analytics never blocks the page. */ }
  }
  // app-source-end

  // app-source: 253
  function initShareVisitConsent(){
    const control = document.querySelector('#share-visit-consent');
    if (!control) return;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(appState.SHARE_VISIT_KEY) || 'null'); } catch {}
    control.checked = Boolean(saved?.consent);
    control.addEventListener('change', () => {
      if (control.checked) {
        const query = new URLSearchParams(location.search);
        const code = saved?.code || appState.normalizeReferralCode(query.get('ref')) || appState.getAppReferralAttribution()?.code || '';
        saved = { consent:true, visitorId:saved?.visitorId || crypto.randomUUID(), code,
          source:saved?.source || String(query.get('src') || 'direct').slice(0, 24) };
        localStorage.setItem(appState.SHARE_VISIT_KEY, JSON.stringify(saved));
        void appState.recordConsentedShareVisit();
      } else {
        saved = null;
        localStorage.removeItem(appState.SHARE_VISIT_KEY);
      }
    });
    if (control.checked) void appState.recordConsentedShareVisit();
  }
  // app-source-end

  return { renderShareInsights, recordConsentedShareVisit, initShareVisitConsent };
}
