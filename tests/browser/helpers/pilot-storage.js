import { expect } from '@playwright/test';

export const LEGACY_RECORD='funded.vip.pilot.v1';
export const LEGACY_GRANT='funded.vip.pilot.consent.v2';
export async function pilotSnapshot(page){
  await idlePilot(page);
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('funded-pilot-local',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('state','readonly'),store=tx.objectStore('state');
      const get=(window.qaPilotOriginalGet||IDBObjectStore.prototype.get).call(store,'record-and-consent');let snapshot;
      get.onsuccess=()=>{snapshot=get.result;};
      tx.oncomplete=()=>{db.close();resolve(snapshot?{...snapshot,record:snapshot.record?JSON.parse(snapshot.record):null}:null);};
      tx.onabort=()=>{db.close();reject(tx.error||new Error('Snapshot read aborted'));};
    };
  }));
}
export async function pilotRecord(page){return(await pilotSnapshot(page))?.record??null;}
export async function idlePilot(page){await expect(page.locator('#pilot-local-panel')).toHaveAttribute('aria-busy','false');}

export async function failPilotStorage(page,mode){
  await page.evaluate(mode=>{
    const get=IDBObjectStore.prototype.get,put=IDBObjectStore.prototype.put;
    window.qaPilotOriginalGet=get;
    const target=store=>store.transaction.db.name==='funded-pilot-local'&&store.name==='state';
    IDBObjectStore.prototype.get=function(...args){if(mode==='read'&&target(this))throw new DOMException('Storage unavailable','SecurityError');return get.apply(this,args);};
    IDBObjectStore.prototype.put=function(...args){
      if(target(this)&&mode==='write')throw new DOMException('Quota exceeded','QuotaExceededError');
      const request=put.apply(this,args);
      if(target(this)&&mode==='abort')request.addEventListener('success',()=>{try{this.transaction.abort();}catch{}},{once:true});
      return request;
    };
    window.qaRestorePilotStorage=()=>{IDBObjectStore.prototype.get=get;IDBObjectStore.prototype.put=put;delete window.qaPilotOriginalGet;};
  },mode);
}
export async function restorePilotStorage(page){await page.evaluate(()=>window.qaRestorePilotStorage?.());}

// Keep a genuine IndexedDB transaction open so both native opt-in events queue
// before either writer can commit. Request chaining controls order, not a delay.
export async function holdPilotTransaction(page){
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('funded-pilot-local',1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('state','readwrite'),store=tx.objectStore('state');let release=false,ready=false;
      window.qaReleasePilotTransaction=()=>{release=true;};
      const pump=()=>{const read=store.get('record-and-consent');read.onsuccess=()=>{if(!ready){ready=true;resolve();}if(!release)pump();};};
      tx.oncomplete=()=>db.close();tx.onabort=()=>{db.close();reject(tx.error||new Error('Hold transaction aborted'));};pump();
    };
  }));
}
export async function releasePilotTransaction(page){await page.evaluate(()=>window.qaReleasePilotTransaction());}
