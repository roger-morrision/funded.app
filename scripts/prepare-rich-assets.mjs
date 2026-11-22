// Builds an unsigned owner transaction. Never loads a key or sends a transaction.
import {parseArgs} from 'node:util';
import {Connection,PublicKey,Transaction} from '@solana/web3.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {richAssetsAddress,decodeRichAssets,buildConfigureRichAssets,buildProposeRichAuthority,buildAcceptRichAuthority} from '../rich-assets.js';
import {assertRpcNetwork} from '../solana-network.js';
import {verifiedProgram} from '../server/price-signer-review.mjs';

const {values}=parseArgs({options:{rpc:{type:'string'},owner:{type:'string'},mint:{type:'string'},market:{type:'string'},venue:{type:'string'},action:{type:'string',default:'configure'},successor:{type:'string'}}});
const release=reviewedMainnetManifest();
if(!release)throw Error('A reviewed Mainnet program release is required before preparing an owner transaction.');
const action=values.action;
if(!values.rpc||!values.owner||!['configure','propose','accept'].includes(action)
  ||action==='configure'&&(!values.mint||!values.market||!['pool','curve'].includes(values.venue))
  ||action==='propose'&&!values.successor)
  throw Error('Supply --rpc URL --owner PUBLIC_KEY and --action configure|propose|accept. Configure needs --mint, --market, --venue pool|curve; propose needs --successor.');
const owner=new PublicKey(values.owner),connection=new Connection(values.rpc,'finalized');
await assertRpcNetwork(connection,'mainnet-beta');
await verifiedProgram(connection,{programId:release.programId,upgradeAuthority:release.upgradeAuthority,programDataSha256:release.programDataSha256});
const info=await connection.getAccountInfo(richAssetsAddress(release.programId),'finalized');
const current=info?decodeRichAssets(info,{programId:release.programId}):null;
const expected=action==='accept'?current?.pendingAuthority:current?.authority||release.upgradeAuthority;
if(!expected||String(owner)!==String(expected))throw Error('Signing wallet differs from the current RICH administrator or nominated successor.');
const revision=String(BigInt(current?.revision||0)+1n);
const ix=action==='configure'?buildConfigureRichAssets({programId:release.programId,owner,mint:values.mint,market:values.market,
  venue:values.venue==='pool'?0:1,nextRevision:revision}):action==='propose'
  ?buildProposeRichAuthority({programId:release.programId,authority:owner,successor:values.successor})
  :buildAcceptRichAuthority({programId:release.programId,authority:owner});
const blockhash=await connection.getLatestBlockhash('finalized');
const tx=new Transaction({...blockhash,feePayer:owner}).add(ix);
console.log(JSON.stringify({status:'unsigned-not-submitted',cluster:'mainnet-beta',programId:release.programId,
  action,owner:String(owner),successor:values.successor,previous:current&&{mint:String(current.mint),market:String(current.pool),revision:current.revision},
  next:action==='configure'?{mint:values.mint,market:values.market,venue:values.venue,revision}:null,
  configAddress:String(richAssetsAddress(release.programId)),historyAddress:action==='configure'?String(richAssetsAddress(release.programId,revision)):null,
  blockhash,transactionBase64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')},null,2));
