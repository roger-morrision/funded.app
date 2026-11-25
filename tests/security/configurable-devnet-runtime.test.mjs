import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,Keypair,TransactionInstruction,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,NATIVE_MINT,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {CONFIGURED_DEVNET_PROGRAM as release} from '../../configured-devnet-program.js';
import {createPrimaryRichReader} from '../../server/primary-rich.mjs';
import {loadPrimaryRichForApp} from '../../src/app/startup/primary-rich.js';
import {priceReviewNetwork} from '../../server/price-review-network.mjs';
import {buildV3BuybackInstruction} from '../../server/v3-buyback-instruction.mjs';
import {deriveMintVaultsV3} from '../../mint-router-v3.js';
import {richAssetsAddress} from '../../rich-assets.js';
import {preparePrimaryTokenChange} from '../../primary-token-change.js';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {protocolBuybackTotals} from '../../server/home-dashboard-metrics.mjs';
import {createCommunityDeliveryRuntime} from '../../server/community-delivery-runtime.mjs';
const key=()=>Keypair.generate().publicKey;
function fixture(){
 const mint=key(),pool=key(),owner=key(),program=new PublicKey(release.programId),data=Buffer.alloc(177);
 Buffer.from('aac69639f52c60c5','hex').copy(data);mint.toBuffer().copy(data,8);pool.toBuffer().copy(data,40);
 TOKEN_PROGRAM_ID.toBuffer().copy(data,72);data.writeBigUInt64LE(4n,104);owner.toBuffer().copy(data,113);
 const connection={getGenesisHash:async()=>SOLANA_GENESIS.devnet,getAccountInfo:async()=>({owner:program,data,executable:false})};
 return{mint,pool,owner,program,data,connection};
}
test('configured Devnet primary reader follows revisions and never falls back to the environment mint',async()=>{
 const f=fixture(),read=createPrimaryRichReader({cluster:'devnet',programId:release.programId,connection:f.connection,fundedMint:String(key())});
 assert.equal((await read()).fundedMint,String(f.mint));assert.equal((await read()).authority,String(f.owner));
 const next=key();next.toBuffer().copy(f.data,8);f.data.writeBigUInt64LE(5n,104);
 assert.equal((await read()).fundedMint,String(next));assert.equal((await read()).revision,'5');
 f.connection.getAccountInfo=async()=>null;await assert.rejects(read(),/unavailable/);
});
test('configured Devnet browser loads the admitted primary token and fails closed on wrong identity',async()=>{
 const config={cluster:'devnet',programId:release.programId,configuration:'onchain-v1',fundedMint:String(key()),revision:'4',pool:String(key())};
 const request=async()=>({ok:true,json:async()=>config});
 assert.equal((await loadPrimaryRichForApp('devnet',{programId:release.programId,request})).fundedMint,config.fundedMint);
 config.programId=String(key());assert.equal((await loadPrimaryRichForApp('devnet',{programId:release.programId,request})).fundedMint,'');
});
test('configured Devnet signer requires pinned code and server-side asset admission',()=>{
 const config={...release,assetConfiguration:'onchain-v1'},request={cluster:'devnet',programId:release.programId};
 assert.equal(priceReviewNetwork(config,request).configured,true);
 assert.throws(()=>priceReviewNetwork({...config,programDataSha256:'a'.repeat(64)},request));
 assert.throws(()=>priceReviewNetwork({...config,assetConfiguration:undefined},request));
 assert.throws(()=>priceReviewNetwork(config,{...request,cluster:'mainnet-beta'}));
 const legacy={cluster:'devnet',programId:String(key())};assert.equal(priceReviewNetwork(legacy,{...legacy,configuredDevnet:release}).configured,undefined);
});
test('configured Devnet buyback builder includes the live asset revision and canonical config account',()=>{
 const f=fixture(),authority=key(),sourceMint=key(),vault=deriveMintVaultsV3(f.program,sourceMint)[6],amm=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
 const keys=Array.from({length:25},()=>({pubkey:key(),isSigner:false,isWritable:false}));
 for(const [i,pubkey]of [[0,f.pool],[1,vault],[3,f.mint],[4,NATIVE_MINT],[5,getAssociatedTokenAddressSync(f.mint,vault,true)],
  [6,getAssociatedTokenAddressSync(NATIVE_MINT,vault,true)],[11,TOKEN_PROGRAM_ID],[12,TOKEN_PROGRAM_ID],[13,SystemProgram.programId],[14,ASSOCIATED_TOKEN_PROGRAM_ID],[16,amm]])keys[i].pubkey=pubkey;
 const args={cluster:'devnet',programId:f.program,sourceMint,authority,creator:key(),priceSigner:key(),baseTokenProgram:TOKEN_PROGRAM_ID,
  buybackId:Buffer.alloc(32,1),spendableQuoteIn:'10000',minBaseAmountOut:'1',maxTotalDebit:'10000',
  pumpBuyInstruction:new TransactionInstruction({programId:amm,keys,data:Buffer.from([102,6,61,18,1,218,235,234])}),
  richAssets:{mint:f.mint,pool:f.pool,tokenProgram:TOKEN_PROGRAM_ID,revision:'4',venue:0}};
 const built=buildV3BuybackInstruction(args);assert.equal(built.instruction.data.length,72);assert.equal(built.instruction.data.readBigUInt64LE(64),4n);
 assert(built.instruction.keys.at(-1).pubkey.equals(richAssetsAddress(f.program)));assert.equal(built.richAssets.revision,'4');
 assert.throws(()=>buildV3BuybackInstruction({...args,richAssets:null}),/finalized/);
});
test('primary token preparation rejects stale revisions and wrong administrators before wallet signing',async()=>{
 const f=fixture(),args={connection:f.connection,cluster:'devnet',programId:release.programId,owner:f.owner,mint:f.mint,market:f.pool,venue:0,revision:'4',verifyRelease:async()=>release};
 await assert.rejects(preparePrimaryTokenChange({...args,owner:key()}),/administrator/);
 await assert.rejects(preparePrimaryTokenChange({...args,revision:'3'}),/changed/);
});
test('primary token totals never combine burn units from different mints',()=>{
 const mint=String(key()),other=String(key()),source=String(key());
 const order={status:'finalized',finalized:true,vaultDebitVerified:true,burnInstructionVerified:true,mint:source,programId:release.programId,
  fundedMint:mint,signature:'2'.repeat(88),spentLamports:'500',burnedBaseUnits:'700',receipt:'receipt'};
 const state={launches:{[source]:{onchainVerified:true,cluster:'devnet',pumpFeeRoute:{programId:release.programId}}},
  v3BuybackOrders:{a:order,b:{...order,fundedMint:other,signature:'3'.repeat(88),burnedBaseUnits:'900'}}};
 assert.equal(protocolBuybackTotals(state,'devnet',mint).burnedBaseUnits,'700');
 assert.equal(protocolBuybackTotals(state,'devnet',other).burnedBaseUnits,'900');
 assert.equal(protocolBuybackTotals(state,'devnet',null),null);
});
test('community preparation follows primary rotation while saved eligibility survives unavailable current configuration',async()=>{
 const authority={publicKey:new PublicKey(release.upgradeAuthority)},oldMint=String(key()),newMint=String(key()),launchMint=String(key()),oldLaunch=String(key());
 const launch=mint=>({mint,creatorWallet:String(authority.publicKey),cluster:'devnet',onchainVerified:true,communityAirdrop:{reservedTokens:1},
  pumpFeeRoute:{scope:'per-mint-v3',verified:true,programId:release.programId,initialAuthority:String(authority.publicKey)}});
 const app={launches:{[oldLaunch]:launch(oldLaunch),[launchMint]:launch(launchMint)},communityReserveReceipts:{[launchMint]:{signature:'funding'}}};
 const ledger={communityDrops:{[oldLaunch]:{eligibilityMint:oldMint,snapshotBasis:'pump-migration'}}},observed=[];
 let active=newMint,reads=0;
 const runtime=createCommunityDeliveryRuntime({store:{read:async()=>app},automaticRewardStore:{read:async()=>ledger,transaction:async fn=>fn(ledger)},
  solanaCluster:'devnet',solanaRpcUrl:'http://127.0.0.1:1',connection:{},fundedTokenMint:oldMint,v3AuthorityKeypair:()=>authority,
  getPrimaryRich:async()=>{reads++;if(!active)throw Error('unavailable');return{fundedMint:active};},
  env:{SOLANA_CLUSTER:'devnet',FUNDED_COMMUNITY_AUTO_DELIVERY_ENABLED:'true',FUNDED_V3_FEE_ROUTER_PROGRAM_ID:release.programId,FUNDED_V3_PROGRAM_DATA_SHA256:release.programDataSha256},
  scanPools:async()=>new Set([launchMint]),findMigration:async()=> 'migration',logger:{error:()=>{}},
  serviceFactory:input=>{observed.push(input.eligibilityMint);return{prepare:async()=>({})};}});
 await runtime.tick({preparationOnly:true});assert.deepEqual(observed,[oldMint,newMint]);assert.equal(reads,1);
 delete app.launches[launchMint];active=null;observed.length=0;
 await runtime.tick({preparationOnly:true});assert.deepEqual(observed,[oldMint]);assert.equal(reads,1);
});
