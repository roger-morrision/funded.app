import {Connection} from '@solana/web3.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {readRichAssets} from '../rich-assets.js';
import {assertRpcNetwork} from '../solana-network.js';
import {configuredDevnetProgram} from '../configured-devnet-program.js';

// No environment mint overrides an activated on-chain configuration. Callers
// keep one snapshot per quote; completed receipts keep their original mint.
export function createPrimaryRichReader({cluster,connection,fundedMint,fundedPool,programId,release=reviewedMainnetManifest()}){
  const active=cluster==='devnet'?configuredDevnetProgram(cluster,programId):release;
  return async()=>{
    if(!active)return{cluster,fundedMint:fundedMint||null,pool:fundedPool||null,configuration:'environment'};
    await assertRpcNetwork(connection,cluster);
    const assets=await readRichAssets(connection,active.programId);
    return{cluster,fundedMint:String(assets.mint),pool:assets.venue===0?String(assets.pool):null,
      market:String(assets.pool),venue:assets.venue,revision:assets.revision,programId:active.programId,
      authority:String(assets.authority),pendingAuthority:String(assets.pendingAuthority),
      tokenProgram:String(assets.tokenProgram),configuration:'onchain-v1'};
  };
}

export function primaryRichRuntime(env,cluster){
  const solanaRpcUrl=String(env.SOLANA_RPC_URL||'https://api.devnet.solana.com').trim();
  const fundedTokenMint=String(env.FUNDED_TOKEN_MINT||env.VITE_FUNDED_TOKEN_MINT||'').trim();
  const fundedSwapPool=String(env.FUNDED_SWAP_POOL||env.VITE_FUNDED_SWAP_POOL||'').trim();
  const programId=env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;
  const configured=configuredDevnetProgram(cluster,programId);
  if(configured&&env.FUNDED_V3_PROGRAM_DATA_SHA256!==configured.programDataSha256)throw Error('Configured Devnet program commitment differs.');
  const getPrimaryRich=createPrimaryRichReader({cluster,connection:new Connection(solanaRpcUrl,'finalized'),programId,fundedMint:fundedTokenMint,fundedPool:fundedSwapPool});
  return{solanaRpcUrl,fundedTokenMint,fundedSwapPool,getPrimaryRich};
}
