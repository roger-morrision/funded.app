// Bounded live Devnet fixture. Newly created trader keys stay in memory only.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,VersionedTransaction,sendAndConfirmTransaction} from '@solana/web3.js';
import {quoteAtomicReserveBuy} from '../launch-community-reserve.js';
import {submitPumpDevnetLaunch} from '../launch-flow.js';
import {buildTradeTransaction} from '../pump-trading.js';
import {buildFeeDistributionPolicy} from '../distribution-policy.js';
import {launchPolicyStatement} from '../launch-policy-auth.js';
import {metadataStatement} from '../devnet-metadata.js';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
const base='https://funded.vip',execute=process.argv.includes('--execute'),resume=process.argv.includes('--resume');
const runId=process.argv.find(arg=>arg.startsWith('--run-id='))?.slice(9)||'session';
assert(/^[a-z0-9-]{1,32}$/.test(runId),'Use a short QA run identifier.');
const file=new URL(`../tmp/bonus-5m-qa-${runId}.json`,import.meta.url);
const feeOwner=new PublicKey(process.env.FUNDED_TRADE_FEE_OWNER||'CmhmRtKYExJC76R5nsPV9ovPYacoEQFEL7VhaKRZmLy2');
const secret=async name=>(await readFile(new URL(`../.secrets/${name}`,import.meta.url),'utf8')).trim();
const creator=Keypair.fromSecretKey(bs58.decode(await secret('solana-devnet-creator-secret-key')));
const payer=Keypair.fromSecretKey(bs58.decode(await secret('funded-router-authority-secret-key')));
assert.equal(creator.publicKey.toBase58(),'8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
assert.equal(payer.publicKey.toBase58(),'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const connection=new Connection(await secret('solana-devnet-rpc-url'),'finalized');
assert.equal(await connection.getGenesisHash(),DEVNET_GENESIS_HASH);
const token=await secret('funded-api-token');
async function request(path,input,authorized=false){
  const response=await fetch(base+path,{...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)}),
    headers:{origin:base,'content-type':'application/json',...(authorized?{authorization:`Bearer ${token}`}:{})},signal:AbortSignal.timeout(120000)});
  const data=await response.json();assert(response.ok,`${path}: ${response.status} ${data.error||''}`);return data;
}
const sign=message=>bs58.encode(nacl.sign.detached(new TextEncoder().encode(message),creator.secretKey));
const config=await request('/api/v3-launch-config'),reserveConfig=await request('/api/launch-reserve-config'),status=await request('/api/status');
assert.equal(status.cluster,'devnet');assert.equal(status.status,'operational');assert(config.ready);
assert.equal(config.initialAuthority,payer.publicKey.toBase58());assert.equal(config.programId,reserveConfig.programId);
const [creatorBalance,payerBalance]=await Promise.all([creator,payer].map(row=>connection.getBalance(row.publicKey,'finalized')));
const quote=await quoteAtomicReserveBuy({connection,supply:1000000000,decimals:6,reserveTokens:30000000,developerBaseUnits:0n});
assert(quote.maxSolAmountLamports<=100000000n);
const topUp=Math.max(0,100000000-creatorBalance);
assert(topUp<=100000000 && payerBalance-topUp-240000000>3000000000,'QA payer must retain 3 SOL.');
console.log(JSON.stringify({stage:'preflight',execute,cluster:'devnet',creator:creator.publicKey.toBase58(),payer:payer.publicKey.toBase58(),
  creatorBalance,payerBalance,topUp,maximumReserveLamports:String(quote.maxSolAmountLamports),newTraderFundingCapLamports:240000000,programId:config.programId}));
