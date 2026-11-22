import {reviewedMainnetManifest} from '../../../mainnet-program.js';

export async function loadPrimaryRichForApp(cluster,{request=fetch,release=reviewedMainnetManifest()}={}){
  if(cluster!=='mainnet-beta'||!release)return undefined;
  // An unavailable activated config disables RICH actions; never fall back to
  // an obsolete build-time mint after the owner has rotated it.
  try{
    const response=await request('/api/token-config',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    const config=await response.json();
    if(!response.ok||config.cluster!==cluster||config.programId!==release.programId||config.configuration!=='onchain-v1'
      ||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(config.fundedMint)||!/^\d+$/.test(config.revision)||BigInt(config.revision)<1n)
      throw Error('Primary RICH configuration is unavailable.');
    return config;
  }catch{return{fundedMint:'',pool:null};}
}
