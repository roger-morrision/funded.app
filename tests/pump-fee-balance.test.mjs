import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {readPumpCreatorFeeBalance} from '../server/pump-fee-balance.mjs';

test('both vault reads start together and the exact SOL quote avoids mint discovery',async()=>{
 let nativeStarted=false,wrappedStarted=false,release;
 const native=new Promise(resolve=>{release=resolve;});
 const result=readPumpCreatorFeeBalance({creator:'creator',pump:{getCreatorVaultBalance:async creator=>{
  assert.equal(creator,'creator');nativeStarted=true;return native;}},amm:{getCoinCreatorVaultBalance:async(creator,mint,program)=>{
  assert(nativeStarted);wrappedStarted=true;assert.equal(creator,'creator');assert(mint.equals(NATIVE_MINT));assert(program.equals(TOKEN_PROGRAM_ID));return new BN('17');}}});
 assert(wrappedStarted);release(new BN('9007199254740993'));assert.equal((await result).toString(),'9007199254741010');
});
test('an unavailable vault never becomes a partial confirmed fee balance',async()=>{
 await assert.rejects(readPumpCreatorFeeBalance({pump:{getCreatorVaultBalance:async()=>new BN('123')},
  amm:{getCoinCreatorVaultBalance:async()=>{throw Error('RPC unavailable');}}}),/RPC unavailable/);
});
