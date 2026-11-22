// Builds an unsigned owner transaction. Never loads a key or sends a transaction.
import {parseArgs} from 'node:util';
import {Connection,PublicKey,Transaction} from '@solana/web3.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {richAssetsAddress,decodeRichAssets,buildConfigureRichAssets} from '../rich-assets.js';
import {assertRpcNetwork} from '../solana-network.js';
import {verifiedProgram} from '../server/price-signer-review.mjs';

const {values}=parseArgs({options:{rpc:{type:'string'},owner:{type:'string'},mint:{type:'string'},market:{type:'string'},venue:{type:'string'}}});
const release=reviewedMainnetManifest();
if(!release)throw Error('A reviewed Mainnet program release is required before preparing an owner transaction.');
if(!values.rpc||!values.owner||!values.mint||!values.market||!['pool','curve'].includes(values.venue))
  throw Error('Usage: node scripts/prepare-rich-assets.mjs --rpc URL --owner PUBLIC_KEY --mint PUBLIC_KEY --market PUBLIC_KEY --venue pool|curve');
const owner=new PublicKey(values.owner),connection=new Connection(values.rpc,'finalized');
if(String(owner)!==release.upgradeAuthority)throw Error('Owner differs from the reviewed upgrade authority.');
await assertRpcNetwork(connection,'mainnet-beta');
await verifiedProgram(connection,{programId:release.programId,upgradeAuthority:release.upgradeAuthority,programDataSha256:release.programDataSha256});
const info=await connection.getAccountInfo(richAssetsAddress(release.programId),'finalized');
const current=info?decodeRichAssets(info,{programId:release.programId}):null;
const revision=String(BigInt(current?.revision||0)+1n);
const ix=buildConfigureRichAssets({programId:release.programId,owner,mint:values.mint,market:values.market,
  venue:values.venue==='pool'?0:1,nextRevision:revision});
const blockhash=await connection.getLatestBlockhash('finalized');
const tx=new Transaction({...blockhash,feePayer:owner}).add(ix);
console.log(JSON.stringify({status:'unsigned-not-submitted',cluster:'mainnet-beta',programId:release.programId,
  owner:String(owner),previous:current&&{mint:String(current.mint),market:String(current.pool),revision:current.revision},
  next:{mint:values.mint,market:values.market,venue:values.venue,revision},
  configAddress:String(richAssetsAddress(release.programId)),historyAddress:String(richAssetsAddress(release.programId,revision)),
  blockhash,transactionBase64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')},null,2));
