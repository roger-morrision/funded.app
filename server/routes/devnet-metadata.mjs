import {PublicKey} from '@solana/web3.js';
import {SharedRpcConnection as Connection} from '../rpc-connection.mjs';
import {validateInput} from '../http-policy.mjs';
import {reserveLaunchSymbol} from '../launch-protections.mjs';
import {parseSignedMetadata, publicMetadata, metadataRecordOrigin} from '../devnet-metadata.mjs';
import {devnetMetadataUri} from '../../devnet-metadata.js';

// Dispatch after the shared HTTP authorization/rate checks and before wallet routes.
export function createDevnetMetadataRoutes({store,solanaCluster,solanaRpcUrl,devnetMetadataOrigin,body,respond}) {
  return async (req,res,url) => {
    if (req.method !== 'POST' || url.pathname !== '/api/devnet-metadata') return false;
    if (solanaCluster !== 'devnet') {
      respond(res,403,{error:'Metadata publishing is Devnet-only.'}); return true;
    }
    const input=await body(req);
    const {record,image,imageType,banner,bannerType}=validateInput(()=>parseSignedMetadata(input));
    const reservation=await reserveLaunchSymbol({store,record,
      mintExists:async mint=>Boolean(await new Connection(solanaRpcUrl,'confirmed').getAccountInfo(new PublicKey(mint),'confirmed'))});
    const saved=await store.writeMetadata({...record,metadataOrigin:devnetMetadataOrigin},image,imageType,banner,bannerType);
    respond(res,201,{uri:devnetMetadataUri(saved.mint,metadataRecordOrigin(saved)),image:publicMetadata(saved).image,mint:saved.mint,
      symbolReservationExpiresAt:new Date(reservation.expiresAt).toISOString()});
    return true;
  };
}
