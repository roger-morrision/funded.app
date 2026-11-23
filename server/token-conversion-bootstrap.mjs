import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {deriveFeeRouter,buildExpectedFeeRouterAccountPrefix} from '../fee-router.js';
import {MAINNET_ROUTER_LEN,parseProtocolGuard} from '../protocol-guard.js';
import {priceConfigAddress} from './buyback-price-signer.mjs';
import {finalizedProgramContext} from './finalized-program-context.mjs';
import {requireReviewedTokenSignerPolicy,tokenPricePolicyHash} from './token-conversion-sell-review.mjs';
import {createTokenConversionJournal} from './token-conversion-journal.mjs';
import {createTokenConversionController} from './token-conversion-controller.mjs';
import {createTokenConversionRecoveryWorker} from './token-conversion-recovery-worker.mjs';
import {createTokenConversionSigningService} from './token-conversion-signing-service.mjs';
import {conversionServiceOrigin} from './token-conversion-remote-signers.mjs';

const roles=['controller','operator','price-attestation'];
const reference=value=>typeof value==='string'&&value.trim()===value&&/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value);
const disc=createHash('sha256').update('account:BuybackPriceConfig').digest().subarray(0,8);

export function tokenConversionProvisioningDigest({spec,policy,release}){
  requireReviewedTokenSignerPolicy(policy,release);
  assert(spec?.schemaVersion===1&&spec.cluster==='mainnet-beta'&&spec.programId===policy.programId
    &&spec.programDataSha256===policy.programDataSha256&&spec.policyHash===tokenPricePolicyHash(policy)
    &&Object.keys(spec.journalReferences??{}).length===roles.length
    &&roles.every(role=>reference(spec.journalReferences?.[role]))
    &&new Set(roles.map(role=>spec.journalReferences[role])).size===3,'Exact distinct conversion provisioning context required.');
  return tokenPricePolicyHash({version:1,cluster:spec.cluster,programId:spec.programId,
    programDataSha256:spec.programDataSha256,policyHash:spec.policyHash,
    releaseHash:tokenPricePolicyHash(release),journalReferences:spec.journalReferences});
}

// Separate explicit first-use ceremony. The caller must supply the reviewed
// digest/evidence from its release packet; a normal runtime never calls this.
export async function provisionFreshTokenConversionJournals({spec,policy,release,storeFactory,review,now=Date.now}){
  const digest=tokenConversionProvisioningDigest({spec,policy,release});
  assert(review?.mode==='first-provisioning'&&review.digest===digest
    &&typeof review.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(review.evidenceSha256),
    'Explicit reviewed first-provisioning record required.');
  assert(typeof storeFactory==='function','Dedicated journal store resolver required.');
  const stores={};
  for(const role of roles)stores[role]=await storeFactory(spec.journalReferences[role]);
  for(const role of roles)assert(typeof stores[role]?.hasPublishedFile==='function'
    &&await stores[role].hasPublishedFile()===false,'First provisioning requires three genuinely unpublished stores.');
  for(const role of roles)await createTokenConversionJournal({store:stores[role],connection:null,config:policy,release,now})
    .initialize({firstProvisioningRole:role});
  return {digest,roles:[...roles]};
}

