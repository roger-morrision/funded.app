export function mountHomeDiscovery(document = globalThis.document) {
  const board = document.querySelector('.home-launch-board');
  if (!board || document.getElementById('home-discovery-controls')) return;
  const nav = document.createElement('nav'); nav.id='home-discovery-controls';
  nav.setAttribute('aria-label','Discover coins');
  nav.innerHTML='<div role="group" aria-label="Coin feed"><button type="button" data-home-discovery="new" aria-pressed="true">New</button><button type="button" data-home-discovery="trending" aria-pressed="false">Trending</button><button type="button" data-home-discovery="near" aria-pressed="false">Near graduation</button><button type="button" data-home-discovery="saved" aria-pressed="false">Favorites</button><button type="button" data-home-discovery="following" aria-pressed="false">Following</button></div>';
  board.prepend(nav); board.dataset.discovery='new';
  const note=document.createElement('p');note.id='home-ranking-note';note.className='discovery-note';
  note.textContent='';
  nav.after(note);note.hidden=true;
  const select=value=>{
    board.dataset.discovery=value;
    note.hidden=!['trending','following'].includes(value);
    note.textContent=value==='following'?'':'';
    for(const item of nav.querySelectorAll('button'))item.setAttribute('aria-pressed',String(item.dataset.homeDiscovery===value));
    globalThis.window.dispatchEvent(new Event('funded:home-discovery'));
  };
  nav.addEventListener('click',event=>{
    const button=event.target.closest('[data-home-discovery]');if(!button)return;
    select(button.dataset.homeDiscovery);
  });
  globalThis.window.addEventListener('funded:route-change',event=>{if(event.detail?.route==='overview')select('new');});
}
