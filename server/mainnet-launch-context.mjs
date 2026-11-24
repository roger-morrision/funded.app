import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {AddressLookupTableAccount,AddressLookupTableProgram,PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {mainnetReleaseVerified} from './mainnet-program.mjs';
import {deriveFeeRouter,verifyFeeRouterAccount} from '../fee-router.js';
import {MAINNET_ROUTER_LEN} from '../protocol-guard.js';
import {richAssetsAddress,decodeRichAssets} from '../rich-assets.js';
import {deriveAgencyConfigV3,decodeAgencyConfigV3,agencyProtocolSplit} from '../agency-mint-router-v3.js';
import {validateAgencyRules} from '../config/agency-rules.js';
import {validateProtocolFeeSplit} from '../distribution-policy.js';

const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const priceDiscriminator=createHash('sha256').update('account:BuybackPriceConfig').digest().subarray(0,8);
const key=value=>{assert(typeof value==='string');const parsed=new PublicKey(value);assert(String(parsed)===value);return parsed;};

// Public identities only. No signer handles, credential files or environment
// activation flags can supply review approval or signing authority here.
export function mainnetLaunchIdentities(env,release){
  const reviewed=reviewedMainnetManifest(release);
  assert(reviewed,'Independent Mainnet release review is missing.');
  for(const name of ['FUNDED_V3_FEE_ROUTER_PROGRAM_ID','FUNDED_DEVELOPER_LOCK_PROGRAM_ID','VITE_FUNDED_FEE_ROUTER_PROGRAM_ID'])
    assert(env[name]===reviewed.programId,'Mainnet program aliases differ from the reviewed release.');
  for(const name of ['FUNDED_V3_PROGRAM_DATA_SHA256','FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256'])
    assert(env[name]===reviewed.programDataSha256,'Mainnet ProgramData hashes differ from the reviewed release.');
  assert((!env.FUNDED_FEE_ROUTER_PROGRAM_ID||env.FUNDED_FEE_ROUTER_PROGRAM_ID===reviewed.programId)
    &&(!env.FUNDED_REWARD_PROGRAM_DATA_SHA256||env.FUNDED_REWARD_PROGRAM_DATA_SHA256===reviewed.programDataSha256),
  'Legacy Mainnet program aliases differ from the reviewed release.');
  assert(env.FUNDED_TOKEN_MINT===reviewed.fundedMint&&env.VITE_FUNDED_TOKEN_MINT===reviewed.fundedMint
    &&env.FUNDED_SWAP_POOL===reviewed.fundedPool&&env.VITE_FUNDED_SWAP_POOL===reviewed.fundedPool,
  'Mainnet asset identities differ from the reviewed release.');
  const operator=key(env.FUNDED_V3_OPERATOR_PUBLIC_KEY),guardian=key(env.FUNDED_V3_GUARDIAN_PUBLIC_KEY),
    priceSigner=key(env.FUNDED_V3_PRICE_ATTESTOR_PUBLIC_KEY);
  const roles=[operator,guardian,priceSigner,key(reviewed.upgradeAuthority)];
  assert(roles.every(role=>!role.equals(PublicKey.default)&&String(role)!==reviewed.programId&&PublicKey.isOnCurve(role.toBytes()))
    &&new Set(roles.map(String)).size===4,
    'Distinct public production custody roles are required.');
  const lookups=[key(env.FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE),key(env.FUNDED_V3_BUYBACK_LOOKUP_TABLE)];
  return {reviewed,operator,guardian,priceSigner,lookups};
}

// All mutable deployment/configuration accounts come from one finalized RPC
// snapshot, after the selected tip. This is readiness evidence, never a permit
// to sign or a substitute for checking a transaction's own finalized receipt.
export async function readMainnetLaunchContext({connection,env,release,store}){
  const {reviewed,operator,guardian,priceSigner,lookups}=mainnetLaunchIdentities(env,release);
  assert(await connection.getGenesisHash()===SOLANA_GENESIS['mainnet-beta'],'Mainnet RPC genesis differs.');
  const minimum=await connection.getSlot('finalized');
  assert(Number.isSafeInteger(minimum)&&minimum>0,'Finalized Mainnet tip is unavailable.');
  const program=key(reviewed.programId),programData=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const router=deriveFeeRouter(program),price=PublicKey.findProgramAddressSync([Buffer.from('buyback-price-signer-v1')],program)[0];
  const addresses=[program,programData,router.address,price,richAssetsAddress(program),deriveAgencyConfigV3(program).address,...lookups];
  const snapshot=await connection.getMultipleAccountsInfoAndContext(addresses,{commitment:'finalized',minContextSlot:minimum});
  const slot=snapshot.context?.slot,accounts=snapshot.value;
  assert(Number.isSafeInteger(slot)&&slot>=minimum&&accounts?.length===addresses.length,'Finalized launch snapshot is stale or incomplete.');
  const [programAccount,dataAccount,header,priceAccount,assetAccount,agencyAccount,...lookupAccounts]=accounts;
  const evidence={account:programAccount,programData:dataAccount,programDataAddress:String(programData),sha256:sha(dataAccount?.data||[])};
  assert(mainnetReleaseVerified(evidence,program,reviewed.programDataSha256,reviewed)
    &&dataAccount.data.readBigUInt64LE(4)<BigInt(slot),'Reviewed Mainnet program is not effective at the observed slot.');
  assert(header?.executable===false&&header.data.length===MAINNET_ROUTER_LEN,'Mainnet router guard is missing.');
  const global=await verifyFeeRouterAccount({programId:program,connection:{getAccountInfo:async()=>header},commitment:'finalized'});
  assert(global.verified&&global.authority.equals(operator)&&global.guard?.guardian===String(guardian),
    'Mainnet router operator, guardian or pause state differs.');
  assert(priceAccount?.owner.equals(program)&&priceAccount.executable===false&&priceAccount.data.length===40
    &&priceAccount.data.subarray(0,8).equals(priceDiscriminator)&&priceAccount.data.subarray(8).equals(priceSigner.toBuffer()),
  'Mainnet independent price signer differs.');
  const assets=decodeRichAssets(assetAccount,{programId:program});
  assert(String(assets.mint)===reviewed.fundedMint&&String(assets.pool)===reviewed.fundedPool,'Mainnet primary assets differ.');
  const revision=await connection.getAccountInfoAndContext(richAssetsAddress(program,assets.revision),{commitment:'finalized',minContextSlot:slot});
  assert(Number.isSafeInteger(revision.context?.slot)&&revision.context.slot>=slot,'Mainnet asset revision context is stale.');
  const historical=decodeRichAssets(revision.value,{programId:program,revision:assets.revision});
  assert(['mint','pool','tokenProgram','venue'].every(name=>String(assets[name])===String(historical[name])),
    'Mainnet primary asset revision differs.');
  const agency=decodeAgencyConfigV3(agencyAccount,program),split=agencyProtocolSplit(agency.protocolUnits);
  assert(agency.rules.source==='on-chain-snapshot','Mainnet agency rules must be stored on chain.');
  const published=(await store.read()).adminSettings?.protocolFeePolicy;
  assert(published?.configRevision===agency.revision
    &&isDeepStrictEqual(validateProtocolFeeSplit(published.split),split)
    &&isDeepStrictEqual(validateAgencyRules(published.rules),validateAgencyRules(agency.rules)),
  'Published launch policy differs from finalized Mainnet configuration.');
  for(const account of lookupAccounts){
    assert(account?.owner.equals(AddressLookupTableProgram.programId)&&account.executable===false,'Mainnet lookup table owner differs.');
    const table=AddressLookupTableAccount.deserialize(account.data);
    assert(table.deactivationSlot===0xffffffffffffffffn&&table.lastExtendedSlot<slot&&table.addresses.length>0,
      'Mainnet lookup table is inactive, empty or not fully warmed up.');
  }
  return {programId:reviewed.programId,programDataSha256:reviewed.programDataSha256,
    genesisHash:SOLANA_GENESIS['mainnet-beta'],slot,assetRevisionContextSlot:revision.context.slot,
    operator:String(operator),guardian:String(guardian),priceSigner:String(priceSigner),
    assetRevision:assets.revision,protocolSplit:split,agency,
    lookupTables:lookups.map(String),guard:global.guard};
}
