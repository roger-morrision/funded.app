import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {migrationOnlyProof} from '../server/product-migration-proof.mjs';
import {scanTradePage} from '../server/product-trade-index.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/finalized-migration.json',import.meta.url),'utf8'));
const mint=new PublicKey(fixture.mint);
function transaction() {
  const f=structuredClone(fixture);
  const keys=f.accountKeys.map(key=>new PublicKey(key));
  return {slot:f.slot,blockTime:f.blockTime,meta:f.meta,transaction:{signatures:[f.signature],message:{
    getAccountKeys:()=>({get:index=>keys[index]}),
    compiledInstructions:f.instructions.map(ix=>({...ix,data:bs58.decode(ix.data),accountKeyIndexes:ix.accounts})),
  }}};
}

test('finalized Devnet migration is proven from its full instruction tree despite truncated logs',async()=>{
  const tx=transaction();assert.equal(migrationOnlyProof(tx,mint),true);
  assert.equal(migrationOnlyProof(tx,new PublicKey('11111111111111111111111111111111')),false);
  const connection={getSignaturesForAddress:async()=>[{signature:fixture.signature,slot:fixture.slot,confirmationStatus:'finalized',err:null}],getTransaction:async()=>tx};
  const page=await scanTradePage({connection,mint:fixture.mint,route:'curve',decodePoolEvent:()=>null});
  assert.equal(page.records.length,0);assert.equal(page.gaps.length,0);assert.equal(page.nontrades.length,1);
  assert.deepEqual(page.resolved,[fixture.signature]);
  tx.slot++;await assert.rejects(()=>scanTradePage({connection,mint:fixture.mint,route:'curve',decodePoolEvent:()=>null}),/proof/);
});

test('missing, spoofed, additional, or changed instructions cannot clear a migration gap',()=>{
  const mutations=[
    tx=>{tx.meta.err={InstructionError:[1,'Failed']};},
    tx=>{tx.meta.innerInstructions=null;},
    tx=>{tx.meta.innerInstructions[0].instructions.pop();},
    tx=>{tx.meta.innerInstructions[0].instructions[0].stackHeight=null;},
    tx=>{tx.meta.innerInstructions[0].instructions.at(-1).accounts=[];},
    tx=>{tx.meta.innerInstructions[0].index=0;},
    tx=>{tx.transaction.message.compiledInstructions.push(tx.transaction.message.compiledInstructions.at(-1));},
    tx=>{tx.transaction.message.compiledInstructions.at(-1).data=Buffer.alloc(8);},
    tx=>{tx.meta.innerInstructions[0].instructions[0].programIdIndex=9999;},
    tx=>{tx.meta.innerInstructions[0].instructions.splice(1,0,{...tx.meta.innerInstructions[0].instructions.at(-1),data:bs58.encode(Buffer.alloc(8))});},
  ];
  for(const mutate of mutations){const tx=transaction();mutate(tx);assert.equal(migrationOnlyProof(tx,mint),false);}
});
