import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorUpdateMutation, publicCreatorUpdates, upcomingCreatorUpdates } from '../server/creator-announcements.mjs';
import { followingUpdatesPage } from '../server/following-updates.mjs';
import { financialRows, solText } from '../src/features/experience/financial-model.js';
import { validReviewAmount } from '../src/features/experience/discovery-intent.js';
import { identityMatches } from '../src/features/experience/launch-facts.js';
import { readReminders } from '../src/features/experience/creator-activity.js';
import { estimateTradeNetworkFee } from '../src/features/experience/trade-costs.js';
import { financialProcessingMetrics } from '../server/financial-processing-metrics.mjs';
const mint = '1'.repeat(32), wallet = '2'.repeat(32), sig = '3'.repeat(64);
const now = Date.parse('2026-10-30T10:00:00Z');
test('scheduled updates stay private until due, including the following feed', () => {
  const profile = { updates:[] }, published = creatorUpdateMutation(profile, {text:'Now'}, 'a'.repeat(24), now);
  const scheduled = creatorUpdateMutation(profile, {text:'Future private text',publishAt:new Date(now + 60000).toISOString()}, 'b'.repeat(24), now);
  assert.deepEqual(publicCreatorUpdates(profile.updates, now).map(row => row.text), ['Now']);
  assert.deepEqual(upcomingCreatorUpdates(profile.updates, now), [{id:scheduled.id,publishAt:scheduled.publishAt}]);
  assert.equal(publicCreatorUpdates(profile.updates, now + 60000).length, 2);
  const page = followingUpdatesPage([{id:'123'}], {'123':{identityVerified:true,updates:[published,{...scheduled,publishAt:'2099-01-01T00:00:00Z'}]}}, ['123']);
  assert.equal(JSON.stringify(page).includes('Future private text'), false);
});
test('scheduling validates time, caps pending updates, preserves them, and cancels only pending rows', () => {
  const profile = {updates:[]};
  for (const publishAt of ['invalid', '2026-10-29T00:00:00Z', '2027-01-01T00:00:00Z']) assert.throws(() => creatorUpdateMutation(profile,{text:'x',publishAt},'a'.repeat(24),now));
  for (let i = 0; i < 10; i++) creatorUpdateMutation(profile, {text:'Scheduled',publishAt:new Date(now + 60000).toISOString()}, i.toString(16).padStart(24,'0'), now);
  assert.throws(() => creatorUpdateMutation(profile,{text:'Extra',publishAt:new Date(now + 60000).toISOString()},'f'.repeat(24),now));
  for (let i = 0; i < 30; i++) creatorUpdateMutation(profile,{text:'Immediate'},'a'.repeat(24),now);
  assert.equal(upcomingCreatorUpdates(profile.updates, now).length, 10);
  assert.equal(creatorUpdateMutation(profile,{cancelId:'0'.repeat(24)},'b'.repeat(24),now).cancelled, true);
  assert.throws(() => creatorUpdateMutation(profile,{cancelId:'a'.repeat(24)},'b'.repeat(24),now));
});
test('financial center never treats allocations, pending payments, or wrong-wallet receipts as delivery', () => {
  const experience = { cluster:'devnet', evidence:{status:'recorded-finalized-v3'}, wallet:{address:wallet,rows:[{mint,payouts:[
    {kind:'holder',wallet,signature:sig,amountLamports:'100',feeSourceVerified:true},
    {kind:'holder',wallet,signature:'4'.repeat(64),amountLamports:'900',feeSourceVerified:false},
    {kind:'holder',wallet:mint,signature:'5'.repeat(64),amountLamports:'900',feeSourceVerified:true},
  ]}]}};
  assert.equal(financialRows({experience,wallet}).length, 1);
  assert.equal(financialRows({experience,wallet:mint}).length, 0);
  assert.equal(financialRows({experience:{...experience,cluster:'mainnet-beta'},wallet}).length, 0);
});
test('approval and funding rows retain exact status and never invent payment proof', () => {
  const overview = {available:true,scope:'per-mint-v3',mint,creatorWallet:wallet,gates:{creatorRewardFunding:true},collections:[{
    signature:sig,settlement:'finalized',allocationPlan:{status:'allocated-not-funded',creatorDirected:{walletLamports:'0',holderLamports:'10',xLamports:'5'},protocol:{communityLamports:'0'}},creatorRewardFunding:'verification-pending'}]};
  let rows = financialRows({overviews:[overview],wallet}); assert.equal(rows.length, 1); assert.equal(rows[0].stage,'Processing');
  overview.collections[0].creatorRewardFunding = 'finalized';
  assert.equal(financialRows({overviews:[overview],wallet})[0].stage,'Processing');
  overview.collections[0].creatorRewardFundingVerified = true;
  rows = financialRows({overviews:[overview],wallet}); assert.equal(rows[0].stage,'Funded'); assert.equal(rows.some(row => row.stage === 'Verified'),false);
  assert.equal(financialRows({overviews:[overview],wallet:mint}).length,0);
});
test('burn receipts require both debit and burn instruction evidence and keep FUNDED units separate', () => {
  const receipt = {mint,signature:sig,status:'finalized',vaultDebitVerified:true,burnInstructionVerified:true,burnedBaseUnits:'123'};
  assert.equal(financialRows({buybacks:{cluster:'devnet',receipts:[receipt]}})[0].amount,'123 $FUNDED base units');
  assert.equal(financialRows({buybacks:{cluster:'devnet',receipts:[{...receipt,burnInstructionVerified:false}]}}).length,0);
  assert.equal(solText('1000000001'), '1.000000001 SOL'); assert.equal(solText(null),'Unavailable');
});
test('review amounts and reminders reject invalid intent and external routes', () => {
  for (const value of ['0','101','-1','1e2','NaN','.1','0.0000000001']) assert.equal(validReviewAmount(value),false);
  assert.equal(validReviewAmount('0.000000001'),true);
  const row = {id:'12345678-1234-1234-1234-123456789abc',at:now,label:'Return',href:`/token/${mint}`};
  assert.equal(readReminders({getItem:()=>JSON.stringify([row])}).length,1);
  assert.throws(()=>readReminders({getItem:()=>JSON.stringify([{...row,href:'https://evil.example/'}])}));
});
test('similarity is limited to normalized name, ticker and exact URI, excluding the same mint', () => {
  assert.equal(identityMatches({mint,name:'A coin!',symbol:'AAA'},[{mint,name:'A coin!'},{mint:wallet,name:'a COIN'}]).length,1);
  assert.equal(identityMatches({mint,name:'',symbol:''},[{mint:wallet,name:''}]).length,0);
});
test('network fee RPC failures are unavailable rather than fabricated zero costs', async () => {
  assert.equal(await estimateTradeNetworkFee({getTradePreviewConnection:async()=>({})},{}),null);
  assert.equal(await estimateTradeNetworkFee({getTradePreviewConnection:async()=>{throw new Error('Offline');}},{}),null);
});
test('network fee estimate compiles the prepared instructions without signing or submission', async () => {
  const solana = await import('@solana/web3.js'); let reads = 0;
  const user = solana.PublicKey.default;
  const trade = {user,instructions:[solana.SystemProgram.transfer({fromPubkey:user,toPubkey:user,lamports:1})]};
  const fee = await estimateTradeNetworkFee({getSolana:async()=>solana,getTradePreviewConnection:async()=>({
    getLatestBlockhash:async()=>({blockhash:solana.PublicKey.default.toBase58()}),getFeeForMessage:async message=>{reads++;assert.equal(message.instructions.length,1);return {value:5000};},
    sendRawTransaction:()=>assert.fail('Fee estimation must not send transactions'),
  })},trade);
  assert.equal(fee,'5000');assert.equal(reads,1);
});
test('timing metrics exclude unavailable or negative timestamps', () => {
  const launch = {mint,onchainVerified:true,cluster:'devnet',pumpFeeRoute:{programId:wallet,router:wallet}};
  const source = {mint,signature:sig,cluster:'devnet',scope:'per-mint-v3',status:'collected',onchainVerified:true,programId:wallet,router:wallet,recordedAt:new Date(now - 60000).toISOString()};
  const state = {launches:{[mint]:launch},collections:{[sig]:source}};
  assert.equal(financialProcessingMetrics(state,'devnet',now).approvalBacklog.oldestSeconds,60);
  state.v3Settlements = {[sig]:{status:'finalized',mint,finalizedAt:new Date(now - 10000).toISOString()}};
  assert.equal(financialProcessingMetrics(state,'devnet',now).collectionToSettlement.medianSeconds,50);
  state.v3Settlements[sig].finalizedAt = new Date(now - 90000).toISOString();
  assert.equal(financialProcessingMetrics(state,'devnet',now).collectionToSettlement.samples,0);
  assert.equal(financialProcessingMetrics(state,'devnet',now).fundedToVerifiedXPayment.medianSeconds,null);
});
