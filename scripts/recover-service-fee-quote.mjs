// One exact Devnet QA registration recovery. No transfers or transaction signing.
// The original quote was lost by the PostgreSQL bucket omission. Its ID embeds
// issuance milliseconds. Reconstruct that interval explicitly; do not claim the
// original serialized quote was recovered. Reuse the original signed policy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {Connection,PublicKey} from '@solana/web3.js';
import {createStore} from '../server/store.mjs';
import {readServiceFees} from '../server/service-fees.mjs';
import {verifyLaunchServiceFee} from '../server/launch-service-fee-proof.mjs';
import {launchPolicyStatement} from '../launch-policy-auth.js';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {loadServerEnvironment} from '../server/environment.mjs';

assert(['--prepare','--apply'].includes(process.argv[2]));
const journal=fs.readFileSync(process.argv[3],'utf8').trim().split('\n').map(JSON.parse);
const entry=journal.find(row=>row.stage==='registration-prepared'&&row.policy.signature==='dBBFfuhahWZ5LUCy1AH1EX8ytx5g9netSbMtBUWu5P1t6h4e8oq4E5EVik2tG1u1hovJKakk4LmGdbBFg25XWtU');
assert(entry);const {policy,policySignature}=entry;
assert.equal(policy.mint,'CkRQTeLGEz2DMxRj3todCD1qtLb77vYBjAkCBMt814ky');
assert.equal(policy.creatorWallet,'8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
assert(nacl.sign.detached.verify(new TextEncoder().encode(launchPolicyStatement(policy)),bs58.decode(policySignature),new PublicKey(policy.creatorWallet).toBytes()));
loadServerEnvironment();assert(process.env.DATABASE_URL,'Recovery requires the configured PostgreSQL store.');
const store=createStore(),fees=await readServiceFees(store),receipt=policy.launchServiceFee;
try{
  assert.equal(fees.revision,1);assert.equal(fees.hash,receipt.policyHash);
  assert.equal(receipt.amountLamports,fees.policy.launchLamports);
  const match=/^launch_service_(\d{13})_[a-f0-9]{16}$/.exec(receipt.quoteId);assert(match);
  const issued=Number(match[1]);
  const quote={id:receipt.quoteId,payer:policy.creatorWallet,recipient:receipt.recipient,amountLamports:receipt.amountLamports,policyHash:receipt.policyHash,revision:fees.revision,
    createdAt:new Date(issued).toISOString(),expiresAt:new Date(issued+600000).toISOString(),
    recovery:{reason:'quote-not-persisted-by-old-postgres-bucket-list',timingSource:'issuance-milliseconds-in-original-quote-id',originalSerializedQuoteRecovered:false,signature:policy.signature}};
  const connection=new Connection(fs.readFileSync('/run/secrets/solana_rpc_url','utf8').trim(),'finalized');
  assert.equal(await connection.getGenesisHash(),DEVNET_GENESIS_HASH);
  const tx=await connection.getTransaction(policy.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  assert.deepEqual(verifyLaunchServiceFee({transaction:tx,signature:policy.signature,mint:policy.mint,payer:policy.creatorWallet,quote}),receipt);
  if(process.argv[2]==='--apply')await store.update(state=>{
    const prior=state.launchServiceQuotes[quote.id];if(prior)assert.deepEqual(prior,quote);
    else state.launchServiceQuotes[quote.id]=quote;
    state.adminAudit['service-fee-quote-recovery:'+quote.id]={...quote.recovery,mint:policy.mint,quoteId:quote.id,at:new Date().toISOString()};
  });
  console.log(JSON.stringify({mode:process.argv[2],mint:policy.mint,signature:policy.signature,quote,originalCreatorSignatureVerified:true,finalizedFeeVerified:true,persisted:process.argv[2]==='--apply'}));
}finally{await store.close?.();}
