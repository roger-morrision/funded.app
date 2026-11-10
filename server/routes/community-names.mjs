import {PublicKey} from '@solana/web3.js';
import {createCommunityNameReader} from '../community-names.mjs';
export function createCommunityNameRoutes({store,respond,readName=createCommunityNameReader()}){
  return async(req,res,url)=>{
    const match=url.pathname.match(/^\/api\/tokens\/([^/]+)\/community-names$/);if(!match)return false;
    if(req.method!=='GET'){respond(res,405,{error:'Method not allowed.'});return true;}
    let mint;try{mint=new PublicKey(match[1]).toBase58();}catch{respond(res,400,{error:'Invalid token.'});return true;}
    // Only read saved, signed token metadata. Callers cannot submit arbitrary fetch targets.
    const metadata=await store.readMetadata(mint);const names={};
    await Promise.all(['telegram','discord'].map(async type=>{if(metadata?.[type])names[type]=await readName(metadata[type],type);}));
    respond(res,200,{mint,names});return true;
  };
}
