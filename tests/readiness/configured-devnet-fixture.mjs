import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PublicKey,Keypair,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction,AddressLookupTableAccount} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,NATIVE_MINT,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import {configuredDevnetInterface} from '../../server/configured-devnet-interface.mjs';
import {decodeRichAssets,richAssetsAddress} from '../../rich-assets.js';
import {buildV3BuybackInstruction} from '../../server/v3-buyback-instruction.mjs';
import {deriveFeeRouter,buildExpectedFeeRouterAccountPrefix} from '../../fee-router.js';
import {deriveMintPolicyV3,deriveMintVaultsV3,protocolGrossUnits} from '../../mint-router-v3.js';
import {priceConfigAddress} from '../../server/buyback-price-signer.mjs';
import {v3BuybackFeeSetup} from '../../server/v3-buyback-setup.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const disc = name => createHash('sha256').update(name).digest().subarray(0,8);
const key = n => new PublicKey(new Uint8Array(32).fill(n));
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const context = configuredDevnetInterface();
// Required public artifacts, never keys. Missing/wrong bytes fail the dedicated
// command rather than silently skipping the integration cases.
const artifact = readFileSync(process.env.FUNDED_OFFLINE_ROUTER_ARTIFACT || 'missing-required-router-artifact');
assert.equal(artifact.length,context.elfBytes); assert.equal(hash(artifact),context.elfSha256);
const snapshot = JSON.parse(readFileSync(process.env.FUNDED_OFFLINE_CONTEXT_SNAPSHOT || 'missing-required-context-snapshot','utf8'));
assert.equal(snapshot.genesis,context.genesisHash);
assert.equal(snapshot.addresses[0],context.programId); assert.equal(snapshot.addresses[1],context.programDataAddress);
const publicInfo = row => ({...row,owner:new PublicKey(row.owner),data:Buffer.from(row.data[0],'base64')});
const executable = publicInfo(snapshot.value[0]), programData = publicInfo(snapshot.value[1]);
assert.equal(hash(programData.data),context.programDataSha256);
assert.ok(programData.data.subarray(45,45+artifact.length).equals(artifact));

