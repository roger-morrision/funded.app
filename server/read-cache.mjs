// Shared in-flight and short-TTL cache for read-only loaders.
// staleMs (opt-in, default 0): after ttlMs, keep serving the last value for up to staleMs
// while one background refresh runs, so the first visitor after expiry does not wait.
// A failed refresh keeps the last value until it is older than ttlMs + staleMs.
export function createReadCache({ttlMs=15000,maxEntries=100,staleMs=0,now=Date.now}={}) {
  const entries=new Map();
  const load=(key,loader,previous)=>{
    if(!previous&&entries.size>=maxEntries)entries.delete(entries.keys().next().value);
    const entry={pending:true,expires:0,value:previous?.value,hasValue:Boolean(previous?.hasValue),staleUntil:previous?.staleUntil||0};
    entry.promise=Promise.resolve().then(loader).then(value=>{
      entry.pending=false;entry.value=value;entry.hasValue=true;entry.expires=now()+ttlMs;entry.staleUntil=entry.expires+staleMs;return value;
    },error=>{
      if(entries.get(key)===entry){
        if(previous?.hasValue&&previous.staleUntil>now())entries.set(key,previous);
        else entries.delete(key);
      }
      throw error;
    });
    entries.set(key,entry);return entry;
  };
  return async(key,loader)=>{
    const existing=entries.get(key);
    if(existing&&(existing.pending&&!existing.hasValue||existing.expires>now()))return existing.promise;
    if(existing?.hasValue&&existing.staleUntil>now()){
      if(!existing.pending){const refresh=load(key,loader,existing);refresh.promise.catch(()=>{});}
      return existing.value;
    }
    return load(key,loader,null).promise;
  };
}
