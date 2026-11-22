import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {tokenSellReceiptFacts,loadFinalizedTokenSell} from '../../server/token-conversion-sell-proof.mjs';
import {sellProofFixture} from './token-sell-proof-fixture.mjs';

for(const category of [5,6,7])for(const prefund of [0,700000])test('mocked admitted finalized sell reconciles category '+category+' with prefund '+prefund,async()=>{
  const f=sellProofFixture({category,prefund,beforeVault:0}),facts=tokenSellReceiptFacts(f.parserArgs());
  assert.equal(facts.transactionFactsVerified,true);assert.equal(facts.signaturesVerified,true);assert.equal(facts.receivedLamports,'14211301');assert.equal(facts.spentQuoteRaw,'1000000');
  assert.equal(facts.prefundExcludedLamports,String(prefund));assert.equal(facts.rentTopupLamports,'1000');assert.equal(facts.wsolClosed,true);
  assert.equal(facts.finalized,undefined,'pure fact parsing must not assert chain finality');
  const proof=await loadFinalizedTokenSell(f.adapterArgs());assert.ok(proof,'actual RPC adapter with synthetic context');
  assert.equal(proof.finalized,true);assert.equal(proof.category,category);assert.equal(proof.programDataSha256,f.release.programDataSha256);
});

test('committed incomplete release cannot admit a program or even read RPC',async()=>{
  const f=sellProofFixture();f.connection.getGenesisHash=()=>assert.fail('No RPC before production release admission');
  assert.equal(await loadFinalizedTokenSell({...f.adapterArgs(),release:undefined}),null);
});

test('wrong genesis, loader, authority and full ProgramData context cannot authenticate proof',async()=>{
  for(const mutate of [f=>{f.connection.getGenesisHash=async()=> 'wrong-network';},
    f=>{f.programAccount.owner=new PublicKey(new Uint8Array(32).fill(61));},
    f=>{f.programData={...f.programData,data:Buffer.from(f.programData.data)};f.programData.data[4]^=1;f.programData.data[13]^=1;},
    f=>{f.release={...f.release,programDataSha256:'f'.repeat(64)};}]){
    const f=sellProofFixture();mutate(f);assert.equal(await loadFinalizedTokenSell(f.adapterArgs()),null);
  }
});

test('missing or nonfinalized signature status and slot mismatch remain unresolved',async()=>{
  for(const status of [null,{slot:1000,err:null,confirmationStatus:'confirmed'},
    {slot:1000,err:{InstructionError:[0,'test']},confirmationStatus:'finalized'},
    {slot:999,err:null,confirmationStatus:'finalized'}]){
    const f=sellProofFixture();f.connection.getSignatureStatuses=async()=>({context:{slot:1001},value:[status]});
    assert.equal(await loadFinalizedTokenSell(f.adapterArgs()),null);
  }
});

test('missing or stale finalized account evidence and RPC errors cannot finalize',async()=>{
  for(const mutate of [f=>{f.receiptAccount=null;},f=>{f.creditAccount=null;},
    f=>{const original=f.connection.getMultipleAccountsInfoAndContext;f.connection.getMultipleAccountsInfoAndContext=async(...args)=>({...await original(...args),context:{slot:999}});},
    f=>{f.connection.getTransaction=async()=>{throw Error('archive unavailable');};}]){
    const f=sellProofFixture();mutate(f);assert.equal(await loadFinalizedTokenSell(f.adapterArgs()),null);
  }
});

test('signature, frozen message and failed transaction substitution are rejected',()=>{
  for(const mutate of [f=>{f.signature=bs58.encode(Buffer.alloc(64,22));},f=>{f.expected.messageHash='a'.repeat(64);},
    f=>{f.tx.meta.err={InstructionError:[0,'test']};}]){
    const f=sellProofFixture();mutate(f);assert.throws(()=>tokenSellReceiptFacts(f.parserArgs()));
  }
});

test('invalid operator or independent price signature cannot authenticate the transaction',()=>{
  for(const index of [0,1]){
    const f=sellProofFixture(),bad=bs58.encode(Buffer.alloc(64,22));f.tx.transaction.signatures[index]=bad;
    if(index===0)f.signature=bad;
    assert.throws(()=>tokenSellReceiptFacts(f.parserArgs()),/signatures/);
  }
});

test('foreign receipt ownership, wrong immutable identity and category credit do not prove payment',()=>{
  for(const mutate of [f=>{f.receiptAccount.owner=new PublicKey(new Uint8Array(32).fill(61));},
    f=>{f.receiptAccount.data[8]^=1;},f=>{f.receiptAccount.data[40]^=1;},f=>{f.receiptAccount.data[72]^=1;},
    f=>{f.receiptAccount.data[104]^=1;},f=>{f.receiptAccount.data[136]=6;},
    f=>{f.receiptAccount.data.writeBigUInt64LE(999999n,137);},f=>{f.receiptAccount.data.writeBigUInt64LE(1n,145);},
    f=>{f.creditAccount.data.writeBigUInt64LE(0n,80);},f=>{f.creditAccount.data[8]^=1;}]){
    const f=sellProofFixture();mutate(f);assert.throws(()=>tokenSellReceiptFacts(f.parserArgs()));
  }
});

test('exact USDC debit and token custody must agree with receipt',()=>{
  for(const mutate of [f=>{f.tx.meta.postTokenBalances[0].uiTokenAmount.amount='1000001';},
    f=>{f.tx.meta.postTokenBalances[0].owner=String(new PublicKey(new Uint8Array(32).fill(61)));},
    f=>{f.tx.meta.postTokenBalances[0].mint=String(new PublicKey(new Uint8Array(32).fill(61)));},
    f=>{f.tx.meta.preTokenBalances=[];}]){
    const f=sellProofFixture();mutate(f);assert.throws(()=>tokenSellReceiptFacts(f.parserArgs()));
  }
});

test('prefund and rent cannot inflate credit and WSOL must close',()=>{
  for(const mutate of [f=>{f.tx.meta.postBalances[f.tx.meta.preBalances.findIndex(n=>n===700000)]=1;},
    f=>{f.tx.meta.postBalances[f.tx.meta.postBalances.findIndex(n=>n>1000000)]-=1;},
    f=>{f.tx.meta.preBalances[f.tx.meta.preBalances.findIndex(n=>n===700000)]=0;},
    f=>{f.minimumVaultRent=999;},f=>{f.minimumVaultRent=0;}]){
    const f=sellProofFixture({prefund:700000,beforeVault:0});mutate(f);assert.throws(()=>tokenSellReceiptFacts(f.parserArgs()));
  }
});

test('exact sell CPI accounts, payload and closure are required',()=>{
  for(const mutate of [f=>{f.tx.meta.innerInstructions[0].instructions.shift();},
    f=>{const ix=f.tx.meta.innerInstructions[0].instructions[0];const data=Buffer.from(bs58.decode(ix.data));data[8]^=1;ix.data=bs58.encode(data);},
    f=>{f.tx.meta.innerInstructions[0].instructions[0].accounts[5]=0;},
    f=>{f.tx.meta.innerInstructions[0].instructions.pop();},
    f=>{f.tx.meta.innerInstructions[0].instructions[1].accounts[1]=0;}]){
    const f=sellProofFixture();mutate(f);assert.throws(()=>tokenSellReceiptFacts(f.parserArgs()));
  }
});
