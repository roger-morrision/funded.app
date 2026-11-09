import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Connection,Keypair} from '@solana/web3.js';
import {PRICE_SIGNER_GENESIS,verifiedProgram} from './price-signer-review.mjs';
import {validatePriceSignerConfig} from './price-signer-service.mjs';

export async function loadPriceSignerRuntime({env=process.env,read=readFileSync,
  connectionFactory=url=>new Connection(url,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(address,options)=>fetch(address,{...options,signal:AbortSignal.timeout(15000)})}),
  verifyProgram=verifiedProgram}={}) {
  const file=name=>{
    if(!env[name])throw Error(`Missing ${name}.`);
    try{return read(env[name],'utf8').trim();}catch{throw Error(`Cannot read ${name}.`);}
  };
  let config;
  try{config=JSON.parse(file('PRICE_SIGNER_CONFIG_FILE'));}catch{throw Error('Price signer public configuration is unavailable or invalid.');}
  assert(config?.cluster==='devnet','Mainnet price signing is disabled; no private key was loaded.');
  // Validate all public settings before accessing RPC, tokens or private keys.
  validatePriceSignerConfig(config,null);
  const rpc=file('PRICE_SIGNER_RPC_FILE');let url;
  try{url=new URL(rpc);}catch{throw Error('Independent HTTPS RPC is required.');}
  assert(url.protocol==='https:'&&!url.username&&!url.password,'Independent HTTPS RPC is required.');
  const connection=connectionFactory(rpc);
  let genesis;
  try{genesis=await connection.getGenesisHash();}catch{throw Error('Signer RPC identity is unavailable; no private key was loaded.');}
  assert(genesis===PRICE_SIGNER_GENESIS,'Signer RPC is not Devnet; no private key was loaded.');
  try{for(const entry of config.programs)await verifyProgram(connection,entry);}
  catch{throw Error('Signer program verification failed; no private key was loaded.');}
  let keypair;
  try{keypair=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(file('PRICE_SIGNER_KEY_FILE'))));}
  catch{throw Error('Dedicated price signer key file is unavailable or invalid.');}
  validatePriceSignerConfig(config,keypair.publicKey);
  const token=file('PRICE_SIGNER_TOKEN_FILE');
  assert(/^[a-f0-9]{64}$/.test(token),'A dedicated authentication token is required.');
  return {connection,config,keypair,token};
}
