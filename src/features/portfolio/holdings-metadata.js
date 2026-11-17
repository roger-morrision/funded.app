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

// Mainnet display-only market price and logo from the server's Birdeye cache.
export async function enrichHoldingsMarket({holdings,cluster,apiRequest,isCurrent,onUpdate}) {
  if(cluster==='devnet')return;
  const mints=[...new Set(holdings.map(row=>row.mint).filter(mint=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)))];
  for(let start=0;start<mints.length&&isCurrent();start+=50){
    try{
      const result=await apiRequest('/api/tokens/market?mints='+mints.slice(start,start+50).join(','));
      if(!isCurrent())return;
      if(!result.available||result.data?.cluster!==cluster||!Array.isArray(result.data.items))continue;
      const rows=new Map(result.data.items.map(item=>[item.mint,item]));
      for(const holding of holdings){const row=rows.get(holding.mint);if(row)holding.market={...holding.market,...Object.fromEntries(Object.entries(row).filter(([,value])=>value!=null))};}
      if(rows.size)onUpdate();
    }catch{/* Prices are optional display data. */}
  }
}

export function holdingImageUrl(value) {
  if(typeof value!=='string'||value.length>2048)return null;
  if(/^\/devnet-images\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))return value;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

// Mainnet: the server's public holdings read combines DexScreener, Jupiter and
// the token cache, so it often knows names and prices the Birdeye read lacks.
// Fill only missing display fields; balances never change. Names the server is
// still looking up fill in on one later retry.
export async function enrichHoldingsFromPublic({holdings,cluster,owner,apiRequest,isCurrent,onUpdate,retryMs=8000,wait=ms=>new Promise(done=>setTimeout(done,ms))}) {
  if(cluster==='devnet'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner||''))return;
  for(let attempt=0;attempt<2&&isCurrent();attempt++){
    if(attempt)await wait(retryMs);
    if(!isCurrent())return;
    let rows;
    try{
      const result=await apiRequest(`/api/wallets/${encodeURIComponent(owner)}/holdings`);
      if(!result.available||!Array.isArray(result.data?.accounts))continue;
      rows=new Map(result.data.accounts.map(row=>[row.mint,row.market||{}]));
    }catch{continue;}
    if(!isCurrent())return;
    let changed=false;
    for(const holding of holdings){
      const found=rows.get(holding.mint);if(!found)continue;
      const market={...(holding.market||{mint:holding.mint})};
      for(const key of ['symbol','name','logoUri','priceUsd'])if(market[key]==null&&found[key]!=null){market[key]=found[key];changed=true;}
      holding.market=market;
    }
    if(changed)onUpdate();
    if(!holdings.some(holding=>!holding.market?.symbol&&!holding.metadata?.symbol))return;
  }
}
