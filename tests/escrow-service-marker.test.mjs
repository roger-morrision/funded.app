import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {developerLockInstruction} from '../developer-token-lock.js';
import {launchServiceFeeInstructions} from '../launch-service-fee.js';
import {verifyLaunchServiceFee} from '../server/launch-service-fee-proof.mjs';
function fixture(){
 const creator=Keypair.generate().publicKey,mint=Keypair.generate().publicKey,treasury=Keypair.generate().publicKey;
 const now=Date.now(),quote={id:'launch_service_1_0123456789abcdef',payer:creator.toBase58(),recipient:treasury.toBase58(),amountLamports:'20000000',policyHash:'a'.repeat(64),createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
 const marker=developerLockInstruction({mint,creator,amount:1n,quoteId:quote.id}).instruction;
 const message=new Transaction({feePayer:creator,recentBlockhash:PublicKey.default.toBase58()}).add(marker,...launchServiceFeeInstructions({payer:creator,mint,quote,escrowReceiptMarker:true})).compileMessage();
 const before=message.accountKeys.map(()=>0),after=[...before];after[message.accountKeys.findIndex(k=>k.equals(treasury))]=20000000;
 return {quote,mint:mint.toBase58(),payer:creator.toBase58(),signature:'receipt',transaction:{slot:100,blockTime:Math.floor(now/1000),transaction:{signatures:['receipt'],message},meta:{err:null,preBalances:before,postBalances:after}}};
}
test('escrow receipt marker binds the saved quote, mint and payer while requiring the exact SOL payment',()=>{
 assert.equal(verifyLaunchServiceFee(fixture()).balanceDeltaVerified,true);
 const mutations=[f=>{f.quote.id='launch_service_1_1123456789abcdef';},f=>{f.mint=Keypair.generate().publicKey.toBase58();},f=>{f.transaction.transaction.message.instructions.shift();},f=>{f.transaction.transaction.message.instructions.pop();},f=>{f.transaction.meta.postBalances.fill(0);},f=>{f.transaction.meta.err={failed:true};}];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>verifyLaunchServiceFee(f));}
});
test('removing the separate memo requires the nonce-bearing escrow; a plain escrow is insufficient',()=>{
 const f=fixture(),message=f.transaction.transaction.message;
 message.instructions[0].data=message.instructions[0].data.slice(0,3);assert.throws(()=>verifyLaunchServiceFee(f));
 assert.throws(()=>developerLockInstruction({mint:f.mint,creator:f.payer,amount:1n,quoteId:'bad'}),/valid launch service quote/);
});
