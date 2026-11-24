import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PublicKey,SystemProgram,Keypair,TransactionMessage,VersionedTransaction,AddressLookupTableAccount} from '@solana/web3.js';
import bs58 from 'bs58';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {deriveFeeRouter,buildExpectedFeeRouterAccountPrefix} from '../../fee-router.js';
import {deriveAgencyPolicyV3,agencyProtocolUnits,agencyCategoryTargets} from '../../agency-mint-router-v3.js';
import {deriveTokenLedgerV3,deriveSolCreditV3,deriveTokenConversionV3} from '../../mint-router-v3-token.js';
import {priceConfigAddress} from '../../server/buyback-price-signer.mjs';
import {tokenSellFeeSetup,tokenPricePolicyHash} from '../../server/token-conversion-sell-review.mjs';
import {sellProofFixture} from './token-sell-proof-fixture.mjs';
import {buildReviewedUsdcSellConversion} from '../../server/token-conversion-sell.mjs';
import {quoteFixture} from './token-sell-quote-fixture.mjs';
import {capture} from './token-sell-capture-fixture.mjs';
import candidate from '../../config/mainnet-review-candidate.json' with {type:'json'};

const disc=name=>createHash('sha256').update('account:'+name).digest().subarray(0,8);
const key=n=>new PublicKey(new Uint8Array(32).fill(n));
const reviewElf=readFileSync(process.env.FUNDED_OFFLINE_REVIEW_ELF||'missing-required-public-current-review-elf');
const reviewElfHash=candidate.binary.sha256;
assert.equal(candidate.deployEligible,false);
assert.equal(reviewElf.length,candidate.binary.bytes);assert.equal(createHash('sha256').update(reviewElf).digest('hex'),reviewElfHash);

