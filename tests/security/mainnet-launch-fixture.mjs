// Fabricated public accounts and review metadata for local tests only. No RPC,
// production keys, persisted wallets or actual review approval are used here.
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,AddressLookupTableProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {deriveFeeRouter,buildExpectedFeeRouterAccountPrefix} from '../../fee-router.js';
import {MAINNET_ROUTER_LEN} from '../../protocol-guard.js';
import {richAssetsAddress} from '../../rich-assets.js';
import {deriveAgencyConfigV3,agencyDiscriminator,agencyProtocolUnits,agencyProtocolSplit} from '../../agency-mint-router-v3.js';
import {encodeAgencyRules} from '../../agency-rules-v3.js';
import {DEFAULT_AGENCY_RULES} from '../../config/agency-rules.js';
import {createMainnetLaunchReadiness} from '../../server/mainnet-launch-readiness.mjs';

const sha=data=>createHash('sha256').update(data).digest('hex');
const key=n=>Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
export function mainnetLaunchFixture(){
  const [program,owner,operator,guardian,priceSigner,mint,pool,promotion,...lookups]=Array.from({length:10},(_,i)=>key(i+51));
  const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const programData=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const elf=Buffer.from([127,69,76,70,1,2,3,4]),data=Buffer.alloc(45+elf.length);
  data.writeUInt32LE(3);data.writeBigUInt64LE(100n,4);data[12]=1;owner.toBuffer().copy(data,13);elf.copy(data,45);
  const executable=Buffer.alloc(36);executable.writeUInt32LE(2);programData.toBuffer().copy(executable,4);
  const release={schemaVersion:1,status:'reviewed',cluster:'mainnet-beta',assetConfiguration:'onchain-v1',
    programId:String(program),upgradeAuthority:String(owner),fundedMint:String(mint),fundedPool:String(pool),
    programDataSha256:sha(data),sourceRevision:'a'.repeat(40),binary:{bytes:elf.length,sha256:sha(elf)},
    independentReview:{reviewer:'mocked test reviewer',reference:'test fixture only',sourceRevision:'a'.repeat(40),binarySha256:sha(elf)},
    developerLockPeriodsSeconds:[21600,43200,86400,172800]};
  const env={FUNDED_V3_FEE_ROUTER_PROGRAM_ID:String(program),FUNDED_DEVELOPER_LOCK_PROGRAM_ID:String(program),
    VITE_FUNDED_FEE_ROUTER_PROGRAM_ID:String(program),FUNDED_V3_PROGRAM_DATA_SHA256:release.programDataSha256,
    FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:release.programDataSha256,
    FUNDED_TOKEN_MINT:String(mint),VITE_FUNDED_TOKEN_MINT:String(mint),FUNDED_SWAP_POOL:String(pool),VITE_FUNDED_SWAP_POOL:String(pool),
    FUNDED_V3_OPERATOR_PUBLIC_KEY:String(operator),FUNDED_V3_GUARDIAN_PUBLIC_KEY:String(guardian),
    FUNDED_V3_PRICE_ATTESTOR_PUBLIC_KEY:String(priceSigner),FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE:String(lookups[0]),
    FUNDED_V3_BUYBACK_LOOKUP_TABLE:String(lookups[1])};
  const router=deriveFeeRouter(program),header=Buffer.alloc(MAINNET_ROUTER_LEN);
  Buffer.from(buildExpectedFeeRouterAccountPrefix()).copy(header);operator.toBuffer().copy(header,41);header[73]=router.bump;
  guardian.toBuffer().copy(header,74);header.writeBigUInt64LE(0xffffffffffffffffn,107);
  const price=Buffer.alloc(40);createHash('sha256').update('account:BuybackPriceConfig').digest().subarray(0,8).copy(price);
  priceSigner.toBuffer().copy(price,8);
  const assets=Buffer.alloc(177);Buffer.from('aac69639f52c60c5','hex').copy(assets);
  mint.toBuffer().copy(assets,8);pool.toBuffer().copy(assets,40);TOKEN_PROGRAM_ID.toBuffer().copy(assets,72);
  assets.writeBigUInt64LE(1n,104);owner.toBuffer().copy(assets,113);
  const agency=Buffer.alloc(117);agencyDiscriminator('AgencyConfigV3').copy(agency);
  agencyProtocolUnits().forEach((value,i)=>agency.writeUInt32LE(value,8+i*4));promotion.toBuffer().copy(agency,36);
  agency.writeBigUInt64LE(1n,68);agency[76]=deriveAgencyConfigV3(program).bump;encodeAgencyRules().copy(agency,77);
  const alt=Buffer.alloc(88);alt.writeUInt32LE(1);alt.writeBigUInt64LE(0xffffffffffffffffn,4);
  alt.writeBigUInt64LE(199n,12);program.toBuffer().copy(alt,56);
  const account=(bytes,authority=program,execute=false)=>({owner:authority,executable:execute,data:bytes,lamports:1});
  const priceAddress=PublicKey.findProgramAddressSync([Buffer.from('buyback-price-signer-v1')],program)[0];
  const addresses=[program,programData,router.address,priceAddress,richAssetsAddress(program),deriveAgencyConfigV3(program).address,...lookups].map(String);
  const accounts=[account(executable,loader,true),account(data,loader),account(header),account(price),account(assets),account(agency),
    account(Buffer.from(alt),AddressLookupTableProgram.programId),account(Buffer.from(alt),AddressLookupTableProgram.programId)];
  const f={env,release,addresses,accounts,program,owner,operator,guardian,priceSigner,
    revision:account(Buffer.from(assets)),slot:200,revisionSlot:201,tip:190,genesis:SOLANA_GENESIS['mainnet-beta'],calls:[],factories:0};
  f.policy={configRevision:'1',split:agencyProtocolSplit(),rules:structuredClone(DEFAULT_AGENCY_RULES)};
  f.store={read:async()=>({adminSettings:{protocolFeePolicy:f.policy}})};
  f.connection={getGenesisHash:async()=>{f.calls.push('genesis');return f.genesis;},getSlot:async commitment=>{
    f.calls.push(['tip',commitment]);return f.tip;},
  getMultipleAccountsInfoAndContext:async(keys,options)=>{
    f.calls.push(['snapshot',keys.map(String),options]);return {context:{slot:f.slot},value:f.accounts};},
  getAccountInfoAndContext:async(address,options)=>{
    f.calls.push(['revision',String(address),options]);return {context:{slot:f.revisionSlot},value:f.revision};}};
  f.options={env,release,store:f.store,solanaRpcUrl:'https://mainnet.invalid',connectionFactory:()=>{f.factories++;return f.connection;}};
  f.reader=extra=>createMainnetLaunchReadiness({...f.options,...extra});
  return f;
}
