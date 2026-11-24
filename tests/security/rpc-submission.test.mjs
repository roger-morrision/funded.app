import test from 'node:test';
import assert from 'node:assert/strict';
import {AddressLookupTableAccount, AddressLookupTableProgram, Keypair, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {rpcSubmissionBlocked} from '../../server/rpc-submission-policy.mjs';
import {createRpcGateway} from '../../server/rpc-gateway.mjs';
import {createRpcFailoverTransport} from '../../server/rpc-failover.mjs';
import {createSolanaRpcProxy} from '../../server/rpc-proxy.mjs';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {readFileSync} from 'node:fs';
import {PublicKey} from '@solana/web3.js';

const protectedKey = new PublicKey(JSON.parse(readFileSync(new URL('../../config/mainnet-deployment-plan.json', import.meta.url))).mainnetProgramId);
const env = {FUNDED_MAINNET_NON_PROGRAM_WRITES:'true'};
const payer = Keypair.generate(), recipient = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58(), tableKey = Keypair.generate().publicKey;
function payload({target = SystemProgram.programId, account = recipient, v0 = false, lookup = false, encoding = 'base64'} = {}) {
  const instructions = [new TransactionInstruction({programId:target, keys:[{pubkey:account,isSigner:false,isWritable:true}], data:Buffer.alloc(0)})];
  const table = new AddressLookupTableAccount({key:tableKey,state:{deactivationSlot:2n**64n-1n,lastExtendedSlot:1,lastExtendedSlotStartIndex:0,addresses:[account]}});
  const builder = new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions});
  const tx = new VersionedTransaction(v0 ? builder.compileToV0Message(lookup ? [table] : []) : builder.compileToLegacyMessage());
  tx.sign([payer]);
  const bytes = tx.serialize();
  return {jsonrpc:'2.0',id:7,method:'sendTransaction',params:[encoding === 'base58' ? bs58.encode(bytes) : Buffer.from(bytes).toString('base64'),{encoding}]};
}
function proof(address = recipient) {
  const data = Buffer.alloc(88);
  data.writeUInt32LE(1); data.writeBigUInt64LE(2n**64n-1n,4); data.writeBigUInt64LE(1n,12);
  address.toBuffer().copy(data,56);
  return {context:{slot:10},value:[{owner:AddressLookupTableProgram.programId.toBase58(),executable:false,data:[data.toString('base64'),'base64']}]};
}
test('non-program policy admits legacy and v0 transactions in both RPC encodings', async () => {
  for (const v0 of [false,true]) for (const encoding of ['base64','base58'])
    assert.equal(await rpcSubmissionBlocked('mainnet-beta',payload({v0,encoding}),{env}),false);
  assert.equal(await rpcSubmissionBlocked('mainnet-beta',payload({v0:true,lookup:true}),{env,readAccounts:async addresses=>{
    assert.deepEqual(addresses,[tableKey.toBase58()]);return proof();
  }}),false);
});
test('non-program policy blocks protected direct and CPI accounts including lookup tables', async () => {
  for (const v0 of [false,true]) for (const request of [payload({v0,target:protectedKey}),payload({v0,account:protectedKey})])
    assert.equal(await rpcSubmissionBlocked('mainnet-beta',request,{env}),true);
  assert.equal(await rpcSubmissionBlocked('mainnet-beta',payload({v0:true,lookup:true,account:protectedKey}),{env,readAccounts:async()=>proof(protectedKey)}),true);
  assert.equal(await rpcSubmissionBlocked('mainnet-beta',payload(),{env:{...env,FUNDED_V3_FEE_ROUTER_PROGRAM_ID:recipient.toBase58()}}),true);
});
test('non-program policy rejects malformed bytes and unresolved or invalid lookup evidence', async () => {
  for (const encoded of ['', 'AA==', '!!!!', payload().params[0]+'\n', 'A'.repeat(1800)])
    assert.equal(await rpcSubmissionBlocked('mainnet-beta',{...payload(),params:[encoded,{encoding:'base64'}]},{env}),true);
  const request = payload({v0:true,lookup:true});
  for (const evidence of [null, {context:{slot:10},value:[]}, {...proof(),context:{slot:-1}},
    {...proof(),value:[{...proof().value[0],owner:SystemProgram.programId.toBase58()}]},
    {...proof(),value:[{...proof().value[0],executable:true}]},
    {...proof(),value:[{...proof().value[0],data:[Buffer.alloc(56).toString('base64'),'base64']}]}])
    assert.equal(await rpcSubmissionBlocked('mainnet-beta',request,{env,readAccounts:async()=>evidence}),true);
  assert.equal(await rpcSubmissionBlocked('mainnet-beta',request,{env,readAccounts:async()=>{throw Error('offline');}}),true);
  assert.equal(await rpcSubmissionBlocked('mainnet-beta',request,{env}),true);
  assert.equal(await rpcSubmissionBlocked('mainnet-beta',payload(),{env:{...env,FUNDED_MAINNET_PROGRAM_ID:'invalid'}}),true);
});
test('disabled submissions perform no lookup and Devnet behavior is unchanged', async () => {
  const readAccounts = async()=>{throw Error('must not read');};
  assert.equal(await rpcSubmissionBlocked('mainnet-beta',payload({v0:true,lookup:true}),{env:{},readAccounts}),true);
  assert.equal(await rpcSubmissionBlocked('devnet',payload({target:protectedKey}),{env:{},readAccounts}),false);
  assert.equal(await rpcSubmissionBlocked('mainnet-beta',{method:'simulateTransaction'}, {env}),false);
});
for (const layer of ['proxy','gateway','failover']) test(`${layer} never forwards protected static or lookup submissions and permits ordinary writes`, async () => {
  const calls = [];
  let lookupProof = proof(protectedKey);
  const transport = async request => {
    calls.push(request);
    if (request.method === 'getMultipleAccounts') assert.deepEqual(request.params[1],{encoding:'base64',commitment:'finalized'});
    return {status:200,headers:{},body:{jsonrpc:'2.0',id:request.id,result:
      request.method === 'getGenesisHash' ? SOLANA_GENESIS['mainnet-beta'] : request.method === 'getMultipleAccounts' ? lookupProof : 'submitted'}};
  };
  let send, close = ()=>{};
  if (layer === 'gateway') {
    const gateway = createRpcGateway({transport,cluster:'mainnet-beta',env,minIntervalMs:0,sendIntervalMs:0});
    assert.equal(await gateway.initialize(),true); send = async request=>(await gateway.request(request)).httpStatus; close=()=>gateway.close();
  } else if (layer === 'failover') {
    const failover = createRpcFailoverTransport({primary:transport,publicTransport:transport,cluster:'mainnet-beta',env});
    send = async request=>(await failover(request)).status; close=()=>failover.close();
  } else {
    let request;
    const proxy = createSolanaRpcProxy({store:{chargeRpcRate:async()=>true},solanaRpcUrl:'https://rpc.invalid',body:async()=>request,
      authorized:()=>false,clientKey:()=> 'fixture',json:(_res,status)=>status,rpcMethods:new Set(['sendTransaction']),solanaCluster:'mainnet-beta',env,
      fetch:async(_url,options)=>{const response=await transport(JSON.parse(options.body));return {ok:true,status:response.status,json:async()=>response.body};}});
    send = async input=>{request=input;return proxy.proxySolanaRpc({headers:{},url:'/api/solana/rpc'},{});};
  }
  try {
    assert.equal(await send(payload({target:protectedKey})),403);
    assert.equal(await send(payload({account:protectedKey})),403);
    assert.equal(await send(payload({v0:true,lookup:true,account:protectedKey})),403);
    assert.equal(calls.filter(request=>request.method==='sendTransaction').length,0);
    lookupProof=proof();
    assert.equal(await send(payload({v0:true,lookup:true})),200);
    assert.equal(await send(payload()),200);
    assert.equal(calls.filter(request=>request.method==='sendTransaction').length,2);
  } finally {close();}
});
