import {readFileSync} from 'node:fs';
import {Connection,Keypair} from '@solana/web3.js';
import {PriceSignerJournal} from '../server/price-signer-journal.mjs';
import {createPriceSignerServer} from '../server/price-signer-service.mjs';
import {PRICE_SIGNER_GENESIS,verifiedProgram} from '../server/price-signer-review.mjs';

const file=name=>{if(!process.env[name])throw Error(`Missing ${name}.`);return readFileSync(process.env[name],'utf8').trim();};
let keypair;
try{keypair=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(file('PRICE_SIGNER_KEY_FILE'))));}
catch{throw Error('Dedicated price signer key file is unavailable or invalid.');}
const token=file('PRICE_SIGNER_TOKEN_FILE'),config=JSON.parse(file('PRICE_SIGNER_CONFIG_FILE'));
const rpc=file('PRICE_SIGNER_RPC_FILE'),url=new URL(rpc);
if(url.protocol!=='https:'||url.username||url.password)throw Error('Independent HTTPS RPC is required.');
const connection=new Connection(rpc,{commitment:'finalized',disableRetryOnRateLimit:true,
  fetch:(address,options)=>fetch(address,{...options,signal:AbortSignal.timeout(15000)})});
if(await connection.getGenesisHash()!==PRICE_SIGNER_GENESIS)throw Error('Signer RPC is not Devnet.');
for(const entry of config.programs)await verifiedProgram(connection,entry);
const journal=new PriceSignerJournal(process.env.PRICE_SIGNER_JOURNAL||'/state/reservations.jsonl');await journal.load();
const server=createPriceSignerServer({connection,config,keypair,token,journal});
server.listen(Number(process.env.PRICE_SIGNER_PORT||8789),process.env.PRICE_SIGNER_HOST||'127.0.0.1',()=>console.log(JSON.stringify({event:'price_signer_ready',signer:String(keypair.publicKey),cluster:'devnet'})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
