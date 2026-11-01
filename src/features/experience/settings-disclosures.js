import { disclose } from '../workspace/dom.js';

export function mountSettingsDisclosures() {
  for (const [id,label] of [['issue-reports','Report a problem'],['notification-preferences','Notification preferences'],['trade-preferences','Trade limits'],['preference-transfer','Import, export & sync']]) {
    const panel=document.getElementById(id);
    const details=disclose(panel,label,{id:id+'-details'});
    if(!details)continue;
    details.classList.add('settings-disclosure');
    const summary=details.querySelector('summary');summary.id=id+'-summary';
    panel.setAttribute('aria-labelledby',summary.id);panel.querySelector(':scope > h2').hidden=true;
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-report-context]')) {
      const details=document.getElementById('issue-reports-details');if(details)details.open=true;
    }
  });
}
