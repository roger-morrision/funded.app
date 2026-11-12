// An elapsed wall clock or a missing index row cannot prove non-landing.
import { SOLANA_GENESIS } from '../../../solana-network.js';
import { APP_NET } from '../shared/app-network.js';
export async function expiredUnlandedTrade(connection,pending,transaction){
 if(transaction!==null||!Number.isSafeInteger(pending.lastValidBlockHeight))return false;
 if(await connection.getGenesisHash()!==SOLANA_GENESIS[APP_NET])throw Error(`Trade receipt RPC is not ${APP_NET==='mainnet-beta'?'Mainnet':'Devnet'}.`);
 const [status,height]=await Promise.all([connection.getSignatureStatuses([pending.signature],{searchTransactionHistory:true}),connection.getBlockHeight('finalized')]);
 return status.value[0]===null&&height>pending.lastValidBlockHeight+32;
}
