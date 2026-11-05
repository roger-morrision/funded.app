// Metadata enriches the existing verified balances; it never supplies prices,
// quantities, launch eligibility, or transaction permissions.
export async function enrichHoldingsMetadata({holdings,cluster,apiRequest,isCurrent,onUpdate}) {
  const mints=[...new Set(holdings.map(row=>row.mint).filter(mint=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)))];
  for(let start=0;start<mints.length&&isCurrent();start+=8){
    const batch=mints.slice(start,start+8);
    try{
      const result=await apiRequest('/api/tokens/metadata?mints='+batch.join(','));
      if(!isCurrent())return;
      if(!result.available||result.data?.cluster!==cluster||!Array.isArray(result.data.items))continue;
      const records=new Map(result.data.items.filter(item=>batch.includes(item.mint)&&item.cluster===cluster&&item.source==='onchain-token-metadata').map(item=>[item.mint,item]));
      for(const holding of holdings){const metadata=records.get(holding.mint);if(metadata)holding.metadata=metadata;}
      if(records.size)onUpdate();
    }catch{/* Metadata availability must never replace or erase verified balances. */}
  }
}

export function holdingImageUrl(value) {
  if(typeof value!=='string'||value.length>2048)return null;
  if(/^\/devnet-images\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))return value;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
