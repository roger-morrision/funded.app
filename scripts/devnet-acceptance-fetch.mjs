// Public Devnet acceptance runs share a conservative read budget. Retry reads
// only; a transaction submission must be reconciled by its recorded signature.
export function devnetAcceptanceFetch({intervalMs=500}={}) {
  let tail=Promise.resolve(),last=0;
  return (url,options={})=>{
    const run=async()=>{
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const request=JSON.parse(options.body||'{}');
      const readOnly=/^get/.test(request.method||'');
      for(let retry=0;;retry++){
        await wait(Math.max(0,intervalMs-(Date.now()-last)));last=Date.now();
        const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
        if(response.status!==429||!readOnly||retry>=3)return response;
        const seconds=Math.min(60,Math.max(15,Number(response.headers.get('retry-after'))||15));
        await response.text();console.log(JSON.stringify({stage:'acceptance-read-backoff',method:request.method,seconds}));
        await wait(seconds*1000);
      }
    };
    const result=tail.then(run);tail=result.catch(()=>{});return result;
  };
}
