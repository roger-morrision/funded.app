import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import bs58 from 'bs58';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {buildRewardManifest,SOL_ASSET_MINT,verifyRewardProof} from '../../reward-merkle.js';
import {deriveRouterHeader} from '../../protocol-guard.js';
import {createAutomaticRewardChain,rewardAddresses,rewardReserveAddress} from '../../server/automatic-reward-chain.mjs';
import {sellReviewFixture} from './token-sell-review-fixture.mjs';

const key=n=>Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
const disc=name=>createHash('sha256').update('account:'+name).digest().subarray(0,8);
export const PAYOUT_ASSETS=[{name:'SOL',asset:'SOL'},
  {name:'USDC',asset:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',tokenProgram:TOKEN_PROGRAM_ID},
  {name:'Token2022',asset:'7R4MP6VX7n3RMNhL9zsk5Zu5ibZvwq8npUYnRq7epump',tokenProgram:TOKEN_2022_PROGRAM_ID}];

// Actual SDK PDAs, Merkle producer, account codecs, instructions and in-memory
// signatures. All financial RPC/bank state is synthetic and never submitted.
export function historicalPayoutFixture({asset='SOL',tokenProgram=TOKEN_PROGRAM_ID}={}){
  assert(!process.env.FUNDED_PROGRAM_EVIDENCE_RPC_URL&&!process.env.FUNDED_MAINNET_PROGRAM_EVIDENCE_RPC_URL,'Offline payout fixtures cannot configure network evidence providers.');
  const f=sellReviewFixture(),program=f.expected.programId,mint=f.expected.mint,operator=f.expected.authority,original=key(32),paidRecipient=key(37),recipient=key(38);
  const cycleId=Buffer.alloc(32,88).toString('hex'),manifest=buildRewardManifest({cycleId,asset,allocations:[{recipient:String(paidRecipient),amount:'100'},{recipient:String(recipient),amount:'200'}]});
  const {vault,cycle}=rewardAddresses({programId:program,authority:original,mint,cycleId}),reserve=rewardReserveAddress({programId:program,vault,asset}),router=deriveRouterHeader(program);
  const info=(owner,data,lamports=1000)=>({owner,data:Buffer.from(data),lamports,executable:false});
  const vaultBytes=Buffer.alloc(73);disc('RewardVault').copy(vaultBytes);original.toBuffer().copy(vaultBytes,8);mint.toBuffer().copy(vaultBytes,40);
  vaultBytes[72]=PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'),original.toBuffer(),mint.toBuffer()],program)[1];
  const cycleBytes=Buffer.alloc(174);disc('RewardCycle').copy(cycleBytes);vault.toBuffer().copy(cycleBytes,8);Buffer.from(cycleId,'hex').copy(cycleBytes,40);Buffer.from(manifest.root,'hex').copy(cycleBytes,72);
  new PublicKey(asset==='SOL'?SOL_ASSET_MINT:asset).toBuffer().copy(cycleBytes,104);cycleBytes.writeBigUInt64LE(300n,136);cycleBytes.writeBigUInt64LE(100n,144);
  cycleBytes.writeBigInt64LE(100000n,152);cycleBytes.writeBigInt64LE(200000n,160);cycleBytes.writeUInt32LE(2,168);
  cycleBytes[172]=PublicKey.findProgramAddressSync([Buffer.from('reward-cycle-v1'),vault.toBuffer(),Buffer.from(cycleId,'hex')],program)[1];cycleBytes[173]=1;
  const reserveBytes=Buffer.alloc(81);disc('RewardReserve').copy(reserveBytes);vault.toBuffer().copy(reserveBytes,8);new PublicKey(asset==='SOL'?SOL_ASSET_MINT:asset).toBuffer().copy(reserveBytes,40);reserveBytes.writeBigUInt64LE(241n,72);
  reserveBytes[80]=PublicKey.findProgramAddressSync([Buffer.from('reward-reserve-v1'),vault.toBuffer(),new PublicKey(asset==='SOL'?SOL_ASSET_MINT:asset).toBuffer()],program)[1];
  const routerBytes=Buffer.alloc(74);Buffer.from('FUNDFEE1').copy(routerBytes);operator.toBuffer().copy(routerBytes,41);
  f.rows=new Map([[String(vault),info(program,vaultBytes,5000)],[String(cycle),info(program,cycleBytes)],[String(reserve),info(program,reserveBytes)],[String(router),info(program,routerBytes)]]);
  f.plan={id:'historical-payout',cluster:'devnet',mint:String(mint),asset,cycle:String(cycle),manifest,cutoffAt:100000,payoutAt:200000,status:'distributing',payments:{}};
  f.leaf=manifest.leaves.find(l=>l.recipient===String(recipient));f.paidLeaf=manifest.leaves.find(l=>l.recipient===String(paidRecipient));
  Object.assign(f,{program,mint,operator,original,vault,cycle,reserve,router,recipient,asset,tokenProgram,slot:f.market.slot,sends:0,latestCalls:0});
  f.balances=new Map([[String(operator),3100000000],[String(recipient),10000],[String(paidRecipient),10100]]);f.tokens=new Map();f.signatures=new Map();
  f.payment=leaf=>rewardAddresses({programId:program,authority:original,mint,cycleId,recipient:leaf.recipient}).payment;
  f.receipt=(leaf,receiptCycle=cycle)=>{
    const bytes=Buffer.alloc(100);disc('RewardPayment').copy(bytes);receiptCycle.toBuffer().copy(bytes,8);new PublicKey(leaf.recipient).toBuffer().copy(bytes,40);
    bytes.writeBigUInt64LE(BigInt(leaf.amount),72);bytes.writeUInt32LE(leaf.index,80);bytes.writeBigInt64LE(200010n,84);bytes.writeBigUInt64LE(BigInt(leaf.amount),92);
    return info(program,bytes);
  };
  f.rows.set(String(f.payment(f.paidLeaf)),f.receipt(f.paidLeaf));f.signatures.set(String(f.payment(f.paidLeaf)),bs58.encode(Buffer.alloc(64,52)));
  if(asset!=='SOL'){
    const bytes=Buffer.alloc(82);bytes[44]=6;bytes[45]=1;f.rows.set(asset,info(tokenProgram,bytes));
    f.vaultToken=getAssociatedTokenAddressSync(new PublicKey(asset),vault,true,tokenProgram);f.recipientToken=getAssociatedTokenAddressSync(new PublicKey(asset),recipient,false,tokenProgram);
    f.tokens.set(String(f.vaultToken),1000n);
  }
  const baseRead=f.connection.getAccountInfo,baseContext=f.connection.getAccountInfoAndContext;
  f.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
  f.connection.getAccountInfo=async(address,...args)=>f.rows.has(String(address))?f.rows.get(String(address)):baseRead(address,...args);
  f.connection.getAccountInfoAndContext=async(address,options)=>f.rows.has(String(address))?{context:{slot:f.slot},value:f.rows.get(String(address))}:baseContext(address,options);
  f.connection.getMultipleAccountsInfoAndContext=async addresses=>({context:{slot:f.slot},value:addresses.map(a=>f.rows.get(String(a))||null)});
  f.connection.getBalance=async address=>f.rows.get(String(address))?.lamports??f.balances.get(String(address))??0;
  f.connection.getTokenAccountBalance=async address=>{assert(f.tokens.has(String(address)),'Token account unavailable');return {context:{slot:f.slot},value:{amount:String(f.tokens.get(String(address)))}};};
  f.connection.getSignaturesForAddress=async address=>f.signatures.has(String(address))?[{signature:f.signatures.get(String(address)),err:null}]:[];
  f.connection.getTransaction=async()=>null;
  f.connection.getLatestBlockhash=async()=>{f.latestCalls++;return {blockhash:String(key(91)),lastValidBlockHeight:999};};
  f.connection.getBlockHeight=async()=>1000;f.connection.getBlockTime=async()=>200010;
  f.connection.sendRawTransaction=async wire=>{
    const tx=Transaction.from(wire);assert.ok(tx.verifySignatures());assert.equal(String(tx.feePayer),String(operator));
    const ix=tx.instructions.find(i=>i.programId.equals(program));assert(ix);
    assert.ok(ix.data.subarray(0,8).equals(createHash('sha256').update('global:'+(asset==='SOL'?'payout_reward_sol':'payout_reward_token')).digest().subarray(0,8)),'Historical payout must not initialize successor namespace');
    assert.deepEqual(ix.keys.slice(0,5).map(k=>String(k.pubkey)),[String(operator),String(vault),String(reserve),String(cycle),String(recipient)]);
    const amount=ix.data.readBigUInt64LE(8),index=ix.data.readUInt32LE(16),count=ix.data.readUInt32LE(20);
    const proof=Array.from({length:count},(_,n)=>ix.data.subarray(24+n*32,56+n*32).toString('hex'));
    assert.equal(String(amount),f.leaf.amount);assert.equal(index,f.leaf.index);assert(verifyRewardProof({cycleId,asset,recipient:String(recipient),amount:String(amount),index,proof,root:manifest.root}));
    assert.equal(cycleBytes[173],1);assert(!f.rows.has(String(f.payment(f.leaf))));
    if(asset==='SOL'){f.rows.get(String(vault)).lamports-=Number(amount);f.balances.set(String(recipient),f.balances.get(String(recipient))+Number(amount));}
    else{assert.equal(String(ix.keys[6].pubkey),String(f.vaultToken));assert.equal(String(ix.keys[7].pubkey),String(f.recipientToken));assert.equal(String(ix.keys[9].pubkey),String(tokenProgram));
      f.tokens.set(String(f.vaultToken),f.tokens.get(String(f.vaultToken))-amount);f.tokens.set(String(f.recipientToken),(f.tokens.get(String(f.recipientToken))||0n)+amount);}
    cycleBytes.writeBigUInt64LE(300n,144);reserveBytes.writeBigUInt64LE(41n,72);
    f.rows.get(String(cycle)).data=Buffer.from(cycleBytes);f.rows.get(String(reserve)).data=Buffer.from(reserveBytes);
    const signature=bs58.encode(tx.signature);f.rows.set(String(f.payment(f.leaf)),f.receipt(f.leaf));f.signatures.set(String(f.payment(f.leaf)),signature);
    f.sends++;f.signature=signature;return signature;
  };
  f.connection.getSignatureStatuses=async()=>({context:{slot:f.slot},value:[{slot:f.slot,err:null,confirmationStatus:'finalized'}]});
  f.chain=()=>createAutomaticRewardChain({connection:f.connection,programId:program,authority:Keypair.fromSeed(new Uint8Array(32).fill(33)),cluster:'devnet',expectedProgramDataSha256:f.release.programDataSha256});
  return f;
}
