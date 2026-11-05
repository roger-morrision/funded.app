import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,getMetadataPointerState,getTokenMetadata } from '@solana/spl-token';
import { tokenMetadataAddress,TOKEN_METADATA_PROGRAM_ID } from './token-metadata.mjs';
import { publicMetadataUrl,readPublicMetadataJson } from './public-metadata-json.mjs';

const clean=(value,max)=>typeof value==='string' && value.length<=max && !/[\u0000-\u001f\u007f\ufffd]/.test(value.trim()) ? value.trim() : '';
export function portfolioMetaplexMetadata(account,mint) {
  if (!account?.owner?.equals(TOKEN_METADATA_PROGRAM_ID)) return null;
  const data=Buffer.from(account.data||[]);
  if (data.length<69 || data[0]!==4 || !new PublicKey(data.subarray(33,65)).equals(new PublicKey(mint))) return null;
  let offset=65;
  const read=max=>{if(offset+4>data.length)throw Error('Truncated metadata');const size=data.readUInt32LE(offset);offset+=4;if(size>max||offset+size>data.length)throw Error('Invalid metadata');const value=data.subarray(offset,offset+size).toString('utf8').replace(/\0+$/g,'');offset+=size;return clean(value,max);};
  try {const name=read(32),symbol=read(10),uri=read(200);return name||symbol?{name,symbol,uri}:null;}catch{return null;}
}

export function createPortfolioMetadataReader({connection,cluster,readJson=readPublicMetadataJson,now=Date.now}) {
  const cache=new Map(),pending=new Map();
  const load=async mint=>{
    const key=new PublicKey(mint);
    const [account,metadataAccount]=await connection.getMultipleAccountsInfo([key,tokenMetadataAddress(key)],'finalized');
    if(!account || ![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(id=>account.owner.equals(id)))return null;
    const state=unpackMint(key,account,account.owner);
    if(!state.isInitialized)return null;
    let metadata=portfolioMetaplexMetadata(metadataAccount,key);
    if(!metadata && account.owner.equals(TOKEN_2022_PROGRAM_ID)){
      const pointer=getMetadataPointerState(state);
      // Inline Token-2022 metadata. Other programs' custom layouts are not guessed.
      if(pointer?.metadataAddress?.equals(key)){
        const value=await getTokenMetadata({getAccountInfo:async()=>account},key,'finalized',TOKEN_2022_PROGRAM_ID);
        if(value?.mint?.equals(key))metadata={name:clean(value.name,256),symbol:clean(value.symbol,32),uri:clean(value.uri,2048)};
      }
    }
    if(!metadata || !metadata.name&&!metadata.symbol)return null;
    let image=null;
    const uri=publicMetadataUrl(metadata.uri);
    if(uri)try{const json=await readJson(uri);image=publicMetadataUrl(json.image);}catch{/* Keep the on-chain identity if artwork is unavailable. */}
    return {mint,cluster,name:metadata.name,symbol:metadata.symbol,image,source:'onchain-token-metadata'};
  };
  return async function read(mint){
    const key=new PublicKey(mint).toBase58(),cached=cache.get(key);
    if(cached&&cached.expires>now())return cached.value;
    if(pending.has(key))return pending.get(key);
    // Bound total RPC/JSON work even across concurrent public requests.
    if(pending.size>=8)return null;
    const task=load(key).then(value=>{if(cache.size>=1000)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:now()+(value?300000:30000)});return value;}).catch(()=>null).finally(()=>pending.delete(key));
    pending.set(key,task);return task;
  };
}
