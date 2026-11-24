// Refresh counts independently of the slower top-account list. Failed reads
// retain their original timestamp and are explicitly marked stale.
export function createHolderCountReader({free,fetchBirdeye,now=Date.now,freshMs=60_000,retryMs=15_000}) {
  const cache=new Map(),pending=new Map();
  const valid=value=>Number.isSafeInteger(value)&&value>=0;
  return function read(mint) {
    const hit=cache.get(mint);
    if(hit && now()<hit.retryAt)return Promise.resolve(hit.data);
    if(pending.has(mint))return pending.get(mint);
    const task=(async()=>{
      let count=null,source=null,asOf=null;
      const gecko=await free.geckoTokenInfo(mint).catch(()=>null);
      if(valid(gecko?.holders?.count)){
        count=gecko.holders.count;source='geckoterminal';
        if(Number.isFinite(Date.parse(gecko.holders.last_updated)))asOf=gecko.holders.last_updated;
      }
      if(count==null){const jup=await free.jupToken(mint).catch(()=>null);
        if(valid(jup?.holderCount)){count=jup.holderCount;source='jupiter';}}
      if(count==null){const result=await fetchBirdeye('/defi/token_overview',{address:mint}).catch(()=>null);
        if(valid(result?.data?.holder)){count=result.data.holder;source='birdeye';}}
      const data=count!=null?{holderCount:count,holderCountSource:source,holderCountAsOf:asOf,
        holderCountCheckedAt:new Date(now()).toISOString(),holderCountStale:false}
        :{...(hit?.data||{holderCount:null,holderCountSource:null,holderCountAsOf:null,holderCountCheckedAt:null}),holderCountStale:true};
      cache.set(mint,{data,retryAt:now()+(count==null?retryMs:freshMs)});
      if(cache.size>2000)cache.delete(cache.keys().next().value);
      return data;
    })().finally(()=>pending.delete(mint));
    pending.set(mint,task);return task;
  };
}
