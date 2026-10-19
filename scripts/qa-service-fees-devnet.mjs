import assert from 'node:assert/strict';
import fs from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createInitializeMint2Instruction, createMintToInstruction, createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint, MINT_SIZE } from '@solana/spl-token';
import { DEFAULT_SERVICE_FEES } from '../service-fees.js';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { buildVerifiedPoolTradeTransaction, buildTradeTransaction } from '../pump-trading.js';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { quoteAtomicReserveBuy } from '../launch-community-reserve.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { metadataStatement, devnetMetadataUri } from '../devnet-metadata.js';
import { verifyLaunchServiceFee } from '../server/launch-service-fee-proof.mjs';
import { listingMemo } from '../listing-policy.js';

assert(['--preflight','--execute'].includes(process.argv[2]),'Use --preflight or --execute.');
const execute=process.argv[2]==='--execute', base='https://funded.vip';
const funder=Keypair.fromSecretKey(bs58.decode(fs.readFileSync('.secrets/funded-router-authority-secret-key','utf8').trim()));
assert.equal(funder.publicKey.toBase58(),'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const connection=new Connection(fs.readFileSync('.secrets/solana-devnet-rpc-url','utf8').trim(),{
  commitment:'finalized',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(25000)}) });
assert.equal(await connection.getGenesisHash(),DEVNET_GENESIS_HASH);
const fundingLamports=9_500_000_000, fundedBuySol=8, reserveLamports=3_000_000_000;
const balance=await connection.getBalance(funder.publicKey,'finalized');
assert(balance>=fundingLamports+reserveLamports+30_000_000,'QA funder must preserve its 3 SOL reserve and fee allowance.');
const request=async(path,body,cookie='')=>{
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin:base,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  const data=await r.json(); if(!r.ok)throw new Error(`${path}: ${r.status}: ${data.error || 'unavailable'}`); return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
};
const pricing=(await request('/api/launch-tier-quote')).data;
console.log(JSON.stringify({stage:'preflight',funder:funder.publicKey.toBase58(),balanceLamports:balance,
  maximumFundingLamports:fundingLamports,maximumFundedBuySol:fundedBuySol,minimumFunderReserveLamports:reserveLamports,
  tokenPriceUsd:pricing.tokenPriceUsd,solUsd:pricing.solUsd,expectedBurnUsd:750}));
