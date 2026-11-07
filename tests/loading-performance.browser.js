import { loadTokenArtwork } from '../src/features/shared/token-artwork.js';

// Isolated browser fixture: image transport is mocked; DOM visibility is real.
export async function runArtworkChecks() {
  const OriginalImage=window.Image, requests=[], results=[];
  const root=document.createElement('section');
  root.style='position:fixed;top:50px;left:20px;z-index:1000;background:white;color:black';
  document.body.append(root);
  window.Image=function(){const image=document.createElement('img');Object.defineProperty(image,'src',{set(value){requests.push(value);queueMicrotask(()=>image.onload?.());}});return image;};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);};
  const mint='Ganx3kyKmCfgaBsxYTp8X52pTfi9L5dm8BQAmFuvEEEZ';
  const uri='https://gateway.pinata.cloud/ipfs/bafkreidi4gyokdg3gchw3qui2dadvepyouwexspms2aryitjzrfqf6whca';
  try {
    root.hidden=true;
    const avatar=document.createElement('span');avatar.textContent='QA';root.append(avatar);
    loadTokenArtwork(avatar,mint,uri);await wait(150);
    check('hidden page starts no image request',requests.length===0);
    root.hidden=false;await wait(250);
    check('visible avatar loads same-origin artwork',requests.length===1&&requests[0]==='/devnet-images/'+mint);
    check('loaded image replaces initials',avatar.querySelector('img'));
    loadTokenArtwork(avatar,mint,uri);await wait(50);
    check('repeat renders reuse the loaded avatar',requests.length===1);
    root.hidden=true;const detached=document.createElement('span');detached.textContent='Other';root.append(detached);
    loadTokenArtwork(detached,mint,uri);detached.remove();root.hidden=false;await wait(150);
    check('removed avatars never start requests',requests.length===1);
    return {mode:'mocked image transport, real browser visibility',results};
  } finally {window.Image=OriginalImage;root.remove();}
}