export function sellReviewFixture({category=5,prefund=0}={}){
  // Actual current public ELF; header, activation, review and financial RPC are
  // synthetic unit evidence only. This never admits a production manifest.
  const f=sellProofFixture({category,prefund}),market=quoteFixture(),program=f.expected.programId,operator=f.expected.authority,price=f.expected.priceSigner;
  const header=Buffer.from(f.programData.data.subarray(0,45)),upgrade=new PublicKey('5ThgFz4yFPX6fQ8mdaPjtKXeYYA6RwEMjkC2vaPMA6oi');
  upgrade.toBuffer().copy(header,13);f.programData.data=Buffer.concat([header,reviewElf]);
  Object.assign(f.release,{upgradeAuthority:String(upgrade),programDataSha256:createHash('sha256').update(f.programData.data).digest('hex'),
    sourceRevision:candidate.sourceRevision,binary:{bytes:reviewElf.length,sha256:reviewElfHash}});
  Object.assign(f.release.independentReview,{sourceRevision:f.release.sourceRevision,binarySha256:reviewElfHash});
  const info=(owner,data,lamports=1000)=>({owner,data:Buffer.from(data),lamports,executable:false});
  f.config={cluster:'mainnet-beta',programId:String(program),programDataSha256:f.release.programDataSha256,upgradeAuthority:f.release.upgradeAuthority,
    authority:String(operator),priceSigner:String(price),quotePolicy:market.policy};
  // Additional UNIT-ONLY policy approval metadata, never a production manifest.
  f.release.priceSignerPolicy=structuredClone(f.config);f.release.independentReview.priceSignerPolicySha256=tokenPricePolicyHash(f.config);
  const router=deriveFeeRouter(program),routerBytes=Buffer.alloc(131);Buffer.from(buildExpectedFeeRouterAccountPrefix()).copy(routerBytes);
  operator.toBuffer().copy(routerBytes,41);routerBytes[73]=router.bump;key(60).toBuffer().copy(routerBytes,74);routerBytes.writeBigUInt64LE(100000000n,107);
  const priceBytes=Buffer.alloc(40);disc('BuybackPriceConfig').copy(priceBytes);price.toBuffer().copy(priceBytes,8);
  const policy=deriveAgencyPolicyV3(program,f.expected.mint),policyBytes=Buffer.alloc(383);disc('MintAgencyPolicyV3').copy(policyBytes);
  f.expected.mint.toBuffer().copy(policyBytes,8);key(70).toBuffer().copy(policyBytes,40);operator.toBuffer().copy(policyBytes,72);
  agencyProtocolUnits().forEach((n,i)=>policyBytes.writeUInt32LE(n,104+i*4));policyBytes.writeUInt32LE(8000000,268);
  key(71).toBuffer().copy(policyBytes,342);policyBytes.writeBigUInt64LE(1n,374);policyBytes[382]=policy.bump;
  const ledger=deriveTokenLedgerV3(program,f.expected.mint,f.built.quoteMint),ledgerBytes=Buffer.alloc(233);disc('MintTokenLedgerV3').copy(ledgerBytes);
  f.expected.mint.toBuffer().copy(ledgerBytes,8);new PublicKey(f.built.quoteMint).toBuffer().copy(ledgerBytes,40);
  ledgerBytes.writeBigUInt64LE(1000000000n,72);const targets=agencyCategoryTargets('1000000000',agencyProtocolUnits());
  targets.forEach((n,i)=>ledgerBytes.writeBigUInt64LE(n,80+i*8));
  const tokenBytes=Buffer.alloc(165);new PublicKey(f.built.quoteMint).toBuffer().copy(tokenBytes);f.built.vault.toBuffer().copy(tokenBytes,32);
  tokenBytes.writeBigUInt64LE(targets[category],64);tokenBytes[108]=1;
  f.beforeRows=new Map([[String(router.address),info(program,routerBytes)],
    [String(priceConfigAddress(program)),info(program,priceBytes)],[String(policy.address),info(program,policyBytes)],
    [String(ledger),info(program,ledgerBytes)],[String(f.built.vault),info(SystemProgram.programId,Buffer.alloc(0))],
    [String(f.built.instruction.keys[7].pubkey),info(TOKEN_PROGRAM_ID,tokenBytes)],
    [String(f.built.instruction.keys[8].pubkey),prefund?info(SystemProgram.programId,Buffer.alloc(0),prefund):null]]);
  f.beforeRows.set(String(deriveSolCreditV3(program,f.expected.mint)),null);
  f.beforeRows.set(String(deriveTokenConversionV3(program,f.expected.mint,f.expected.conversionId)),null);
  f.addresses={router:String(router.address),price:String(priceConfigAddress(program)),policy:String(policy.address),ledger:String(ledger),
    receipt:String(deriveTokenConversionV3(program,f.expected.mint,f.expected.conversionId)),token:String(f.built.instruction.keys[7].pubkey),wsol:String(f.built.instruction.keys[8].pubkey)};
  f.rebuild=(mutate=()=>{})=>{
    const instructions=[...tokenSellFeeSetup({swap:f.expected.pumpSellInstruction,authority:operator}),f.built.instruction];mutate(instructions);
    const dynamic=new Set([operator,price,f.expected.mint,policy.address,ledger,f.built.vault,f.built.instruction.keys[7].pubkey,
      f.built.instruction.keys[8].pubkey,f.built.instruction.keys[10].pubkey,deriveSolCreditV3(program,f.expected.mint)].map(String));
    const addresses=[...new Map(instructions.flatMap(ix=>ix.keys.map(k=>[String(k.pubkey),k.pubkey]))).values()].filter(a=>!dynamic.has(String(a)));
    f.table=new AddressLookupTableAccount({key:key(90),state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:1,lastExtendedSlotStartIndex:0,addresses}});
    f.unsigned=new VersionedTransaction(new TransactionMessage({payerKey:operator,recentBlockhash:f.recentBlockhash||String(key(91)),instructions}).compileToV0Message([f.table]));
    f.request={cluster:'mainnet-beta',programId:String(program),transaction:Buffer.from(f.unsigned.serialize()).toString('base64')};
  };f.rebuild();f.now=market.now;f.market=market;f.transactions=new Map();f.balance=4000000000;f.blockhashValid=true;f.simulationCalls=0;f.programContextSlot=capture.slot;f.programDataContextSlot=capture.slot;
  const original=f.connection,readMarket=market.connection.getMultipleAccountsInfoAndContext;
  f.connection={...original,...market.connection,getSlot:async()=>market.slot,isBlockhashValid:async()=>({context:{slot:market.slot},value:f.blockhashValid}),
    getAddressLookupTable:async()=>({value:f.table}),getFeeForMessage:async()=>({value:10000}),getBalance:async()=>f.balance,
    getMinimumBalanceForRentExemption:async()=>1000,
    getAccountInfoAndContext:async(address,options)=>String(address)===String(program)||String(address)===String(PublicKey.findProgramAddressSync([program.toBuffer()],new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0])
      ?original.getAccountInfoAndContext(address,options):f.beforeRows.has(String(address))?{context:{slot:market.slot},value:f.beforeRows.get(String(address))}:market.connection.getAccountInfoAndContext(address,options),
    getAccountInfo:async address=>f.beforeRows.has(String(address))?f.beforeRows.get(String(address)):original.getAccountInfo(address),
    getMultipleAccountsInfoAndContext:async(addresses,options)=>addresses.length===7&&String(addresses[0])===f.built.pool?readMarket(addresses,options):
      {context:{slot:market.slot},value:addresses.map(address=>f.beforeRows.get(String(address))??null)},
    getTransaction:async signature=>f.transactions.get(signature)||null,
    getSignatureStatuses:async signatures=>({context:{slot:market.slot},value:signatures.map(signature=>{
      const tx=f.transactions.get(signature);return tx?{slot:tx.slot,err:tx.meta.err,confirmationStatus:'finalized'}:null;})}),
    simulateTransaction:async(_transaction,options)=>{
      assert.equal(options.sigVerify,false);assert.equal(options.commitment,'finalized');f.simulationCalls++;
      const serialize=a=>a?({...a,owner:String(a.owner),data:[Buffer.from(a.data).toString('base64'),'base64']}):null;
      const received=14211301n,afterToken=Buffer.from(f.beforeRows.get(f.addresses.token).data),afterLedger=Buffer.from(f.beforeRows.get(f.addresses.ledger).data),afterPolicy=Buffer.from(f.beforeRows.get(f.addresses.policy).data);
      afterToken.writeBigUInt64LE(afterToken.readBigUInt64LE(64)-1000000n,64);afterLedger.writeBigUInt64LE(afterLedger.readBigUInt64LE(144+category*8)+1000000n,144+category*8);
      afterPolicy.writeBigUInt64LE(afterPolicy.readBigUInt64LE(140+category*8)+received,140+category*8);
      const priorCredit=f.beforeRows.get(String(deriveSolCreditV3(program,f.expected.mint))),afterCredit=priorCredit?Buffer.from(priorCredit.data):Buffer.alloc(105);
      if(!priorCredit){disc('MintSolCreditV3').copy(afterCredit);f.expected.mint.toBuffer().copy(afterCredit,8);afterCredit[104]=PublicKey.findProgramAddressSync([Buffer.from('mint-sol-credit-v3'),f.expected.mint.toBuffer()],program)[1];}
      afterCredit.writeBigUInt64LE(afterCredit.readBigUInt64LE(40+category*8)+received,40+category*8);
      const simulatedReceipt=Buffer.from(f.receiptAccount.data);f.expected.conversionId.copy(simulatedReceipt,8);
      const beforeVault=f.beforeRows.get(String(f.built.vault)).lamports,oldWsol=f.beforeRows.get(f.addresses.wsol)?.lamports||0;
      const accounts=[serialize(info(SystemProgram.programId,Buffer.alloc(0),beforeVault+Math.max(0,1000-beforeVault)+oldWsol+Number(received))),serialize(info(TOKEN_PROGRAM_ID,afterToken)),null,
        serialize(info(program,simulatedReceipt)),serialize(info(program,afterCredit)),serialize(info(program,afterLedger)),serialize(info(program,afterPolicy))];
      const result={context:{slot:market.slot},value:{err:null,accounts}};f.lastSimulation=f.mutateSimulation?f.mutateSimulation(result):result;return f.lastSimulation;
    }};
  f.advance=(milliseconds=1000,slots=3)=>{f.now+=milliseconds;market.now=f.now;market.slot+=slots;f.programContextSlot=market.slot;f.programDataContextSlot=market.slot;};
  f.sign=()=>{const tx=VersionedTransaction.deserialize(Buffer.from(f.request.transaction,'base64'));tx.sign([Keypair.fromSeed(new Uint8Array(32).fill(33)),Keypair.fromSeed(new Uint8Array(32).fill(34))]);return Buffer.from(tx.serialize()).toString('base64');};
  f.land=base64=>{
    const signed=VersionedTransaction.deserialize(Buffer.from(base64,'base64')),message=signed.message,all=message.getAccountKeys({addressLookupTableAccounts:[f.table]}),keys=Array.from({length:all.length},(_,i)=>String(all.get(i))),at=a=>keys.indexOf(String(a));
    const preBalances=keys.map(a=>f.beforeRows.get(a)?.lamports||0),postBalances=[...preBalances],tokenIndex=at(f.addresses.token),vaultIndex=at(f.built.vault),wsolIndex=at(f.addresses.wsol);
    const oldToken=f.beforeRows.get(f.addresses.token).data.readBigUInt64LE(64),after=f.lastSimulation.value.accounts;
    const token=amount=>({accountIndex:tokenIndex,mint:f.built.quoteMint,owner:String(f.built.vault),programId:String(TOKEN_PROGRAM_ID),uiTokenAmount:{amount:String(amount),decimals:6}});
    postBalances[vaultIndex]=after[0].lamports;postBalances[wsolIndex]=0;
    const routerIndex=message.compiledInstructions.length-1,signature=bs58.encode(signed.signatures[0]);
    const tx={slot:market.slot,blockTime:Math.floor(f.now/1000),transaction:{message,signatures:signed.signatures.map(signature=>bs58.encode(signature))},meta:{err:null,fee:10000,preBalances,postBalances,
      preTokenBalances:[token(oldToken)],postTokenBalances:[token(oldToken-1000000n)],loadedAddresses:message.resolveAddressTableLookups([f.table]),innerInstructions:[{index:routerIndex,instructions:[
        {programIdIndex:at(f.expected.pumpSellInstruction.programId),accounts:f.expected.pumpSellInstruction.keys.map(k=>at(k.pubkey)),data:bs58.encode(f.expected.pumpSellInstruction.data)},
        {programIdIndex:at(TOKEN_PROGRAM_ID),accounts:[wsolIndex,vaultIndex,vaultIndex],data:bs58.encode(Buffer.from([9]))}]}]}};
    f.transactions.set(signature,tx);for(const [index,address]of [[0,String(f.built.vault)],[1,f.addresses.token],[2,f.addresses.wsol],[3,f.addresses.receipt],[4,String(deriveSolCreditV3(program,f.expected.mint))],[5,f.addresses.ledger],[6,f.addresses.policy]]){
      const a=after[index];f.beforeRows.set(address,a?{...a,owner:new PublicKey(a.owner),data:Buffer.from(a.data[0],'base64')}:null);
    }
    return signature;
  };
  f.nextNonce=number=>{
    f.expected.conversionId=Buffer.alloc(32,number);f.built=buildReviewedUsdcSellConversion(f.expected);
    f.addresses.receipt=String(deriveTokenConversionV3(program,f.expected.mint,f.expected.conversionId));f.beforeRows.set(f.addresses.receipt,null);f.rebuild();
  };
  f.args=()=>({connection:f.connection,config:f.config,signer:price,request:f.request,now:f.now,release:f.release});
  return f;
}
