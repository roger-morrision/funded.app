import {tabs} from '../workspace/dom.js';
import {paginateHistory} from '../../../history-pagination.js';

let latest=null;
export function updateReferralList(data){latest=data;render();}
function render(){
  const root=document.querySelector('#my-referral-list');if(!root)return;
  root.replaceChildren();
  if(!latest){root.textContent='-';return;}
  const rows=latest.referrals;
  if(!Array.isArray(rows)){root.textContent='-';return;}
  if(!rows.length){root.textContent='No referrals yet. Share your invite link to get started.';return;}
  for(const item of rows){
    if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.wallet)||![1,2,3].includes(item.level))continue;
    const row=document.createElement('article');row.className='referral-ledger-row';
    const identity=document.createElement('div'),link=document.createElement('a');
    link.href=`/wallet/${encodeURIComponent(item.wallet)}`;link.textContent=`${item.wallet.slice(0,6)}…${item.wallet.slice(-6)}`;link.title=item.wallet;
    const level=document.createElement('small');level.textContent=item.level===1?'Level 1 · Direct':`Level ${item.level}`;
    identity.append(link,level);
    const status=document.createElement('span');status.textContent=item.qualified?'Earning fees':'No qualifying fees yet';
    row.append(identity,status);root.append(row);
  }
  paginateHistory(root,{label:'My referral list',selector:'.referral-ledger-row',key:latest.wallet});
}
export function mountReferralList(){
  const root=document.querySelector('#referral-command-center');if(!root||document.querySelector('#my-referral-list'))return;
  const history=root.querySelector('.referral-ledger-panel');if(!history)return;
  const panels=document.createElement('section');panels.id='referral-views';history.before(panels);
  const list=document.createElement('article');list.className='panel';list.id='referral-network-panel';
  list.innerHTML='<h3>My referral list</h3><p>Your direct referrals and two further levels.</p><div id="my-referral-list" aria-live="polite">-</div>';
  panels.append(history,list);
  tabs(panels,[{key:'payouts',label:'Rewards & payouts',panel:history},{key:'referrals',label:'My referral list',panel:list}],'Referral dashboard');
  window.addEventListener('funded:reward-identity-change',()=>updateReferralList(null));
  render();
}
