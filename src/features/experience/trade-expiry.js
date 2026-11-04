// An elapsed wall clock or a missing index row cannot prove non-landing.
export async function expiredUnlandedTrade(connection,pending,transaction){
 if(transaction!==null||!Number.isSafeInteger(pending.lastValidBlockHeight))return false;
 if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('Trade receipt RPC is not Devnet.');
 const [status,height]=await Promise.all([connection.getSignatureStatuses([pending.signature],{searchTransactionHistory:true}),connection.getBlockHeight('finalized')]);
 return status.value[0]===null&&height>pending.lastValidBlockHeight+32;
}