if(!execute)process.exit(0);
assert(/^[a-f0-9]{40}$/.test(process.env.FUNDED_EXPECTED_BUILD || ''),'Set the exact tested build SHA.');
const status=(await request('/api/status')).data;
assert.equal(status.build,process.env.FUNDED_EXPECTED_BUILD);assert.equal(status.cluster,'devnet');
const config=(await request('/api/v3-launch-config')).data;assert(config.ready && config.beneficiaryRoutingOnChainEnforced);
const reserveConfig=(await request('/api/launch-reserve-config')).data;
const directory=`data/qa-evidence/service-fees-${Date.now()}`;fs.mkdirSync(directory,{recursive:true});
const guard='data/qa-evidence/service-fees-active.json';
assert(!fs.existsSync(guard),'Review the previous fee QA journal before authorizing another run. No automatic re-execution.');
fs.writeFileSync(guard,JSON.stringify({directory,build:status.build,status:'running'}),{flag:'wx'});
const evidence={build:status.build,cluster:'devnet',fundingLamports,maximumFundedBuySol:fundedBuySol,launches:[],trades:[],listing:null};
const persist=()=>fs.writeFileSync(`${directory}/evidence.json`,JSON.stringify(evidence,null,2));
const journal=event=>{const file=fs.openSync(`${directory}/transactions.jsonl`,'a');try{fs.writeSync(file,JSON.stringify({...event,at:new Date().toISOString()})+'\n');fs.fsyncSync(file);}finally{fs.closeSync(file);}};
async function finalized(signature){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){const s=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
    if(s?.confirmationStatus==='finalized'){assert.equal(s.err,null);return connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});}
    await new Promise(r=>setTimeout(r,1800));}
  throw new Error(`Uncertain submission: ${signature}; reconcile this signature without resubmission.`);
}
connection.confirmTransaction=async strategy=>{const tx=await finalized(typeof strategy==='string'?strategy:strategy.signature);return {value:{err:tx.meta.err}};};
async function send(transaction,signers,label){
  transaction.feePayer=signers[0].publicKey; transaction.recentBlockhash=(await connection.getLatestBlockhash('finalized')).blockhash;
  transaction.sign(...signers);const raw=transaction.serialize(),signature=bs58.encode(transaction.signature);
  journal({stage:'signed',label,signature,rawBase64:raw.toString('base64')});
  assert.equal(await connection.sendRawTransaction(raw,{skipPreflight:false}),signature);
  const tx=await finalized(signature);journal({stage:'finalized',label,signature,slot:tx.slot});return {signature,tx};
}
function delta(tx,address){const m=tx.transaction.message,keys=[...(m.staticAccountKeys||m.accountKeys),...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])].map(k=>k.toBase58());const i=keys.indexOf(address);assert(i>=0);return BigInt(tx.meta.postBalances[i])-BigInt(tx.meta.preBalances[i]);}
// Reuse the configured Devnet QA creator so future creator approvals do not
// become stranded when this process exits. Never export its configured key.
const creator=Keypair.fromSecretKey(bs58.decode(fs.readFileSync('.secrets/solana-devnet-creator-secret-key','utf8').trim()));
assert.equal(creator.publicKey.toBase58(),'8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
const creatorStartingBalance=await connection.getBalance(creator.publicKey,'finalized');
const sign=(message,key=creator)=>bs58.encode(nacl.sign.detached(new TextEncoder().encode(message),key.secretKey));
const provider={signTransaction:async tx=>{if(tx instanceof VersionedTransaction)tx.sign([creator]);else tx.partialSign(creator);
  const raw=tx.serialize();journal({stage:'signed-launch',signature:bs58.encode(tx instanceof VersionedTransaction?tx.signatures[0]:tx.signature),rawBase64:Buffer.from(raw).toString('base64')});return tx;}};
try{
  // Save the approved values through a real allowlisted admin session. Prices
  // are not temporarily lowered to make these tests cheap or appear to pass.
  const admin=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('.secrets/devnet-admin-qa-keypair.json','utf8'))));
  const challenge=(await request('/api/admin/challenge',{wallet:admin.publicKey.toBase58()})).data;
  const session=await request('/api/admin/session',{wallet:admin.publicKey.toBase58(),nonce:challenge.nonce,signature:sign(challenge.message,admin)});
  const old=(await request('/api/admin/service-fees',undefined,session.cookie)).data;
  assert.deepEqual(old.policy,DEFAULT_SERVICE_FEES);
  const saved=(await request('/api/admin/service-fees',{policy:DEFAULT_SERVICE_FEES,expectedRevision:old.revision,expectedHash:old.hash,reason:'Verify approved recommended service fees on Devnet'},session.cookie)).data;
  evidence.admin={wallet:admin.publicKey.toBase58(),revision:saved.revision,policyHash:saved.hash};persist();
  const fees=(await request('/api/service-fees')).data;assert.equal(fees.hash,saved.hash);
  const fundedMint=new PublicKey(pricing.fundedMint),fundedAta=getAssociatedTokenAddressSync(fundedMint,creator.publicKey);
  evidence.creator=creator.publicKey.toBase58();persist();
  evidence.funding=(await send(new Transaction().add(SystemProgram.transfer({fromPubkey:funder.publicKey,toPubkey:creator.publicKey,lamports:fundingLamports})),[funder],'fund-disposable-qa-wallet')).signature;persist();
  const fundedTrade=await buildVerifiedPoolTradeTransaction({connection,side:'buy',mint:fundedMint,poolAddress:pricing.pool,user:creator.publicKey,amount:fundedBuySol,slippagePercent:1,feeOwner:fees.tradeRecipient,feeBps:fees.policy.tradeBps});
  const bought=await send(new Transaction().add(...fundedTrade.instructions),[creator],'buy-funded-for-quoted-burns');
  assert.equal(delta(bought.tx,fees.tradeRecipient),BigInt(fundedTrade.feeLamports));
  evidence.trades.push({kind:'funded-pool-buy',signature:bought.signature,appFeeLamports:String(fundedTrade.feeLamports),treasuryDeltaVerified:true});persist();
  const reserveQuote=await quoteAtomicReserveBuy({connection,supply:1e9,decimals:6,reserveTokens:30000000,developerBaseUnits:0n});
  assert(reserveQuote.maxSolAmountLamports<250000000n,'Each QA reserve buy must remain below 0.25 SOL.');
  for(const tier of ['standard','pro','premier']){
    const current=(await request('/api/service-fees')).data;assert.equal(current.hash,fees.hash,'Fee revision changed during QA.');
    const service=(await request('/api/launch-service-quote',{payer:creator.publicKey.toBase58(),expectedHash:fees.hash})).data;
    let burn=null;
    if(tier!=='standard'){const q=(await request('/api/launch-tier-quote',{tier,payer:creator.publicKey.toBase58()})).data;burn={tier,fundedMint:pricing.fundedMint,amountTokens:q.amountTokens,quoteId:q.id,requiresBurn:true};}
    const supplyBefore=(await getMint(connection,fundedMint,'finalized')).supply;
    const launch=await submitPumpDevnetLaunch({connection,provider,payer:creator.publicKey,
      input:{name:`Fee ${tier} QA`,symbol:'FEEQA',supply:1e9,decimals:6,initialBuySol:0,reserveTokens:30000000,maxInitialBuyLamports:reserveQuote.maxSolAmountLamports,feeShares:{creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0}},
      v3FeeRouter:{programId:config.programId,initialAuthority:config.initialAuthority,split:config.protocolSplit},useMintRouter:true,
      feeRouterProgramId:config.programId,reserveConfig,launchBurn:burn,launchServiceQuote:service,
      prepareMetadata:async({mint,name,symbol})=>{const record={mint,creatorWallet:creator.publicKey.toBase58(),name,symbol,description:'Disposable Devnet service fee verification.',tagline:'Fee QA',roadmap:'',website:'',x:'',telegram:'',discord:'',imageSha256:''};
        const result=(await request('/api/devnet-metadata',{...record,imageBase64:'',imageType:'',signature:sign(metadataStatement(record))})).data;assert.equal(result.uri,devnetMetadataUri(mint));return result.uri;},
      onJournal:event=>{journal(event);if(event.signature)console.log(JSON.stringify({stage:'launch',tier,state:event.state,signature:event.signature}));}});
    const mint=launch.mint.publicKey.toBase58(),transaction=await finalized(launch.signature);
    const receipt=verifyLaunchServiceFee({transaction,signature:launch.signature,mint,payer:creator.publicKey.toBase58(),quote:service});
    if(burn)assert(supplyBefore-(await getMint(connection,fundedMint,'finalized')).supply>=BigInt(burn.amountTokens)*1000000n);
    const policy={mint,chain:'solana',cluster:'devnet',signature:launch.signature,creatorWallet:creator.publicKey.toBase58(),communityAllocation:3,
      launchServiceFee:receipt,...(burn?{creatorLaunchBurn:burn}:{}),feeDistribution:buildFeeDistributionPolicy({creatorWalletPercent:80,feeRouterAddress:launch.feeRouter.toBase58()}),
      pumpFeeRoute:{router:launch.feeRouter.toBase58(),scope:'per-mint-v3',transaction:launch.signature,programId:config.programId,initialAuthority:config.initialAuthority,protocolSplit:config.protocolSplit}};
    journal({stage:'registration-prepared',policy,policySignature:sign(launchPolicyStatement(policy))});
    const registered=(await request('/api/launches',{...policy,policySignature:sign(launchPolicyStatement(policy))})).data;
    assert.equal(registered.launchServiceFee.amountLamports,'20000000');assert.equal(registered.launchServiceFee.balanceDeltaVerified,true);
    const included=await fetch(base+'/api/listings/quote',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({mint,payer:creator.publicKey.toBase58()})});
    assert.equal(included.status,409);assert.equal((await included.json()).included,true);
    evidence.launches.push({tier,mint,signature:launch.signature,serviceFee:receipt,promotionBurnTokens:burn?.amountTokens || 0,promotionSupplyDeltaVerified:Boolean(burn),includedListingVerified:true});persist();
  }
  const tradeMint=new PublicKey(evidence.launches[0].mint);
  for(const side of ['buy','sell']){
    let amount=0.01;
    if(side==='sell'){const ata=getAssociatedTokenAddressSync(tradeMint,creator.publicKey,false,(await connection.getAccountInfo(tradeMint,'finalized')).owner);amount=Number((await connection.getTokenAccountBalance(ata,'finalized')).value.amount)/1e6/2;}
    const trade=await buildTradeTransaction({connection,side,mint:tradeMint,user:creator.publicKey,amount,slippagePercent:1,feeOwner:fees.tradeRecipient,feeBps:fees.policy.tradeBps});
    const paid=await send(new Transaction().add(...trade.instructions),[creator],`coin-${side}`);
    assert.equal(delta(paid.tx,fees.tradeRecipient),BigInt(trade.feeLamports));
    evidence.trades.push({kind:`coin-${side}`,signature:paid.signature,appFeeLamports:String(trade.feeLamports),treasuryDeltaVerified:true});persist();
  }
  const external=Keypair.generate(),metadataProgram=new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  const [metadata]=PublicKey.findProgramAddressSync([Buffer.from('metadata'),metadataProgram.toBuffer(),external.publicKey.toBuffer()],metadataProgram);
  const str=value=>{const b=Buffer.from(value),n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);};
  const data=Buffer.concat([Buffer.from([33]),str('External Fee QA'),str('EFQA'),str(''),Buffer.from([0,0,0,0,0,1,0])]);
  const externalAta=getAssociatedTokenAddressSync(external.publicKey,creator.publicKey);
  const created=await send(new Transaction().add(SystemProgram.createAccount({fromPubkey:creator.publicKey,newAccountPubkey:external.publicKey,lamports:await connection.getMinimumBalanceForRentExemption(MINT_SIZE),space:MINT_SIZE,programId:TOKEN_PROGRAM_ID}),
    createInitializeMint2Instruction(external.publicKey,6,creator.publicKey,null),createAssociatedTokenAccountInstruction(creator.publicKey,externalAta,creator.publicKey,external.publicKey),createMintToInstruction(external.publicKey,externalAta,creator.publicKey,1000000000000000n),
    new TransactionInstruction({programId:metadataProgram,data,keys:[{pubkey:metadata,isSigner:false,isWritable:true},{pubkey:external.publicKey,isSigner:false,isWritable:false},{pubkey:creator.publicKey,isSigner:true,isWritable:false},{pubkey:creator.publicKey,isSigner:true,isWritable:true},{pubkey:creator.publicKey,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:SYSVAR_RENT_PUBKEY,isSigner:false,isWritable:false}]})),[creator,external],'create-external-qa-mint');
  const quote=(await request('/api/listings/quote',{mint:external.publicKey.toBase58(),payer:creator.publicKey.toBase58()})).data;assert.equal(quote.usd,300);
  const supplyBefore=(await getMint(connection,fundedMint,'finalized')).supply;
  const paid=await send(new Transaction().add(createBurnCheckedInstruction(fundedAta,fundedMint,creator.publicKey,BigInt(quote.amountBaseUnits),quote.decimals),new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from(listingMemo(external.publicKey.toBase58()))})),[creator],'external-listing-burn');
  const listing=(await request('/api/listings',{mint:external.publicKey.toBase58(),wallet:creator.publicKey.toBase58(),signature:paid.signature,quoteId:quote.id})).data;
  assert.equal(listing.onchainVerified,true);assert.equal(listing.usd,300);assert(supplyBefore-(await getMint(connection,fundedMint,'finalized')).supply>=BigInt(quote.amountBaseUnits));
  evidence.listing={mint:listing.mint,signature:paid.signature,usd:300,amountBaseUnits:quote.amountBaseUnits,supplyDeltaVerified:true,creationSignature:created.signature};persist();
  const left=await connection.getBalance(creator.publicKey,'finalized');
  if(left>creatorStartingBalance+2000000)evidence.refund=(await send(new Transaction().add(SystemProgram.transfer({fromPubkey:creator.publicKey,toPubkey:funder.publicKey,lamports:left-creatorStartingBalance-2000000})),[creator],'return-unused-qa-sol')).signature;
  evidence.finalFunderLamports=await connection.getBalance(funder.publicKey,'finalized');assert(evidence.finalFunderLamports>=reserveLamports);
  evidence.status='verified';persist();fs.writeFileSync(guard,JSON.stringify({directory,build:status.build,status:'verified'}));console.log(JSON.stringify({stage:'verified',directory,...evidence}));process.exit(0);
}catch(error){evidence.status='incomplete';evidence.error=String(error.message).replace(/https?:\/\/\S+/g,'[endpoint]');persist();console.log(JSON.stringify({stage:'incomplete',directory,error:evidence.error}));process.exit(1);}
