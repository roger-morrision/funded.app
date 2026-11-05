export function renderMarketStatus({mint,observedAt,coverage,available,retry},document=globalThis.document) {
  const page=document?.querySelector?.('#coin-page');if(!page)return;
  let node=page.querySelector('#coin-market-status');
  if(!node){node=document.createElement('div');node.id='coin-market-status';node.innerHTML='<p role="status"></p><button type="button">Refresh market data</button>';page.querySelector('.coin-header')?.after(node);if(!node.isConnected)page.prepend(node);}
  const at=Date.parse(observedAt||'');
  node.querySelector('p').textContent=available
    ? `Trade history checked${Number.isFinite(at)?' '+new Date(at).toLocaleTimeString():''}. ${coverage==='partial'?'Some history is missing.':'Confirmed observed trades.'} Quotes require a fresh reserve check.`
    : 'Market history is unavailable. This does not mean zero activity. Refresh to retry; trading still requires verified reserves.';
  const button=node.querySelector('button');button.disabled=false;button.hidden=Boolean(available)&&coverage==='complete';
  button.onclick=async()=>{button.disabled=true;try{await retry();}finally{if(node.isConnected)button.disabled=false;}};
  node.dataset.mint=mint;
}
