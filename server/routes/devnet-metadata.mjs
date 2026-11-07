import {PublicKey} from '@solana/web3.js';
import {SharedRpcConnection as Connection} from '../rpc-connection.mjs';
import {validateInput} from '../http-policy.mjs';
import {reserveLaunchSymbol} from '../launch-protections.mjs';
import {parseSignedMetadata, publicMetadata} from '../devnet-metadata.mjs';
import {metadataStatement} from '../../devnet-metadata.js';
import {createMetadataPublisher,verifyPublishedMetadata} from '../metadata-publication.mjs';
import {assertRpcNetwork,SOLANA_GENESIS} from '../../solana-network.js';

// Dispatch after the shared HTTP authorization/rate checks and before wallet routes.
export function createDevnetMetadataRoutes({store,solanaCluster,solanaRpcUrl,devnetMetadataOrigin,body,respond,
  connectionFactory=url=>new Connection(url,'confirmed'),
  publish = createMetadataPublisher(), verifyPublication = verifyPublishedMetadata}) {
  return async (req,res,url) => {
    if (req.method !== 'POST' || url.pathname !== '/api/devnet-metadata') return false;
    if (solanaCluster !== 'devnet') {
      respond(res,403,{error:'Metadata publishing is Devnet-only.'}); return true;
    }
    const input=await body(req);
    const {record,image,imageType,banner,bannerType}=validateInput(()=>parseSignedMetadata(input,{cluster:solanaCluster}));
    const existing=await store.readMetadata(record.mint);
    if (existing && metadataStatement(existing)!==metadataStatement(record)) {
      respond(res,409,{error:'Immutable metadata already exists for this mint.'}); return true;
    }
    let connection;
    try {
      connection=connectionFactory(solanaRpcUrl);
      await assertRpcNetwork(connection,solanaCluster);
    } catch {
      respond(res,503,{error:'The Devnet RPC network could not be verified. No ticker was reserved or metadata published.'}); return true;
    }
    const reservation=await reserveLaunchSymbol({store,record,
      mintExists:async mint=>Boolean(await connection.getAccountInfo(new PublicKey(mint),'confirmed'))});
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
    respond(res,201,{cluster:solanaCluster,genesisHash:SOLANA_GENESIS[solanaCluster],uri:publication.uri,image:publicMetadata(saved).image,mint:saved.mint,publication,
      symbolReservationExpiresAt:new Date(reservation.expiresAt).toISOString()});
    return true;
  };
}