export function configuredFixture(t,{revision='2'}={}) {
  t.mock.method(globalThis,'fetch',()=>assert.fail('Offline unsigned harness attempted network access'));
  const f={context,activeRevision:revision,finalized:false,quoteCalls:0,now:Date.now(),slot:525102250};
  const program=new PublicKey(context.programId),authority=new PublicKey(context.upgradeAuthority);
  const signer=Keypair.fromSeed(new Uint8Array(32).fill(77)).publicKey;
  const sourceMint=key(55),creator=key(56),policy=deriveMintPolicyV3(program,sourceMint),router=deriveFeeRouter(program);
  const vault=deriveMintVaultsV3(program,sourceMint)[6],quote=10000n,burned=20000n,rent=1000,remaining=50000n;
  const info=(owner,data,lamports=1000,executable=false)=>({owner,data:Buffer.from(data),lamports,executable});
  const history=new Map([['1',publicInfo(snapshot.value[3])],['2',publicInfo(snapshot.value[4])]]);
  const routerData=Buffer.alloc(74);Buffer.from(buildExpectedFeeRouterAccountPrefix()).copy(routerData);authority.toBuffer().copy(routerData,41);routerData[73]=router.bump;
  const initialPolicy=Buffer.alloc(249);disc('account:MintFeePolicyV3').copy(initialPolicy);sourceMint.toBuffer().copy(initialPolicy,8);creator.toBuffer().copy(initialPolicy,40);authority.toBuffer().copy(initialPolicy,72);
  const units=protocolGrossUnits();units.forEach((n,i)=>initialPolicy.writeUInt32LE(n,104+i*4));
  initialPolicy.writeBigUInt64LE(1000000n,128);
  [800000n,...units.map(n=>BigInt(n)/10n)].forEach((n,i)=>initialPolicy.writeBigUInt64LE(n,136+i*8));initialPolicy[248]=policy.bump;
  const mintData=Buffer.alloc(82);mintData.writeBigUInt64LE(1000000n,36);mintData[44]=6;mintData[45]=1;
  const selectedAssets=rev=>decodeRichAssets(history.get(rev),{programId:program,revision:rev});
  function makeBuy(assets) {
    const ata=getAssociatedTokenAddressSync(assets.mint,vault,true,TOKEN_PROGRAM_ID),wsol=getAssociatedTokenAddressSync(NATIVE_MINT,vault,true,TOKEN_PROGRAM_ID);
    const keys=Array.from({length:25},(_,i)=>({pubkey:key(100+i),isSigner:false,isWritable:false}));
    for(const [i,pubkey]of [[0,assets.pool],[1,vault],[3,assets.mint],[4,NATIVE_MINT],[5,ata],[6,wsol],[11,TOKEN_PROGRAM_ID],[12,TOKEN_PROGRAM_ID],[13,SystemProgram.programId],[14,ASSOCIATED_TOKEN_PROGRAM_ID],[16,PUMP_AMM_PROGRAM_ID]])keys[i].pubkey=pubkey;
    for(const [ownerIndex,ataIndex]of [[9,10],[18,17],[23,24]])keys[ataIndex].pubkey=getAssociatedTokenAddressSync(NATIVE_MINT,keys[ownerIndex].pubkey,true,TOKEN_PROGRAM_ID);
    keys[1].isSigner=true;
    const data=Buffer.alloc(25);Buffer.from([102,6,61,18,1,218,235,234]).copy(data);data.writeBigUInt64LE(100n,8);data.writeBigUInt64LE(quote,16);
    return new TransactionInstruction({programId:PUMP_AMM_PROGRAM_ID,keys,data});
  }
  f.build=(rev=revision,{agency=false,contextOverride=context,mutate=()=>{}}={})=>{
    const assets=selectedAssets(rev),buy=makeBuy(assets);
    const input={cluster:'devnet',programId:program,sourceMint,authority,creator,priceSigner:signer,baseTokenProgram:TOKEN_PROGRAM_ID,
      buybackId:Buffer.alloc(32,Number(rev)),spendableQuoteIn:String(quote),minBaseAmountOut:'100',maxTotalDebit:String(quote),
      pumpBuyInstruction:buy,richAssets:assets,configuredDevnet:contextOverride,agencyPolicy:agency};
    const built=buildV3BuybackInstruction(input);mutate(built.instruction);
    const setup=v3BuybackFeeSetup({pumpBuyInstruction:buy,authority});
    const addresses=[...new Map([...setup,built.instruction].flatMap(ix=>ix.keys.map(k=>k.pubkey)).filter(k=>!k.equals(authority)&&!k.equals(signer)).map(k=>[String(k),k])).values()];
    const table=new AddressLookupTableAccount({key:key(90),state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:1,lastExtendedSlotStartIndex:0,authority,addresses}});
    const message=new TransactionMessage({payerKey:authority,recentBlockhash:String(key(91)),instructions:[...setup,built.instruction]}).compileToV0Message([table]);
    const transaction=new VersionedTransaction(message);const messageKeys=message.getAccountKeys({addressLookupTableAccounts:[table]});
    const allKeys=Array.from({length:messageKeys.length},(_,i)=>String(messageKeys.get(i)));
    const row=Buffer.alloc(160);disc('account:MintBuybackV3').copy(row);built.buybackId.copy(row,8);sourceMint.toBuffer().copy(row,40);assets.mint.toBuffer().copy(row,72);assets.pool.toBuffer().copy(row,104);row.writeBigUInt64LE(quote,136);row.writeBigUInt64LE(burned,144);row.writeBigInt64LE(BigInt(Math.floor(f.now/1000)),152);
    return {rev,assets,buy,built,table,transaction,allKeys,receiptData:row,request:{cluster:'devnet',programId:String(program),transaction:Buffer.from(transaction.serialize()).toString('base64')}};
  };
  f.current=f.build();
  const afterPolicy=()=>{const data=Buffer.from(initialPolicy);data.writeBigUInt64LE(quote,192+6*8);return data;};
  const account=address=>{
    if(address.equals(program))return executable;
    if(address.equals(new PublicKey(context.programDataAddress)))return programData;
    if(address.equals(richAssetsAddress(program)))return history.get(f.activeRevision);
    for(const rev of ['1','2'])if(address.equals(richAssetsAddress(program,rev)))return history.get(rev);
    if(address.equals(priceConfigAddress(program)))return info(program,Buffer.concat([disc('account:BuybackPriceConfig'),signer.toBuffer()]));
    if(address.equals(router.address))return info(program,routerData);
    if(address.equals(policy.address))return info(program,f.finalized?afterPolicy():initialPolicy);
    if(address.equals(vault))return info(SystemProgram.programId,Buffer.alloc(0),rent+Number(remaining)-(f.finalized?Number(quote):0));
    if(address.equals(f.current.built.receipt))return f.finalized?info(program,f.current.receiptData):null;
    if(['1','2'].some(rev=>address.equals(selectedAssets(rev).mint)))return info(TOKEN_PROGRAM_ID,mintData);
    return null;
  };
  const simulated=(owner,data,lamports=1000)=>({owner:String(owner),data:[Buffer.from(data).toString('base64'),'base64'],lamports,executable:false});
  f.connection={
    getGenesisHash:async()=>context.genesisHash,
    getAccountInfo:async address=>account(address),
    getMultipleAccountsInfo:async addresses=>addresses.map(account),
    getSlot:async()=>f.slot,getBlockTime:async()=>Math.floor(f.now/1000),
    isBlockhashValid:async()=>({context:{slot:f.slot+1},value:true}),
    getAddressLookupTable:async()=>({value:f.current.table}),
    getMinimumBalanceForRentExemption:async()=>rent,getFeeForMessage:async()=>({value:10000}),getBalance:async()=>10000000000,
    getAccountInfoAndContext:async address=>({context:{slot:f.slot+2},value:account(address)}),
    simulateTransaction:async()=>{
      const mint=Buffer.from(mintData);mint.writeBigUInt64LE(1000000n-burned,36);
      const ata=Buffer.alloc(165);f.current.assets.mint.toBuffer().copy(ata);vault.toBuffer().copy(ata,32);ata[108]=1;
      return {value:{err:null,accounts:[simulated(SystemProgram.programId,Buffer.alloc(0),rent+Number(remaining-quote)),
        simulated(TOKEN_PROGRAM_ID,mint),simulated(TOKEN_PROGRAM_ID,ata),simulated(program,f.current.receiptData),simulated(program,afterPolicy())]}};
    },
    sendRawTransaction:async()=>assert.fail('Unsigned harness attempted broadcast'),
  };
  f.marketQuote=async()=>{f.quoteCalls++;return {spendableQuoteIn:String(quote),minBaseAmountOut:'100',baseTokenProgram:TOKEN_PROGRAM_ID,pumpBuyInstruction:f.current.buy,recipientChoices:[],curve:false};};
  f.config={cluster:'devnet',programId:String(program),programDataSha256:context.programDataSha256,upgradeAuthority:context.upgradeAuthority,
    authority:String(authority),assetConfiguration:'onchain-v1',maxOrderLamports:'10000',mint:String(f.current.assets.mint),pool:String(f.current.assets.pool)};
  f.reviewArgs=()=>({connection:f.connection,config:f.config,signer,request:f.current.request,marketQuote:f.marketQuote,now:f.now,configuredDevnet:context});
  f.proofArgs=()=>({connection:f.connection,signature:bs58.encode(Buffer.alloc(64,4)),...f.current.built,
    programId:program,cluster:'devnet',sourceMint,creator,initialAuthority:authority,authority,baseTokenProgram:TOKEN_PROGRAM_ID,
    priceSigner:signer,pumpBuyInstruction:f.current.buy,configuredDevnet:context});
  f.transactionProof=()=>{
    const {transaction,allKeys,built,assets}=f.current,message=transaction.message;
    const index=p=>allKeys.indexOf(String(p));
    const inner=(programId,accounts,data)=>({programIdIndex:index(programId),accounts:accounts.map(index),data:bs58.encode(data)});
    const pump=Buffer.alloc(25);Buffer.from([198,46,21,82,180,217,232,112]).copy(pump);pump.writeBigUInt64LE(quote,8);pump.writeBigUInt64LE(100n,16);
    const burn=Buffer.alloc(10);burn[0]=15;burn.writeBigUInt64LE(burned,1);burn[9]=6;
    const pre=allKeys.map(()=>1000),post=[...pre];pre[index(vault)]=rent+Number(remaining);post[index(vault)]=rent+Number(remaining-quote);pre[index(built.quoteAta)]=0;post[index(built.quoteAta)]=0;
    const loaded=message.getAccountKeys({addressLookupTableAccounts:[f.current.table]}).accountKeysFromLookups;
    return {slot:f.slot,transaction:{signatures:[f.proofArgs().signature],message:{staticAccountKeys:message.staticAccountKeys,header:message.header,compiledInstructions:message.compiledInstructions}},
      meta:{err:null,loadedAddresses:loaded,preBalances:pre,postBalances:post,innerInstructions:[{index:message.compiledInstructions.length-1,instructions:[
        inner(PUMP_AMM_PROGRAM_ID,[assets.pool,vault],pump),inner(TOKEN_PROGRAM_ID,[built.fundedAta,assets.mint,vault],burn),
        inner(TOKEN_PROGRAM_ID,[built.quoteAta,vault,vault],Buffer.from([9]))]}]}};
  };
  f.connection.getTransaction=async()=>f.transactionProof();
  return f;
}
