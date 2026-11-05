import {PublicKey} from '@solana/web3.js';
import {SharedRpcConnection as Connection} from '../rpc-connection.mjs';
import {validateInput} from '../http-policy.mjs';
import {reserveLaunchSymbol} from '../launch-protections.mjs';
import {parseSignedMetadata, publicMetadata} from '../devnet-metadata.mjs';
import {metadataStatement} from '../../devnet-metadata.js';
import {createMetadataPublisher,verifyPublishedMetadata} from '../metadata-publication.mjs';

// Dispatch after the shared HTTP authorization/rate checks and before wallet routes.
export function createDevnetMetadataRoutes({store,solanaCluster,solanaRpcUrl,devnetMetadataOrigin,body,respond,
  publish = createMetadataPublisher(), verifyPublication = verifyPublishedMetadata}) {
  return async (req,res,url) => {
    if (req.method !== 'POST' || url.pathname !== '/api/devnet-metadata') return false;
    if (solanaCluster !== 'devnet') {
      respond(res,403,{error:'Metadata publishing is Devnet-only.'}); return true;
    }
    const input=await body(req);
    const {record,image,imageType,banner,bannerType}=validateInput(()=>parseSignedMetadata(input));
    const reservation=await reserveLaunchSymbol({store,record,
      mintExists:async mint=>Boolean(await new Connection(solanaRpcUrl,'confirmed').getAccountInfo(new PublicKey(mint),'confirmed'))});
    const existing=await store.readMetadata(record.mint);
    if (existing && metadataStatement(existing)!==metadataStatement(record)) {
      respond(res,409,{error:'Immutable metadata already exists for this mint.'}); return true;
    }
    let saved,publication;
    try {
      const prepared=existing || await publish({record:{...record,metadataOrigin:devnetMetadataOrigin},image,imageType,banner,bannerType});
      saved=await store.writeMetadata(prepared,image,imageType,banner,bannerType);
      publication=await verifyPublication(saved);
    } catch (error) {
      respond(res,503,{error:/not configured/.test(error.message)
        ? 'Durable metadata storage is not configured. No launch transaction was prepared.'
        : 'Token metadata or image could not be published and verified publicly. Retry before approving a launch transaction.'});
      return true;
    }
    respond(res,201,{uri:publication.uri,image:publicMetadata(saved).image,mint:saved.mint,publication,
      symbolReservationExpiresAt:new Date(reservation.expiresAt).toISOString()});
    return true;
  };
}
