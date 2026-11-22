import {Connection} from '@solana/web3.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {readRichAssets} from '../rich-assets.js';
import {assertRpcNetwork} from '../solana-network.js';

// No environment mint overrides an activated on-chain configuration. Callers
// keep one snapshot per quote; completed receipts keep their original mint.
export function createPrimaryRichReader({cluster,connection,fundedMint,fundedPool,release=reviewedMainnetManifest()}){
  return async()=>{
    if(cluster!=='mainnet-beta'||!release)return{cluster,fundedMint:fundedMint||null,pool:fundedPool||null,configuration:'environment'};
    await assertRpcNetwork(connection,cluster);
    const assets=await readRichAssets(connection,release.programId);
    return{cluster,fundedMint:String(assets.mint),pool:assets.venue===0?String(assets.pool):null,
      market:String(assets.pool),venue:assets.venue,revision:assets.revision,programId:release.programId,
      tokenProgram:String(assets.tokenProgram),configuration:'onchain-v1'};
  };
}

export function primaryRichRuntime(env,cluster){
  const solanaRpcUrl=String(env.SOLANA_RPC_URL||'https://api.devnet.solana.com').trim();
  const fundedTokenMint=String(env.FUNDED_TOKEN_MINT||env.VITE_FUNDED_TOKEN_MINT||'').trim();
  const fundedSwapPool=String(env.FUNDED_SWAP_POOL||env.VITE_FUNDED_SWAP_POOL||'').trim();
  const getPrimaryRich=createPrimaryRichReader({cluster,connection:new Connection(solanaRpcUrl,'finalized'),fundedMint:fundedTokenMint,fundedPool:fundedSwapPool});
  return{solanaRpcUrl,fundedTokenMint,fundedSwapPool,getPrimaryRich};
}
