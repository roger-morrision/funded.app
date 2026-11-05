import { el, reportContextLink } from './view-utils.js';
export function mountJourneySupport() {
  for (const [id,operation] of [['launch-status','launch'],['trade-status','trade'],['airdrop-selected-status','claim'],['list-payment-status','listing']]) {
    const status = document.getElementById(id); if (!status) continue;
    status.dataset.inlineStatus = '';
    const report = reportContextLink('Report a problem with this step'); report.className = 'flow-support-link';
    report.addEventListener('pointerdown', update); report.addEventListener('focus', update);
    function update() {
      const url = new URL(location.href); url.searchParams.set('operation', operation); url.searchParams.set('stage', 'verification-unavailable');
      report.dataset.reportContext = url.href;
    }
    const sync = () => { report.hidden = !/failed|unavailable|stopped|pending|could not|timeout/i.test(status.textContent); update(); };
    status.after(report); new MutationObserver(sync).observe(status, {childList:true, subtree:true, characterData:true}); sync();
  }
  for (const selector of ['#list-token-preview','.launch-facts','#launch-package-terms','#launch-agency-help','#airdrop-selected-program','#financial-engine','.market-freshness']) {
    document.querySelectorAll(selector).forEach(node => { node.dataset.inlineStatus = ''; });
  }
  const profile = document.querySelector('#profile');
  const scope = el('p', 'Device settings and reminders stay in this browser. Optional X sync transfers only reviewed follows and reminders. On-chain activity and published creator updates are public. Sign out to end account access.', 'flow-note');
  profile?.querySelector('.section-heading')?.after(scope);
}
