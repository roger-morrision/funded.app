import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import {analyzeBundleEvidence,receiptBuyers,receiptFunding,scanBundleWallets} from '../server/bundle-wallet-detection.mjs';
import {mint,creator,signature,time,eventLogs} from './fixtures/developer-protection.mjs';
const wallets=Array.from({length:3},()=>Keypair.generate().publicKey.toBase58());
const ref={signature,slot:100,confirmationStatus:'finalized',blockTime:time};
const trades=wallets.map((wallet,i)=>({wallet,signature,slot:100+i,blockTime:time+i,logIndex:1}));
const funding=wallets.map(wallet=>({wallet,source:creator,signature}));
test('common funding plus near-simultaneous distinct buyers is suspected coordination, never proven bundling',()=>{
 const result=analyzeBundleEvidence({trades,funding,holdings:Object.fromEntries(wallets.map(w=>[w,'10'])),supply:'100',creatorWallet:creator});
 assert.equal(result.status,'suspected-coordination');assert.equal(result.bundleConfirmed,false);assert.equal(result.clusters[0].holdingPercent,30);assert(result.clusters[0].creatorLinked);
 assert.equal(analyzeBundleEvidence({trades,funding,holdings:{},supply:'100'}).clusters[0].holdingPercent,null);
 assert.equal(analyzeBundleEvidence({trades,funding,excludedFunders:[creator],supply:'100'}).clusters.length,0);
});
test('duplicate wallets, same-slot activity alone and slower shared funding never prove a bundle',()=>{
 assert.equal(analyzeBundleEvidence({trades:[trades[0],trades[0],trades[0]],funding:[funding[0],funding[0],funding[0]],supply:'100'}).clusters.length,0);
 const timing=analyzeBundleEvidence({trades:trades.map(t=>({...t,slot:100})),funding:[],supply:'100'});assert.equal(timing.status,'signals-observed');assert.equal(timing.bursts[0].status,'timing-signal-only');assert.equal(timing.bundleConfirmed,false);
 assert.equal(analyzeBundleEvidence({trades:trades.map((t,i)=>({...t,blockTime:time+i*20})),funding,supply:'100'}).clusters[0].status,'shared-funder');
});
test('buyer receipts reject failed transactions, wrong signature, nonfinalized references and spoofed program logs',()=>{
 const tx={slot:100,blockTime:time,transaction:{signatures:[signature]},meta:{err:null,logMessages:eventLogs()}};
 assert.equal(receiptBuyers(tx,ref,mint)[0].wallet,creator);
 assert.throws(()=>receiptBuyers(tx,{...ref,confirmationStatus:'confirmed'},mint));assert.throws(()=>receiptBuyers(tx,{...ref,signature:'wrong'},mint));
 tx.meta.logMessages=eventLogs({program:PublicKey.default.toBase58()});assert.deepEqual(receiptBuyers(tx,ref,mint),[]);
 tx.meta.err={InstructionError:[0,'Custom']};assert.throws(()=>receiptBuyers(tx,ref,mint));
});
test('funding evidence requires a signed native SOL transfer to the actual buyer and minimum amount',()=>{
 const message=new Transaction({feePayer:new PublicKey(creator),recentBlockhash:PublicKey.default.toBase58()}).add(SystemProgram.transfer({fromPubkey:new PublicKey(creator),toPubkey:new PublicKey(wallets[0]),lamports:10000000})).compileMessage();
 const tx={slot:100,blockTime:time,transaction:{signatures:[signature],message},meta:{err:null}};
 assert.equal(receiptFunding(tx,ref,wallets[0])[0].source,creator);assert.deepEqual(receiptFunding(tx,ref,wallets[1]),[]);
 message.header.numRequiredSignatures=0;assert.deepEqual(receiptFunding(tx,ref,wallets[0]),[]);
});
test('missing launch history and an unfinished window remain partial, never safe',async()=>{
 const connection={getGenesisHash:async()=>'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',getSignaturesForAddress:async()=>[],getSlot:async()=>101,getBlockTime:async()=>time+5,getTokenSupply:async()=>({value:{amount:'100'}})};
 const report=await scanBundleWallets({connection,launch:{mint,creatorWallet:creator,onchainVerified:true,cluster:'devnet',createdTimestamp:time,signature}});
 assert.equal(report.coverage.status,'partial');assert.equal(report.coverage.reasons.length,2);assert.equal(report.bundleConfirmed,false);
 connection.getGenesisHash=async()=>'mainnet';await assert.rejects(scanBundleWallets({connection,launch:{}}),/Devnet/);
});
