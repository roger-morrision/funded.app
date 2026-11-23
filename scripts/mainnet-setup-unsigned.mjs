// Offline inventory for the four fresh Mainnet setup instructions. This module
// never loads a signer, opens an RPC connection, signs, or submits a transaction.
import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram,TransactionInstruction,TransactionMessage} from '@solana/web3.js';
import {buildConfigureProtocolGuard,deriveRouterHeader} from '../protocol-guard.js';
import {buildConfigureRichAssets,richAssetsAddress} from '../rich-assets.js';

const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const INITIALIZE=Buffer.from(createHash('sha256').update('global:initialize').digest().subarray(0,8));
const PRICE=Buffer.from(createHash('sha256').update('global:configure_buyback_price_signer').digest().subarray(0,8));
const U64_MAX=(1n<<64n)-1n;
const address=(value,name)=>{
  if(typeof value!=='string')throw Error(`${name} must be a public address.`);
  const key=new PublicKey(value);
  if(key.toBase58()!==value)throw Error(`${name} must be a canonical public address.`);
  return key;
};
const meta=(pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
const programData=program=>PublicKey.findProgramAddressSync([program.toBuffer()],LOADER)[0];
const priceConfig=program=>PublicKey.findProgramAddressSync([Buffer.from('buyback-price-signer-v1')],program)[0];
const decoded=ix=>({programId:ix.programId.toBase58(),dataBase64:ix.data.toString('base64'),
  accounts:ix.keys.map((key,index)=>({index,address:key.pubkey.toBase58(),signer:key.isSigner,writable:key.isWritable}))});
const unsignedMessage=(ix,payer,blockhash)=>{
  const message=new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[ix]}).compileToV0Message();
  const bytes=Buffer.from(message.serialize());
  const compiledInstruction=TransactionMessage.decompile(message).instructions[0];
  return {version:0,feePayer:payer.toBase58(),recentBlockhash:blockhash,
    messageBase64:bytes.toString('base64'),messageSha256:createHash('sha256').update(bytes).digest('hex'),
    requiredSigners:message.staticAccountKeys.slice(0,message.header.numRequiredSignatures).map(key=>key.toBase58()),
    instruction:decoded(compiledInstruction),feeQuoteLamports:null,feeQuoteContextSlot:null};
};

export function buildMainnetSetupInventory({plan,dailyCapLamports=null,feePayers={},recentBlockhash=null}={}){
  if(plan?.cluster!=='mainnet-beta'||plan?.deploymentMode!=='fresh-isolated-mainnet'
    ||plan.mainnetActivationAuthorized!==false)throw Error('A fresh, inactive Mainnet deployment plan is required.');
  const ids=plan.selectedPublicIdentities;
  const program=address(ids?.program,'program'),owner=address(ids?.adminUpgrade,'adminUpgrade');
  const operator=address(ids?.automationOperator,'automationOperator');
  const guardian=address(ids?.offlineGuardian,'offlineGuardian');
  const signer=address(ids?.priceAttestor,'priceAttestor');
  const mint=address(ids?.primaryMint,'primaryMint'),pool=address(ids?.primaryPool,'primaryPool');
  if(program.toBase58()!==plan.mainnetProgramId||owner.toBase58()!==plan.upgradeAuthority
    ||mint.toBase58()!==plan.fundedMint||pool.toBase58()!==plan.fundedPool
    ||new Set([program,owner,operator,guardian,signer,mint,pool].map(key=>key.toBase58())).size!==7
    ||[owner,operator,guardian,signer].some(key=>!PublicKey.isOnCurve(key.toBytes())))
    throw Error('The selected program, asset and distinct signer roles must match the public plan.');
  if(feePayers===null||typeof feePayers!=='object'||Array.isArray(feePayers))throw Error('Explicit fee payer mapping required.');
  const known=new Set(['initializeRouter','configureGuard','configurePriceSigner','configurePrimaryAsset']);
  for(const step of Object.keys(feePayers))if(!known.has(step))throw Error(`Unknown setup step: ${step}.`);
  const cap=dailyCapLamports===null?null:dailyCapLamports;
  if(cap!==null&&(typeof cap!=='string'||!/^(0|[1-9]\d*)$/.test(cap)||BigInt(cap)>U64_MAX))
    throw Error('A reviewed u64 daily cap in lamports is required.');
  const pd=programData(program),router=deriveRouterHeader(program);
  const steps=[
    {name:'initializeRouter',purpose:'Create the fresh router; operator pays its account rent.',
      ix:new TransactionInstruction({programId:program,data:INITIALIZE,
        keys:[meta(operator,true,true),meta(owner,true),meta(router,false,true),meta(program),meta(pd),meta(SystemProgram.programId)]})},
    {name:'configureGuard',purpose:'Set guardian and reviewed daily SOL outflow cap.',
      ix:cap===null?null:buildConfigureProtocolGuard({programId:program,upgradeOwner:owner,guardian,dailyCapLamports:cap}),
      missing:cap===null?['reviewedDailyCapLamports']:[]},
    {name:'configurePriceSigner',purpose:'Create price signer configuration; admin pays its account rent.',
      ix:new TransactionInstruction({programId:program,data:PRICE,
        keys:[meta(owner,true,true),meta(signer,true),meta(program),meta(pd),meta(priceConfig(program),false,true),meta(SystemProgram.programId)]})},
    {name:'configurePrimaryAsset',purpose:'Create primary asset current and immutable revision 1; admin pays both rents.',
      ix:buildConfigureRichAssets({programId:program,owner,mint,market:pool,venue:0,nextRevision:1})},
  ];
  const block=recentBlockhash===null?null:address(recentBlockhash,'recentBlockhash').toBase58();
  return {status:'offline-unsigned-preparation',cluster:'mainnet-beta',programId:program.toBase58(),
    programData:pd.toBase58(),preconditions:[
      'The selected ExUNA program is freshly deployed and finalized with the independently reviewed ELF and upgrade authority.',
      'Router, guard, price config, current asset config and revision 1 are absent before their respective instructions.',
      'The selected mint and pool are refreshed from finalized Mainnet accounts before any signing.',
    ],
    steps:steps.map(({name,purpose,ix,missing=[]})=>{
      const payerRaw=feePayers[name];
      const payer=payerRaw===undefined?null:address(payerRaw,`${name} fee payer`);
      const unresolved=[...missing,...(payer?[]:['feePayer']),...(block?[]:['recentBlockhash'])];
      return {name,purpose,status:ix?'instruction-built':'missing-reviewed-policy',
        instruction:ix?decoded(ix):null,message:ix&&payer&&block?unsignedMessage(ix,payer,block):null,
        unresolved,expectedRentPayer:name==='initializeRouter'?operator.toBase58()
          :['configurePriceSigner','configurePrimaryAsset'].includes(name)?owner.toBase58():null};
    }),
    warning:'Offline only. Message blockhash and fee quotes are time-sensitive; this is not a signing request or release approval.'};
}
