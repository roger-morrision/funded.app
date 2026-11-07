const regions = new WeakMap();
export function asyncRegion(target, retry) {
  if (regions.has(target)) { const value=regions.get(target);value.retry=retry;return value; }
  const document=target.ownerDocument,bar=document.createElement('div');bar.className='async-region-status';
  const message=document.createElement('span');message.setAttribute('role','status');
  const button=document.createElement('button');button.type='button';button.textContent='Retry';button.hidden=true;
  bar.append(message,button);target.before(bar);
  const value={retry,busy:false,checkedAt:null,set(state,note='') {
    value.busy=state==='loading';target.setAttribute('aria-busy',String(value.busy));bar.dataset.state=state;
    button.hidden=false;button.disabled=value.busy;button.textContent=value.busy?'Checking…':state==='unavailable'?'Retry':'Refresh';
    if(state==='ready'||state==='empty')value.checkedAt=new Date();
    message.textContent=state==='loading'?'Checking data…':state==='unavailable'?`Data unavailable. ${note || 'Retry to check again.'}`
      : `${state==='empty'?'No records returned. ':''}Updated ${value.checkedAt.toLocaleTimeString()}. ${note}`;
  }};
  button.addEventListener('click',()=>{if(!value.busy)void value.retry?.();});regions.set(target,value);return value;
}
