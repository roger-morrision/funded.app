// Interactive test harness: config arrives over stdin, never command arguments.
// Payer survives failed runs in process memory. No private key is emitted/saved.
import {createInterface} from 'node:readline';
import {Connection,Keypair} from '@solana/web3.js';
import {runAcceptance,assertDevnet} from './devnet-acceptance.mjs';
import {createAcceptanceRpcFetch} from './devnet-acceptance-rpc.mjs';
import {createAcceptanceRunGuard} from './devnet-acceptance-run-guard.mjs';
const input=createInterface({input:process.stdin});
let connection,payer,rpcUrl,busy=false;
const runOnce=createAcceptanceRunGuard(runAcceptance);
const emit=row=>console.log(JSON.stringify(row));
for await(const line of input){
 try{
  const command=JSON.parse(line);
  if(command.action==='initialize'){
   if(payer)throw Error('Already initialized');
   rpcUrl=command.rpcUrl;
   connection=new Connection(rpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:createAcceptanceRpcFetch()});
   assertDevnet(await connection.getGenesisHash());payer=Keypair.generate();
   emit({event:'session-ready',cluster:'devnet',payer:payer.publicKey.toBase58(),privateKeyPersistence:'none'});
  }else if(command.action==='balance'){
   if(!payer)throw Error('Initialize first');
   assertDevnet(await connection.getGenesisHash());
   emit({event:'balance',lamports:await connection.getBalance(payer.publicKey,'finalized')});
  }else if(command.action==='run'){
   if(!payer||busy)throw Error('Session not ready');
   assertDevnet(await connection.getGenesisHash());
   if(await connection.getBalance(payer.publicKey,'finalized')<100_000_000)throw Error('Requires at least 0.1 finalized test SOL; no faucet requested');
   busy=true;
   try{const result=await runOnce({execute:true,ephemeralPayer:payer,rpcUrl,programId:command.programId,output:command.output});
    emit({event:'run-finished',status:result.status,coverage:result.coverage});}
   finally{busy=false;}
  }else if(command.action==='close'){emit({event:'session-closed'});break;}
  else throw Error('Unknown command');
 }catch{emit({event:'session-error',reason:'Command rejected or RPC unavailable; key remains in this process. Inspect public evidence before retrying.'});}
}
