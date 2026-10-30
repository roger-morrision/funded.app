import {PublicKey} from '@solana/web3.js';
// Rebuild only with the same immutable on-chain receipt ID. A transport timeout
// alone never authorizes a second transaction.
export async function expiredTransactionAbsent(connection,row) {
  if(!row.signature||!row.blockhash||!row.receiptAddress
    ||!Number.isSafeInteger(row.lastValidBlockHeight)||row.lastValidBlockHeight<1)return false;
  const [height,validity,status,transaction,receipt]=await Promise.all([
    connection.getBlockHeight('finalized'),connection.isBlockhashValid(row.blockhash,'finalized'),
    connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true}),
    connection.getTransaction(row.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0}),
    connection.getAccountInfo(new PublicKey(row.receiptAddress),'confirmed'),
  ]);
  return Number.isSafeInteger(height)&&height>row.lastValidBlockHeight&&validity?.value===false
    &&Array.isArray(status?.value)&&status.value.length===1&&status.value[0]===null
    &&transaction===null&&receipt===null;
}
