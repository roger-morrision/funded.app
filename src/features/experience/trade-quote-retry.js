// Explicit retries only: a failed quote never starts a background retry loop.
export function createTradeQuoteRetry(button,{retry,isCurrent,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let timer=null,availableAt=0;
  function reset(){clearTimer(timer);timer=null;availableAt=0;if(button){button.hidden=true;button.disabled=true;}}
  function tick(){
    if(!button||button.hidden)return;
    const seconds=Math.max(0,Math.ceil((availableAt-now())/1000));
    button.disabled=seconds>0;button.textContent=seconds?`Retry quote (${seconds}s)`:'Retry quote';
    if(seconds)timer=setTimer(tick,1000);
  }
  button?.addEventListener?.('click',()=>{
    if(button.hidden||button.disabled||now()<availableAt||!isCurrent())return;
    reset();retry();
  });
  return {reset,failed(){reset();if(!button)return;button.hidden=false;availableAt=now()+15000;tick();}};
}