if(!execute)process.exit(0);
let journal;try{journal=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
assert(!journal||resume,'An existing public QA journal requires --resume; never repeat an uncertain launch.');
journal||={cluster:'devnet',startedAt:new Date().toISOString(),programId:config.programId,creator:creator.publicKey.toBase58(),trades:[]};
const save=async()=>writeFile(file,JSON.stringify(journal,null,2));
if(!journal.mint){
  assert(!resume,'No launch mint in the journal; inspect previous signatures before resuming.');
  if(topUp){journal.topUpSignature=await sendAndConfirmTransaction(connection,new Transaction().add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:creator.publicKey,lamports:topUp})),[payer],{commitment:'finalized'});await save();}
  const name=`Bonus 5m QA ${Date.now().toString(36).slice(-6)}`,symbol='B5QA';
  const result=await submitPumpDevnetLaunch({connection,payer:creator.publicKey,provider:{signTransaction:async tx=>{tx instanceof VersionedTransaction?tx.sign([creator]):tx.partialSign(creator);return tx;}},
    input:{name,symbol,supply:1000000000,decimals:6,initialBuyPercent:0,reserveTokens:30000000,maxInitialBuyLamports:quote.maxSolAmountLamports,
      feeShares:{creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0}},
    feeRouterProgramId:config.programId,useMintRouter:true,v3FeeRouter:{programId:config.programId,initialAuthority:config.initialAuthority,split:config.protocolSplit},reserveConfig,
    prepareMetadata:async({mint})=>{const record={mint,creatorWallet:creator.publicKey.toBase58(),name,symbol,description:'Disposable Devnet five-minute bonus QA coin.',tagline:'Automatic bonus QA',roadmap:'',website:'',x:'',telegram:'',discord:'',imageSha256:''};
      return(await request('/api/devnet-metadata',{...record,imageBase64:'',imageType:'',signature:sign(metadataStatement(record))})).uri;},
    onJournal:event=>{if(event.signature)console.log(JSON.stringify({stage:'launch-step',state:event.state,signature:event.signature}));}});
  journal.mint=(result.mint.publicKey||result.mint).toBase58();journal.launchSignature=result.signature;journal.router=result.feeRouter.toBase58();await save();
  const feeDistribution=buildFeeDistributionPolicy({creatorWalletPercent:80,holderAirdropPercent:0,xPercent:0,feeRouterAddress:journal.router});
  const policy={mint:journal.mint,chain:'solana',cluster:'devnet',signature:result.signature,creatorWallet:creator.publicKey.toBase58(),communityAllocation:3,feeDistribution,
    pumpFeeRoute:{router:journal.router,scope:'per-mint-v3',transaction:result.signature,programId:config.programId,initialAuthority:config.initialAuthority,protocolSplit:config.protocolSplit}};
  const launch=await request('/api/launches',{...policy,policySignature:sign(launchPolicyStatement(policy))});assert(launch.onchainVerified);journal.registered=true;await save();
}
assert(journal.registered,'Launch registration requires review before continuation.');
console.log(JSON.stringify({stage:'launch-registered',mint:journal.mint,signature:journal.launchSignature}));
assert.notEqual(feeOwner.toBase58(),journal.router,'The separate app trading fee must never be sent to the mint fee router.');
if(process.argv.includes('--setup-only')){journal.setupOnly=true;await save();console.log(JSON.stringify({stage:'ready-for-qa-allowlist',mint:journal.mint}));process.exit(0);}
if(process.argv.includes('--fresh-trades')){
  assert(resume&&!journal.collection&&journal.trades.length===3&&!journal.previousTrades,'A fresh bounded trade round requires one completed setup and no collection.');
  journal.previousTrades=journal.trades;journal.trades=[];await save();
}
if(!journal.trades.length){
  assert(!resume||journal.setupOnly||process.argv.includes('--fresh-trades'),'Trader stage was not completed; review before creating fresh traders.');
  journal.setupOnly=false;await save();
  // Leave enough time for three finalizations plus collection in one QA window.
  while(Math.floor(Date.now()/1000)%300>120){
    console.log(JSON.stringify({stage:'waiting-for-complete-trade-window',at:new Date().toISOString()}));
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
  const traders=Array.from({length:3},()=>Keypair.generate()),amounts=[0.03,0.02,0.01];
  journal.traderWallets=traders.map(wallet=>wallet.publicKey.toBase58());await save();
  journal.traderFundingSignature=await sendAndConfirmTransaction(connection,new Transaction().add(...traders.map(wallet=>SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:wallet.publicKey,lamports:80000000}))),[payer],{commitment:'finalized'});await save();
  for(const [index,trader] of traders.entries()){
    const trade=await buildTradeTransaction({connection,side:'buy',mint:new PublicKey(journal.mint),user:trader.publicKey,amount:amounts[index],slippagePercent:3,feeOwner});
    const signature=await sendAndConfirmTransaction(connection,new Transaction().add(...trade.instructions),[trader],{commitment:'finalized'});
    journal.trades.push({wallet:trader.publicKey.toBase58(),signature,spendSol:amounts[index]});await save();console.log(JSON.stringify({stage:'trade-finalized',...journal.trades.at(-1)}));
  }
}
assert.equal(journal.trades.length,3,'An incomplete trader stage requires review; no automatic retry.');
if(!journal.collection){
  const tradeProofs=await Promise.all(journal.trades.map(row=>connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0})));
  const windowStart=Math.floor(Date.now()/300000)*300;
  assert(tradeProofs.every(tx=>tx&&tx.meta?.err===null&&Math.floor(tx.blockTime/300)*300===windowStart),'Trades are outside one complete five-minute window. Inspect their signatures before continuing.');
  const before=await request(`/api/tokens/${journal.mint}/fee-activity`);
  const collected=before.collections?.some(row=>row.settlement!=='finalized')
    ? {status:'existing-collection-awaiting-settlement'} : await request('/api/keeper/collect',{mint:journal.mint},true);
  const activity=await request(`/api/tokens/${journal.mint}/fee-activity`),sources=[];
  assert(activity.collections.length<=3,'Unexpected QA collections require review.');
  for(const row of activity.collections){const tx=await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    assert(tx&&tx.meta?.err===null);sources.push({signature:row.signature,blockTime:tx.blockTime});}
  const current=sources.find(row=>row.blockTime>=windowStart&&row.blockTime<windowStart+300);
  assert(current,'No finalized collection in the current trader window; inspect the public records.');
  journal.collection=current.signature;journal.collectionSources=sources;journal.collectStatus=collected.status;await save();
}
async function creatorSigned(kind){
  const path=`/api/tokens/${journal.mint}/v3-${kind}/${journal.collection}`,prepared=await request(path,{});
  if(prepared.status==='finalized')return prepared;
  assert.equal(prepared.status,'awaiting-creator-signature');
  const tx=Transaction.from(Buffer.from(prepared.transaction,'base64'));
  assert(tx.instructions.every(ix=>[config.programId,'ComputeBudget111111111111111111111111111111'].includes(ix.programId.toBase58())),'Unexpected prepared transaction program.');
  tx.partialSign(creator);const result=await request(path,{creatorSignedTransaction:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')});
  assert.equal(result.status,'finalized');return result;
}
const primary=journal.collection;journal.sources||=[];
for(const source of journal.collectionSources||[{signature:primary}]){
  journal.collection=source.signature;
  const settlement=await creatorSigned('settlement');assert(settlement.referralUpline?.length>0,'The QA creator must have a real frozen referral.');
  journal.referrers=settlement.referralUpline;
  if(!journal.referrerFundingChecked){
    const recipient=new PublicKey(journal.referrers[0]),minimum=await connection.getMinimumBalanceForRentExemption(0,'finalized')+100000;
    const balance=await connection.getBalance(recipient,'finalized'),amount=Math.max(0,minimum-balance);
    assert(amount<=1100000,'QA referrer top-up exceeds the bound.');
    if(amount)journal.referrerQAFunding={amount,signature:await sendAndConfirmTransaction(connection,new Transaction().add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:amount})),[payer],{commitment:'finalized'})};
    journal.referrerFundingChecked=true;await save();
  }
  const funding=await creatorSigned('community-funding');assert(funding.balanceDeltaVerified&&BigInt(funding.amount)>0n&&BigInt(funding.amount)<1000000n);
  journal.sources=journal.sources.filter(row=>row.collection!==source.signature);
  journal.sources.push({collection:source.signature,blockTime:source.blockTime,settlement:settlement.settlementSignature,funding:{signature:funding.signature,amount:funding.amount,vault:funding.recipient}});await save();
}
journal.collection=primary;
journal.fundedAt=new Date().toISOString();await save();
console.log(JSON.stringify({stage:'bonus-source-funded',...journal}));
process.exit(0);
