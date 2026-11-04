export function revealPortfolioFocus(element,document=globalThis.document){
  const win=document?.defaultView;if(!win||!element)return;
  win.requestAnimationFrame(()=>{
    if(document.activeElement!==element||!element.getClientRects().length)return;
    const rect=element.getBoundingClientRect(),style=win.getComputedStyle(element);
    const margin=(parseFloat(style.outlineWidth)||0)+Math.max(0,parseFloat(style.outlineOffset)||0);
    const header=document.querySelector('.topbar'),nav=document.querySelector('.mobile-workspace-nav');
    const top=header?.getClientRects().length?Math.max(0,header.getBoundingClientRect().bottom):0;
    const bottom=nav?.getClientRects().length?Math.min(win.innerHeight,nav.getBoundingClientRect().top):win.innerHeight;
    if(rect.height+2*margin>bottom-top)return;
    if(rect.top-margin<top||rect.bottom+margin>bottom||rect.left-margin<0||rect.right+margin>win.innerWidth)
      element.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});
  });
}
export function initializePortfolioFocus(){
  document.querySelector('#my-launches')?.addEventListener('focusin',event=>{
    if(event.target.matches('a,button,input,select,textarea'))revealPortfolioFocus(event.target);
  });
}
