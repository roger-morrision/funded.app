import test from 'node:test';
import assert from 'node:assert/strict';
import * as solana from '@solana/web3.js';
import bs58 from 'bs58';
import {snapshotBoostPayment,assertBoostWalletPayment,MAX_BOOST_NETWORK_FEE_LAMPORTS} from '../boost-wallet-review.js';
import {BOOST_MEMO_PROGRAM,boostMemo} from '../boost-offer.js';
import {decodeBoostPayment} from '../server/boost-payment-journal.mjs';
import {createBoostCheckoutController} from '../src/app/controllers/boost-checkout.js';

function fixture(){
  const payer=solana.Keypair.generate(),recipient=solana.Keypair.generate().publicKey;
  const quote={id:'boost_123_1234567890123456',payer:payer.publicKey.toBase58(),recipient:recipient.toBase58(),lamports:572320500};
  const tx=new solana.Transaction({feePayer:payer.publicKey,recentBlockhash:solana.Keypair.generate().publicKey.toBase58()}).add(
    solana.SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:quote.lamports}),
    new solana.TransactionInstruction({keys:[],programId:new solana.PublicKey(BOOST_MEMO_PROGRAM),data:Buffer.from(boostMemo(quote.id))}));
  return{payer,quote,tx};
}
const priority=()=>[solana.ComputeBudgetProgram.setComputeUnitLimit({units:100000}),solana.ComputeBudgetProgram.setComputeUnitPrice({microLamports:150000})];

test('wallet priority additions preserve the reviewed transfer and are accepted by server journaling',()=>{
  const {payer,quote,tx}=fixture(),reviewed=snapshotBoostPayment(tx),before=Buffer.from(tx.serializeMessage());
  tx.instructions.unshift(...priority());tx.sign(payer);
  const signed=solana.Transaction.from(tx.serialize());
  assert(!before.equals(signed.serializeMessage()),'Reproduce the previous byte-for-byte rejection');
  assert.doesNotThrow(()=>assertBoostWalletPayment(signed,reviewed));
  const signature=bs58.encode(signed.signature);
  assert.equal(decodeBoostPayment(signed.serialize().toString('base64'),quote,signature).signature,signature);
  assert.equal(reviewed.instructions.length,2,'Wallet mutation must not mutate the reviewed snapshot');
});

test('review accepts unchanged payments and either order of supported priority settings',()=>{
  for(const instructions of [[],priority(),priority().reverse(),[priority()[0]],[priority()[1]]]){
    const {payer,tx}=fixture(),reviewed=snapshotBoostPayment(tx);tx.instructions.unshift(...instructions);tx.sign(payer);
    assert.doesNotThrow(()=>assertBoostWalletPayment(solana.Transaction.from(tx.serialize()),reviewed));
  }
});

test('recipient, amount, memo, payer, blockhash, privileges and additional actions remain protected',()=>{
  const changes=[
    tx=>{tx.instructions[0].keys[1].pubkey=solana.Keypair.generate().publicKey;},
    tx=>{tx.instructions[0].data[4]^=1;},
    tx=>{tx.instructions[1].data=Buffer.from('different memo');},
    tx=>{tx.feePayer=solana.Keypair.generate().publicKey;},
    tx=>{tx.recentBlockhash=solana.Keypair.generate().publicKey.toBase58();},
    tx=>{tx.instructions[0].keys[1].isSigner=true;},
    tx=>{tx.instructions[0].keys[1].isWritable=false;},
    tx=>{tx.instructions.push(tx.instructions[0]);},
    tx=>{tx.instructions.reverse();},
    tx=>{tx.instructions.push(priority()[0]);},
    tx=>{tx.instructions[1].keys.push({pubkey:tx.feePayer,isSigner:true,isWritable:true});},
  ];
  for(const change of changes){const {tx}=fixture(),reviewed=snapshotBoostPayment(tx);change(tx);assert.throws(()=>assertBoostWalletPayment(tx,reviewed),/changed the reviewed payment/);}
});

test('duplicate, unknown, malformed and account-bearing compute instructions are rejected',()=>{
  const wrongLength=priority()[0];wrongLength.data=Buffer.from([2,1]);
  const withAccount=priority()[1];withAccount.keys=[{pubkey:solana.Keypair.generate().publicKey,isSigner:false,isWritable:true}];
  for(const prefix of [[...priority(),priority()[0]],[solana.ComputeBudgetProgram.requestHeapFrame({bytes:32768})],
    [solana.ComputeBudgetProgram.setComputeUnitLimit({units:0})],[wrongLength],[withAccount]]){
    const {tx}=fixture(),reviewed=snapshotBoostPayment(tx);tx.instructions.unshift(...prefix);
    assert.throws(()=>assertBoostWalletPayment(tx,reviewed),/unsupported payment fee settings/);
  }
});

for(const failure of ['recipient','too-high-fee','insufficient-balance','unknown-fee','expired-after-signing'])test(`checkout does not journal or broadcast: ${failure}`,async()=>{
  const {payer,quote,tx}=fixture(),events=[];
  Object.assign(quote,{mint:solana.Keypair.generate().publicKey.toBase58(),packageId:'10x',cluster:'devnet',memo:boostMemo(quote.id),expiresAt:new Date(Date.now()+300000).toISOString()});
  let signed=false,feeReads=0;
  const wallet={publicKey:payer.publicKey,signTransaction:async transaction=>{
    transaction.instructions.unshift(...priority());
    if(failure==='recipient')transaction.instructions[2].keys[1].pubkey=solana.Keypair.generate().publicKey;
    transaction.sign(payer);signed=true;return transaction;
  }};
  const session={address:payer.publicKey.toBase58(),provider:wallet};
  const app={wallet,connectedWalletAddress:session.address,boostCheckout:{mint:quote.mint,packageId:'10x',quote,reviewedQuote:{...quote}},Buffer,bs58,BOOST_MEMO_PROGRAM,
    readPendingBoost:()=>null,captureWalletSession:()=>session,assertWalletSessionCurrent:()=>{},canSignTransactions:()=>true,getSolana:async()=>solana,
    validateBoostQuote:q=>{if(signed&&failure==='expired-after-signing')throw Error('Quote expired');return q;},
    connection:{getBalance:async()=>signed&&failure==='insufficient-balance'?quote.lamports:10_000_000_000,
      getFeeForMessage:async()=>({value:++feeReads===1?5000:failure==='too-high-fee'?MAX_BOOST_NETWORK_FEE_LAMPORTS+1:failure==='unknown-fee'?null:20000}),
      sendRawTransaction:async()=>{events.push('broadcast');}},
    saveSignedBoostPayment:async()=>events.push('persist'),apiRequest:async path=>{
      if(path==='/api/boosts/prepare')return{available:true,data:{quoteId:quote.id,cluster:'devnet',blockhash:tx.recentBlockhash,expiryUpperBound:200,expiresAt:quote.expiresAt}};
      events.push('journal');throw Error('Unexpected journal request');
    }};
  Object.assign(app,createBoostCheckoutController(app));app.renderExploreBoostDialog=()=>{};
  await app.handleExploreBoostPay();
  assert.deepEqual(events,[]);assert(!app.boostCheckout.pendingSignature);assert.equal(app.boostCheckout.busy,false);
  assert.match(app.boostCheckout.message,/No payment was sent|Quote expired/);
});
