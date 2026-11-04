// Recover focus synchronously when a reset action disappears after rendering.
export function focusFilterRecovery(control) {
  if(!control?.getClientRects().length)return;
  const document=control.ownerDocument,view=document.defaultView;
  control.focus({preventScroll:true});if(document.activeElement!==control)return;
  control.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  const box=control.getBoundingClientRect(),style=view.getComputedStyle(control);
  const edge=(parseFloat(style.outlineWidth)||0)+Math.max(0,parseFloat(style.outlineOffset)||0);
  const header=document.querySelector('.topbar'),nav=document.querySelector('.mobile-workspace-nav');
  const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0;
  const bottom=nav?.getClientRects().length?Math.min(view.innerHeight,nav.getBoundingClientRect().top):view.innerHeight;
  const delta=box.top-edge<top?box.top-edge-top:Math.max(0,box.bottom+edge-bottom);
  if(delta)view.scrollBy({top:delta<0?Math.floor(delta):Math.ceil(delta),behavior:'instant'});
}
