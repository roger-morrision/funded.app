import { Buffer } from 'buffer';
import { icon } from './ui-icons.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;
document.querySelectorAll('.admin-navigation [data-icon]').forEach(node=>{node.innerHTML=icon(node.dataset.icon);});
const mobile=matchMedia('(max-width:700px)'),sidebar=document.querySelector('#sidebar'),opener=document.querySelector('#open-menu');
function setMenu(open,restoreFocus=false){
  const expanded=mobile.matches&&open;
  if(!expanded&&sidebar.contains(document.activeElement)){
    if(mobile.matches)opener.focus();else sidebar.querySelector('.brand').focus();
  }
  sidebar.inert=mobile.matches&&!expanded;sidebar.classList.toggle('open',expanded);
  if(sidebar.inert)sidebar.setAttribute('aria-hidden','true');else sidebar.removeAttribute('aria-hidden');
  opener.setAttribute('aria-expanded',String(expanded));document.querySelector('#menu-backdrop').hidden=!expanded;
  document.body.classList.toggle('menu-open',expanded);
  if(expanded)document.querySelector('#close-menu').focus();else if(restoreFocus&&mobile.matches)opener.focus();
}
opener.addEventListener('click',()=>setMenu(true));
for(const id of ['close-menu','menu-backdrop'])document.querySelector(`#${id}`).addEventListener('click',()=>setMenu(false,true));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebar.classList.contains('open'))setMenu(false,true);});
mobile.addEventListener('change',()=>setMenu(false));setMenu(false);

await import('./admin-page.js');

await import('./service-status-ui.js');

// Keep the balance summary above panels added by optional admin features.
document.querySelector('#workspace')?.prepend(document.querySelector('#summary'));