// No environment/private-file/key loader, listener, timer or production registration.
// Resolvers are supplied by the trusted runtime after approved provisioning.
export async function prepareTokenConversionRuntime({spec,policy,release,connectionFactory,storeFactory,loadAuthentication,loadCustody,now=Date.now,request=fetch}){
  spec=structuredClone(spec);policy=structuredClone(policy);release=structuredClone(release);
  requireReviewedTokenSignerPolicy(policy,release);
  assert(spec?.schemaVersion===1&&spec.cluster==='mainnet-beta'&&roles.includes(spec.role)
    &&['recovery-only','signing'].includes(spec.mode??'recovery-only'),'Explicit private conversion runtime required.');
  assert(spec.journalStartup===undefined||spec.journalStartup?.mode==='resume','Runtime cannot select first provisioning.');
  const recoveryOnly=(spec.mode??'recovery-only')==='recovery-only';
  assert(spec.programId===policy.programId&&spec.programDataSha256===policy.programDataSha256
    &&spec.policyHash===tokenPricePolicyHash(policy),'Runtime public identity/policy differs.');
  for(const field of ['journalReferences','rpcReferences','authenticationReferences'])
    assert(spec[field]&&typeof spec[field]==='object'&&!Array.isArray(spec[field])&&roles.every(role=>reference(spec[field][role])),'Opaque approved runtime references required.');
  assert(new Set(roles.map(role=>spec.journalReferences[role])).size===3,'Distinct controller/role journals required.');
  assert(new Set(roles.map(role=>spec.authenticationReferences[role])).size===3,'Dedicated service authentication references required.');
  assert(spec.rpcReferences['price-attestation']!==spec.rpcReferences.controller
    &&spec.rpcReferences['price-attestation']!==spec.rpcReferences.operator,'Own independent-price RPC reference required.');
  const priceOrigin=conversionServiceOrigin(spec.origins?.['price-attestation']),operatorOrigin=conversionServiceOrigin(spec.origins?.operator);
  assert(priceOrigin.origin!==operatorOrigin.origin,'Distinct role service origins required.');
  if(!recoveryOnly&&spec.role!=='controller')assert(reference(spec.custodyReference)&&typeof loadCustody==='function','Approved own-role custody resolver required.');
  assert(typeof connectionFactory==='function'&&typeof storeFactory==='function'&&typeof loadAuthentication==='function','Explicit trusted resolvers required.');
  let connection;try{connection=await connectionFactory(spec.rpcReferences[spec.role]);}catch{throw Error('Conversion RPC reference unavailable.');}
  const program=new PublicKey(policy.programId),router=deriveFeeRouter(program),priceAddress=priceConfigAddress(program);
  async function verifyContext(strict){
    try{
      assert(await connection.getGenesisHash()===SOLANA_GENESIS['mainnet-beta']);
      const slot=await connection.getSlot('finalized');
      const context=await finalizedProgramContext({connection,release,transactionSlot:slot});
      const read=await connection.getMultipleAccountsInfoAndContext([router.address,priceAddress],{commitment:'finalized',minContextSlot:context.programDataContextSlot});
      assert(Number.isSafeInteger(read.context?.slot)&&read.context.slot>=context.programDataContextSlot&&read.value?.length===2);
      const [header,price]=read.value,prefix=Buffer.from(buildExpectedFeeRouterAccountPrefix());
      assert(header?.owner.equals(program)&&header.executable===false&&header.data.length===MAINNET_ROUTER_LEN
        &&header.data.subarray(0,prefix.length).equals(prefix)&&header.data[73]===router.bump&&header.data[106]<=1);
      assert(price?.owner.equals(program)&&price.executable===false&&price.data.length===40&&price.data.subarray(0,8).equals(disc));
      const operator=new PublicKey(header.data.subarray(41,73)).toBase58(),priceSigner=new PublicKey(price.data.subarray(8)).toBase58(),guard=parseProtocolGuard(header.data);
      const freshSigningEligible=!guard.paused&&operator===policy.authority&&priceSigner===policy.priceSigner;
      if(strict)assert(freshSigningEligible);
      return {programId:policy.programId,programDataSha256:policy.programDataSha256,policyHash:spec.policyHash,
        genesisHash:SOLANA_GENESIS['mainnet-beta'],programContextSlot:context.programContextSlot,programDataContextSlot:context.programDataContextSlot,
        accountsContextSlot:read.context.slot,observedOperator:operator,observedPriceSigner:priceSigner,paused:guard.paused,freshSigningEligible};
    }catch{throw Error('Finalized conversion runtime context unavailable or incompatible.');}
  }
  const admission=await verifyContext(!recoveryOnly);
  async function verifyJournalSet(){
    let selected,ownResult;
    try{
      for(const role of roles){
        const candidate=await storeFactory(spec.journalReferences[role]);
        const result=await createTokenConversionJournal({store:candidate,connection,config:policy,release,now}).verifyExisting({role});
        if(role===spec.role){selected=candidate;ownResult=result;}
      }
    }catch{throw Error('Conversion journal reference unavailable or incompatible.');}
    return {store:selected,result:ownResult};
  }
  const {store}=await verifyJournalSet();
  const authentication=async role=>{
    let token;try{token=await loadAuthentication(spec.authenticationReferences[role]);}catch{throw Error('Conversion authentication reference unavailable.');}
    assert(typeof token==='string'&&token.length===64&&/^[a-f0-9]{64}$/.test(token),'Invalid conversion authentication reference.');return token;
  };
  let runtime;
  if(spec.role==='controller'){
    const [token,operatorToken,priceToken]=await Promise.all(roles.map(authentication));
    runtime=createTokenConversionController({store,connection,config:policy,release,token,now,recoveryOnly,
      priceService:{endpoint:priceOrigin.href,token:priceToken,request},operatorService:{endpoint:operatorOrigin.href,token:operatorToken,request}});
  }else{
    const publicKey=new PublicKey(spec.role==='operator'?policy.authority:policy.priceSigner);let custody;
    const signer={publicKey,signMessage:async args=>{
      assert(!recoveryOnly,'Recovery-only runtime cannot access custody.');await verifyContext(true);
      custody??=Promise.resolve().then(()=>loadCustody(spec.custodyReference,{role:spec.role,publicKey:String(publicKey)})).then(handle=>{
        assert(String(handle?.publicKey)===String(publicKey)&&typeof handle.signMessage==='function');return handle;
      }).catch(()=>{throw Error('Approved conversion custody reference unavailable or mismatched.');});
      const handle=await custody;await verifyContext(true);return handle.signMessage(args);
    }};
    runtime=createTokenConversionSigningService({store,connection,config:policy,release,role:spec.role,signer,token:await authentication(spec.role),now,recoveryOnly});
  }
  return {...runtime,initialize:async()=>{await verifyContext(!recoveryOnly);return (await verifyJournalSet()).result;},
    recoveryWorker:spec.role==='controller'&&recoveryOnly?createTokenConversionRecoveryWorker({controller:runtime}):undefined,
    admission:{...admission,role:spec.role,mode:recoveryOnly?'recovery-only':'signing'},
    scope:'prepared private runtime; no listener or worker activation, custody is lazy and requires fresh verified context'};
}
