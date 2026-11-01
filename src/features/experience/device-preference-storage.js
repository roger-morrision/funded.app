// A browser write can fail silently or leave only part of a multi-key save.
// Notify consumers only after every stored value has been read back exactly.
export function saveDevicePreferences(entries,storage=globalThis.localStorage){
  const prior=entries.map(([key])=>storage.getItem(key));
  try{
    for(const[key,value]of entries)storage.setItem(key,value);
    if(entries.some(([key,value])=>storage.getItem(key)!==value))throw new Error('Saved preferences could not be verified.');
  }catch(error){
    for(let index=0;index<entries.length;index++){
      const key=entries[index][0];
      try{if(prior[index]===null)storage.removeItem(key);else storage.setItem(key,prior[index]);}catch{}
    }
    throw error;
  }
}
