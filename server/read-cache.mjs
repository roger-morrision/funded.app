export function createReadCache({ttlMs=15000,maxEntries=100}={}) {
  const entries=new Map();
  return async(key,loader)=>{
    const existing=entries.get(key);if(existing&&(existing.pending||existing.expires>Date.now()))return existing.promise;
    if(entries.size>=maxEntries)entries.delete(entries.keys().next().value);
    const entry={pending:true,expires:0};
    entry.promise=Promise.resolve().then(loader).then(value=>{entry.pending=false;entry.expires=Date.now()+ttlMs;return value;},error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
    entries.set(key,entry);return entry.promise;
  };
}
