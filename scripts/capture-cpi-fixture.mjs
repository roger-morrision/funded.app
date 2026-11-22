// Public, finalized read-only snapshots for isolated SBF execution. No signing
// keys are loaded, persisted, or sent; the synthetic vault exists only in tests.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {Connection,PublicKey,SYSVAR_RENT_PUBKEY,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {OnlinePumpAmmSdk,PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';
import {selectV3PumpBuy} from '../server/v3-buyback-setup.mjs';
import {readBuybackCurve,quoteCurveBuyback} from '../server/v3-buyback-curve.mjs';
import {assertRpcNetwork} from '../solana-network.js';

const [venue='pool',market='EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32',directory='tmp/cpi-fixtures/pool',cluster='devnet',categoryText='6',sourceText='Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr']=process.argv.slice(2);
if(!['devnet','mainnet-beta'].includes(cluster))throw Error('Expected devnet or mainnet-beta.');
const sell=venue==='sell';
if(!['pool','curve','sell'].includes(venue))throw Error('Expected pool, curve or sell.');
if(!['5','6','7'].includes(categoryText)||venue==='curve'&&categoryText!=='6')throw Error('Expected pool category 5, 6, or 7; curve supports only 6.');
const rpc=new Connection(cluster==='devnet'?'https://api.devnet.solana.com':'https://api.mainnet-beta.solana.com',
  {commitment:'finalized',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(30000)})});
await assertRpcNetwork(rpc,cluster);
const program=new PublicKey('3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh');
const source=new PublicKey(sourceText);
const category=Number(categoryText);
const vault=PublicKey.findProgramAddressSync([Buffer.from('mint-fee-vault-v3'),source.toBuffer(),Buffer.from([category])],program)[0];
let buy,mint,pool,tokenProgram,creatorRent='0';
if(venue==='pool'||sell){
  pool=new PublicKey(market);
  const state=await new OnlinePumpAmmSdk(rpc).swapSolanaState(pool,vault);
  mint=state.pool.baseMint;tokenProgram=(await rpc.getAccountInfo(mint,'finalized')).owner;
  if(sell){
    const instructions=await PUMP_AMM_SDK.sellBaseInput(state,new BN(1000000),1);
    buy=instructions.find(ix=>ix.programId.equals(PUMP_AMM_PROGRAM_ID)&&Buffer.from(ix.data).subarray(0,8).toString('hex')==='33e685a4017f83ad');
    if(!buy||buy.data.length!==24)throw Error('Unexpected sell instruction ABI.');
  }else buy=selectV3PumpBuy(await PUMP_AMM_SDK.buyQuoteInput(state,new BN(1000000),1));
}else{
  mint=new PublicKey(market);const snapshot=await readBuybackCurve(rpc,mint);
  if(!snapshot||snapshot.curve.complete)throw Error('No live curve for this public fixture mint.');
  pool=snapshot.address;
  const quote=await quoteCurveBuyback({connection:rpc,mint,vault,budgetLamports:'1000000',snapshot});
  buy=quote.pumpBuyInstruction;tokenProgram=quote.baseTokenProgram;creatorRent=quote.curveCreatorVaultRentLamports;
}
const addresses=[...new Map([...buy.keys.map(k=>k.pubkey),mint,pool,buy.programId,SYSVAR_RENT_PUBKEY,SYSVAR_CLOCK_PUBKEY].map(k=>[String(k),k])).values()];
const result=await rpc.getMultipleAccountsInfoAndContext(addresses,{commitment:'finalized'});
const accounts=result.value.flatMap((a,i)=>a?[{address:String(addresses[i]),owner:String(a.owner),lamports:a.lamports,
  executable:a.executable,dataHex:a.data.toString('hex')}]:[]);
const out=resolve(directory);await mkdir(out,{recursive:true});
const programs=[];
for(const id of [...new Set(accounts.filter(a=>a.executable&&a.owner==='BPFLoaderUpgradeab1e11111111111111111111111').map(a=>a.address))]){
  // SPL programs are supplied by LiteSVM; clone only the external venue/fee programs.
  if(id.startsWith('Token')||id==='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')continue;
  const account=accounts.find(a=>a.address===id),raw=Buffer.from(account.dataHex,'hex');
  if(raw.readUInt32LE(0)!==2||raw.length!==36)throw Error('Unexpected upgradeable program state.');
  const dataAddress=new PublicKey(raw.subarray(4,36)),data=await rpc.getAccountInfo(dataAddress,'finalized');
  if(!data||String(data.owner)!==account.owner||data.data.readUInt32LE(0)!==3)throw Error('Invalid ProgramData.');
  const elf=data.data.subarray(45),file=`${id}.so`;
  await writeFile(resolve(out,file),elf);
  programs.push({address:id,programData:String(dataAddress),file,bytes:elf.length,sha256:createHash('sha256').update(elf).digest('hex')});
}
const buyData=Buffer.from(buy.data),buyDiscriminator=buyData.subarray(0,8).toString('hex');
if(!sell&&!['66063d1201daebea','c62e1552b4d9e870'].includes(buyDiscriminator))throw Error('Unexpected buy instruction ABI.');
const output=buyData.readBigUInt64LE(buyDiscriminator==='66063d1201daebea'?8:16);
const minimum=venue==='pool'?output*99n/100n:output;
const fixture={schemaVersion:1,scope:'public-snapshot-for-local-only-execution',cluster,observedAt:new Date().toISOString(),slot:result.context.slot,
  venue,category,routerProgram:String(program),sourceMint:String(source),mint:String(mint),market:String(pool),tokenProgram:String(tokenProgram),
  vault:String(vault),...(sell?{}:{quoteLamports:'1000000',minBaseAmountOut:String(minimum)}),creatorRent,programs,accounts,
  ...(sell?{exactBaseIn:'1000000',minQuoteOut:String(output)}:{}),
  [sell?'sell':'buy']:{programId:String(buy.programId),dataHex:Buffer.from(buy.data).toString('hex'),keys:buy.keys.map(k=>({...k,pubkey:String(k.pubkey)}))}};
await writeFile(resolve(out,'fixture.json'),JSON.stringify(fixture,null,2)+'\n');
console.log(JSON.stringify({directory:out,venue,cluster,mint:fixture.mint,market:fixture.market,slot:fixture.slot,accounts:accounts.length,programs}));
