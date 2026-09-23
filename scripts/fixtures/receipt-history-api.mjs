// Synthetic browser fixture only. No external fetch, real identity, key or transaction.
if(process.env.FUNDED_RECEIPT_HISTORY_FIXTURE!=='1'||process.env.NODE_ENV!=='test'||!process.env.FUNDED_STORE_PATH)throw new Error('Isolated receipt-history fixture required.');
const {createStore}=await import('../../server/store.mjs');
const {receiptHistoryFixture}=await import('./receipt-history-data.mjs');
const {createReceiptEvidenceReader}=await import('../../server/receipt-service.mjs');
const {decodeReceiptCursor}=await import('../../server/receipt-history.mjs');
const fixture=receiptHistoryFixture(),store=createStore(process.env.FUNDED_STORE_PATH,'');
await store.update(s=>Object.assign(s,fixture.state));
const verify=createReceiptEvidenceReader({store,cluster:'devnet',commitment:'finalized',officialGenesis:async()=>'fixture',connectionFactory:()=>({getGenesisHash:async()=>'fixture',getTransaction:async signature=>fixture.transactions.get(signature)})});
let cursor='';do{const page=await store.readCreatorReceiptPage('123','devnet',decodeReceiptCursor(cursor));await verify(page.state);cursor=page.nextCursor;}while(cursor);
globalThis.fetch=async()=>{throw new Error('External network is disabled in the receipt fixture.');};
await import('../../server/index.mjs');
