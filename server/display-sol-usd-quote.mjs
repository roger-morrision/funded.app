// Display-only availability. Payment quotes and signer observations retain
// their own approved readers; this fallback cannot authorize a financial action.
// https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices#get-spot-price
export function createDisplaySolUsdQuoteReader({readPrimary,fetchImpl=globalThis.fetch,now=Date.now,
  ttlMs=30_000,maxAgeMs=60_000,primaryWaitMs=1500,fallbackTimeoutMs=3000,retryMs=10_000}={}){
  if(typeof readPrimary!=='function')throw new TypeError('A primary quote reader is required.');
  let cached=null,expiresAt=0,pending=null,retryAt=0;
  const fresh=quote=>{
    const priceUsd=Number(quote?.priceUsd),at=Date.parse(quote?.fetchedAt),age=now()-at;
    return Number.isFinite(priceUsd)&&priceUsd>0&&Number.isFinite(at)&&age>=0&&age<maxAgeMs
      &&typeof quote.source==='string'&&quote.source
      ?{priceUsd,source:quote.source,fetchedAt:quote.fetchedAt}:null;
  };
  async function primary(){
    let timer;
    try{return await Promise.race([
      Promise.resolve().then(readPrimary).then(fresh,()=>null),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),primaryWaitMs);}),
    ]);}finally{clearTimeout(timer);}
  }
  async function fallback(){
    if(retryAt>now())return null;
    const requestedAt=now();
    try{
      const response=await fetchImpl('https://api.coinbase.com/v2/prices/SOL-USD/spot',{
        headers:{accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(fallbackTimeoutMs),
      });
      if(!response.ok)throw new Error('Display quote unavailable.');
      const {data}=await response.json(),amount=data?.amount;
      if(data?.base!=='SOL'||data?.currency!=='USD'||typeof amount!=='string'||!/^\d+(?:\.\d+)?$/.test(amount))
        throw new Error('Unexpected display quote pair.');
      const ageHeader=response.headers?.get('age'),dateHeader=response.headers?.get('date');
      if(ageHeader!=null&&(!/^\d+$/.test(ageHeader)||Number(ageHeader)*1000>=maxAgeMs))throw new Error('Stale display quote.');
      const receivedAt=now(),ageMs=Number(ageHeader||0)*1000;
      const datedAt=dateHeader?Date.parse(dateHeader):receivedAt-ageMs;
      if(!Number.isFinite(datedAt)||datedAt>receivedAt+5000||receivedAt-datedAt>=maxAgeMs)
        throw new Error('Stale display quote.');
      const quote=fresh({priceUsd:Number(amount),source:'coinbase',fetchedAt:new Date(Math.min(requestedAt,datedAt,receivedAt-ageMs)).toISOString()});
      if(!quote)throw new Error('Invalid display quote.');
      retryAt=0;return quote;
    }catch{retryAt=now()+retryMs;return null;}
  }
  return async function readDisplayQuote(){
    if(cached&&expiresAt>now()&&fresh(cached))return{...cached};
    if(pending)return pending.then(quote=>quote?{...quote}:null);
    pending=(async()=>{
      try{
        const quote=fresh(await primary()||await fallback());
        if(!quote)return null;
        cached=quote;expiresAt=Math.min(now()+ttlMs,Date.parse(quote.fetchedAt)+maxAgeMs);
        return quote;
      }finally{pending=null;}
    })();
    const quote=await pending;return quote?{...quote}:null;
  };
}
