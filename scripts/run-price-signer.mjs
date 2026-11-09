import {PriceSignerJournal} from '../server/price-signer-journal.mjs';
import {createPriceSignerServer} from '../server/price-signer-service.mjs';
import {loadPriceSignerRuntime} from '../server/price-signer-bootstrap.mjs';

const {connection,config,keypair,token}=await loadPriceSignerRuntime();
const journal=new PriceSignerJournal(process.env.PRICE_SIGNER_JOURNAL||'/state/reservations.jsonl');await journal.load();
const server=createPriceSignerServer({connection,config,keypair,token,journal});
server.listen(Number(process.env.PRICE_SIGNER_PORT||8789),process.env.PRICE_SIGNER_HOST||'127.0.0.1',()=>console.log(JSON.stringify({event:'price_signer_ready',signer:String(keypair.publicKey),cluster:'devnet'})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
