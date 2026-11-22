import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram,Transaction,TransactionInstruction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,
  unpackMint,getAccountLen,getExtensionTypes,getAccountTypeOfMintType,ExtensionType,NATIVE_MINT,NATIVE_MINT_2022} from '@solana/spl-token';
import bs58 from 'bs58';
import {SOLANA_GENESIS} from '../solana-network.js';
import {verifyRewardProof,SOL_ASSET_MINT} from '../reward-merkle.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {readCommittedRewardContext} from './reward-committed-context.mjs';
import {parseCycleFields,parseReserve} from './reward-account-codec.mjs';
import {rewardPayoutProof} from './reward-payout-evidence.mjs';
import {expiryObjectHash,finalizedRewardProgramContext} from './reward-expiry-attempt.mjs';
import {financialRecordNetwork} from './financial-network.mjs';

const key=value=>new PublicKey(value),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const disc=name=>createHash('sha256').update('global:'+name).digest().subarray(0,8);
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const pda=(program,...seeds)=>PublicKey.findProgramAddressSync(seeds,key(program))[0];
export const payoutIntentHash=(plan,leaf)=>expiryObjectHash({cluster:plan.cluster,genesisHash:plan.genesisHash,mint:plan.mint,
  cycle:plan.cycle,cutoffAt:plan.cutoffAt,payoutAt:plan.payoutAt,originalAuthority:plan.originalAuthority,receiptMode:plan.receiptMode||'legacy',
  cycleId:plan.manifest?.cycleId,root:plan.manifest?.root,asset:plan.manifest?.asset,totalAmount:plan.manifest?.totalAmount,
  leafCount:plan.manifest?.leaves?.length,leaf});
const account=a=>({owner:String(a.owner),executable:a.executable,dataBase64:Buffer.from(a.data).toString('base64')});
const restore=a=>{
  assert(typeof a?.dataBase64==='string'&&a.dataBase64.length<=512,'Bounded saved payout account required.');
  const data=Buffer.from(a.dataBase64,'base64');assert(data.toString('base64')===a.dataBase64,'Noncanonical saved payout account.');
  return {...a,owner:key(a.owner),data};
};

// Construct the one permitted receipt-mode payout from immutable intent. No
// caller-supplied transfers, compute changes, metas or extra signatures survive.
function canonicalTransaction({plan,leaf,programId,currentAuthority,cluster,attempt}){
  const before=attempt.before,program=key(programId),operator=key(currentAuthority),mint=key(plan.mint),sol=plan.manifest.asset==='SOL';
  const vault=pda(program,Buffer.from('reward-vault-v1'),key(before.originalAuthority).toBuffer(),mint.toBuffer());
  const cycle=pda(program,Buffer.from('reward-cycle-v1'),vault.toBuffer(),Buffer.from(plan.manifest.cycleId,'hex'));
  const reserve=pda(program,Buffer.from('reward-reserve-v1'),vault.toBuffer(),key(sol?SOL_ASSET_MINT:plan.manifest.asset).toBuffer());
  const recipient=key(leaf.recipient),payment=pda(program,Buffer.from('reward-payment-v1'),cycle.toBuffer(),recipient.toBuffer());
  assert(String(cycle)===plan.cycle&&String(vault)===before.vault&&String(reserve)===before.reserve&&String(payment)===before.payment,
    'Saved payout namespace or recipient differs.');
  const keys=[{pubkey:operator,isSigner:true,isWritable:true},{pubkey:vault,isSigner:false,isWritable:sol},
    {pubkey:reserve,isSigner:false,isWritable:true},{pubkey:cycle,isSigner:false,isWritable:true},{pubkey:recipient,isSigner:false,isWritable:sol}];
  const tx=new Transaction({feePayer:operator,recentBlockhash:attempt.blockhash});
  if(sol)keys.push({pubkey:payment,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false});
  else{
    const token=key(before.tokenProgram);assert(token.equals(TOKEN_PROGRAM_ID)||token.equals(TOKEN_2022_PROGRAM_ID),'Unsupported saved payout token program.');
    const asset=key(plan.manifest.asset),source=getAssociatedTokenAddressSync(asset,vault,true,token),destination=getAssociatedTokenAddressSync(asset,recipient,false,token);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(operator,destination,recipient,asset,token));
    keys.push(...[asset,source,destination,payment,token,SystemProgram.programId].map((pubkey,i)=>({pubkey,isSigner:false,isWritable:[1,2,3].includes(i)})));
  }
  if(cluster==='mainnet-beta')keys.push({pubkey:pda(program,Buffer.from('funded-fee-router-v1')),isSigner:false,isWritable:false});
  tx.add(new TransactionInstruction({programId:program,keys,data:Buffer.concat([disc(sol?'payout_reward_sol':'payout_reward_token'),
    u64(leaf.amount),u32(leaf.index),u32(leaf.proof.length),...leaf.proof.map(n=>Buffer.from(n,'hex'))])}));
  return tx;
}

export function requirePayoutAttempt(attempt,options){
  const {plan,leaf,programId,currentAuthority,cluster,expectedProgramDataSha256}=options;
  assert(financialRecordNetwork(plan,cluster,{legacyDevnet:true}),'Saved payout plan network differs.');
  assert(attempt?.version===1&&['prepared','verified'].includes(attempt.state)&&attempt.cluster===cluster
    &&attempt.genesisHash===SOLANA_GENESIS[cluster]&&attempt.programId===String(programId)
    &&attempt.programDataSha256===expectedProgramDataSha256&&attempt.intentHash===payoutIntentHash(plan,leaf)
    &&attempt.snapshotHash===expiryObjectHash(attempt.before),'Saved payout attempt context differs.');
  assert(verifyRewardProof({cycleId:plan.manifest.cycleId,asset:plan.manifest.asset,...leaf,root:plan.manifest.root})
    &&leaf.proof.length<=32,'Invalid saved payout leaf.');
  const before=attempt.before,cycle=restore(before.cycleInfo),reserve=restore(before.reserveInfo);
  assert([cycle,reserve].every(a=>a.owner.equals(key(programId))&&a.executable===false),'Saved payout account ownership differs.');
  const record=parseCycleFields(cycle),liability=parseReserve(reserve);
  assert(record?.reserved&&record.receiptMode==='legacy'&&record.vault===before.vault&&record.root===plan.manifest.root
    &&record.cycleId===plan.manifest.cycleId&&record.asset===plan.manifest.asset&&record.totalAmount===plan.manifest.totalAmount
    &&record.cutoffAt===plan.cutoffAt&&record.payoutAt===plan.payoutAt&&record.leafCount===plan.manifest.leaves.length
    &&liability?.vault===before.vault&&BigInt(liability.outstanding)>=BigInt(leaf.amount)
    &&BigInt(record.distributedAmount)+BigInt(leaf.amount)<=BigInt(record.totalAmount)
    &&Number.isSafeInteger(before.slot)&&before.slot>0,'Saved payout accounting differs.');
  assert([before.feeLamports,before.receiptRentLamports,before.tokenRentLamports].every(n=>Number.isSafeInteger(n)&&n>=0)
    &&before.feeLamports>0&&before.receiptRentLamports>0,'Saved payout cost quote is missing; reconcile without replacement.');
  assert(typeof attempt.transactionBase64==='string'&&attempt.transactionBase64.length<=1644,'Bounded payout wire required.');
  const raw=Buffer.from(attempt.transactionBase64,'base64');assert(raw.length<=1232&&raw.toString('base64')===attempt.transactionBase64,'Noncanonical payout wire.');
  const tx=Transaction.from(raw),message=tx.serializeMessage();
  assert(tx.verifySignatures()&&tx.signatures.length===1&&String(tx.signatures[0].publicKey)===String(currentAuthority)
    &&bs58.encode(tx.signature)===attempt.signature&&digest(message)===attempt.messageHash
    &&Number.isSafeInteger(attempt.lastValidBlockHeight)&&attempt.lastValidBlockHeight>0
    &&canonicalTransaction({...options,attempt}).serializeMessage().equals(message),'Saved payout signature or immutable message differs.');
  return {transaction:tx,message,record,liability};
}

function nativeAccounting(tx,attempt,plan,leaf){
  const keys=tx.transaction.message.accountKeys,pre=tx.meta.preBalances,post=tx.meta.postBalances,fee=BigInt(tx.meta.fee);
  if(pre.reduce((sum,n,i)=>sum+BigInt(n)-BigInt(post[i]),0n)!==fee||tx.meta.fee!==attempt.before.feeLamports)return false;
  const expected=new Map(keys.map(k=>[String(k),0n]));
  const add=(address,n)=>{const name=String(address);if(!expected.has(name))throw Error('Missing native accounting account.');expected.set(name,expected.get(name)+n);};
  const balance=(array,address)=>BigInt(array[keys.findIndex(k=>String(k)===String(address))]);
  const before=attempt.before,rent=balance(post,before.payment)-balance(pre,before.payment);
  if(rent!==BigInt(before.receiptRentLamports))return false;
  add(keys[0],-fee-rent);add(before.payment,rent);
  const amount=BigInt(leaf.amount),sol=plan.manifest.asset==='SOL';
  if(sol){add(before.vault,-amount);add(leaf.recipient,amount);}
  else{
    const tokenProgram=key(before.tokenProgram),mint=key(plan.manifest.asset);
    const source=getAssociatedTokenAddressSync(mint,key(before.vault),true,tokenProgram),destination=getAssociatedTokenAddressSync(mint,key(leaf.recipient),false,tokenProgram);
    const destinationIndex=keys.findIndex(k=>k.equals(destination));
    const existed=tx.meta.preTokenBalances?.some(b=>b.accountIndex===destinationIndex&&b.mint===plan.manifest.asset);
    const old=balance(pre,destination),deposit=existed?0n:BigInt(before.tokenRentLamports)>old?BigInt(before.tokenRentLamports)-old:0n;
    add(keys[0],-deposit);add(destination,deposit);
    // Wrapped-native transfers move both token units AND backing lamports.
    if(mint.equals(tokenProgram.equals(TOKEN_PROGRAM_ID)?NATIVE_MINT:NATIVE_MINT_2022)){add(source,-amount);add(destination,amount);}
  }
  return keys.every((k,i)=>BigInt(post[i])-BigInt(pre[i])===expected.get(String(k)));
}

export async function finalizedPayoutAttempt(options){
  try{
    const {connection,attempt,plan,leaf,programId,currentAuthority,cluster}=options,saved=requirePayoutAttempt(attempt,options);
    if(await connection.getGenesisHash()!==SOLANA_GENESIS[cluster])return null;
    const [statuses,tx]=await Promise.all([connection.getSignatureStatuses([attempt.signature],{searchTransactionHistory:true}),
      connection.getTransaction(attempt.signature,{commitment:'finalized',maxSupportedTransactionVersion:0})]);
    const status=statuses.value?.[0];
    if(!tx||!Number.isSafeInteger(tx.slot)||tx.slot<attempt.before.slot||status?.confirmationStatus!=='finalized'||status.err!==null
      ||status.slot!==tx.slot||!Number.isSafeInteger(statuses.context?.slot)||statuses.context.slot<tx.slot||tx.meta?.err!==null||tx.transaction.signatures?.length!==1
      ||tx.transaction.signatures[0]!==attempt.signature||!Buffer.from(tx.transaction.message.serialize()).equals(saved.message))return null;
    const keys=tx.transaction.message.accountKeys||tx.transaction.message.staticAccountKeys;
    if(!Array.isArray(tx.meta.preBalances)||tx.meta.preBalances.length!==keys.length||tx.meta.postBalances?.length!==keys.length
      ||![...tx.meta.preBalances,...tx.meta.postBalances].every(n=>Number.isSafeInteger(n)&&n>=0)
      ||!Number.isSafeInteger(tx.meta.fee)||tx.meta.fee<=0)return null;
    const paymentIndex=keys.findIndex(k=>String(k)===attempt.before.payment);
    if(paymentIndex<0||tx.meta.preBalances[paymentIndex]!==0||tx.meta.postBalances[paymentIndex]<=0)return null;
    if(!nativeAccounting(tx,attempt,plan,leaf))return null;
    const proof=rewardPayoutProof(tx,{program:key(programId),cycle:key(plan.cycle),vault:key(attempt.before.vault),manifest:plan.manifest,leaf,bitmap:false});
    if(!proof||proof.signature!==attempt.signature)return null;
    const context=await finalizedRewardProgramContext({...options,transactionSlot:tx.slot});
    const after=await readCommittedRewardContext({...options,recipient:leaf.recipient,readOnlyRecovery:true});
    if(after.slot<context.programDataContextSlot||after.record.receiptMode!=='legacy'
      ||BigInt(after.record.distributedAmount)<BigInt(saved.record.distributedAmount)+BigInt(leaf.amount)
      ||BigInt(after.liability?.outstanding)>BigInt(saved.liability.outstanding)-BigInt(leaf.amount))return null;
    // Program-owned immutable receipt plus exact transaction-local recipient and
    // custody deltas; current aggregate state alone never attributes an attempt.
    const data=after.paymentInfo?.data;
    if(!after.paymentInfo?.owner?.equals(key(programId))||after.paymentInfo.executable!==false||data?.length!==100
      ||!data.subarray(0,8).equals(createHash('sha256').update('account:RewardPayment').digest().subarray(0,8))
      ||!data.subarray(8,40).equals(key(plan.cycle).toBuffer())||!data.subarray(40,72).equals(key(leaf.recipient).toBuffer())
      ||data.readBigUInt64LE(72)!==BigInt(leaf.amount)||data.readUInt32LE(80)!==leaf.index||data.readBigUInt64LE(92)!==BigInt(leaf.amount))return null;
    return {...proof,payment:attempt.before.payment,messageHash:attempt.messageHash,programId:String(programId),
      genesisHash:SOLANA_GENESIS[cluster],programDataSha256:options.expectedProgramDataSha256,
      transactionSlot:tx.slot,programDataContextSlot:context.programDataContextSlot,accountContextSlot:after.slot,
      payoutTransactionVerified:true,vaultBalanceDeltaVerified:true};
  }catch{return null;}
}

export async function executeRewardPayout({store,plan,leaf,connection,programId,currentAuthority,cluster,expectedProgramDataSha256,
  prepareLeaf,send,submitBitmap,release=reviewedMainnetManifest(),recoveryOnly=false}){
  // Freeze the scalar intent and selected leaf, not the entire cohort on every
  // payout. The root/count and locked saved-row hash bind the shared leaf list.
  const intent=payoutIntentHash(plan,leaf);plan={...plan,manifest:{...plan.manifest}};leaf=structuredClone(leaf);
  assert(store?.read&&store?.transaction&&typeof plan.id==='string'&&plan.id&&typeof recoveryOnly==='boolean','Durable payout store, schedule and mode required.');
  expectedProgramDataSha256=String(expectedProgramDataSha256||'').toLowerCase();assert(/^[a-f0-9]{64}$/.test(expectedProgramDataSha256),'Pinned payout program required.');
  const options={connection,plan,leaf,programId,currentAuthority,cluster,expectedProgramDataSha256,release};
  const row=state=>{const r=state.schedules?.[plan.id];assert(r&&payoutIntentHash(r,leaf)===intent,'Saved payout schedule changed.');return r;};
  const saved=row(await store.read()),prior=saved.payoutAttempts?.[leaf.recipient];
  if(Object.hasOwn(saved,'payoutAttempts'))assert(saved.payoutAttempts&&typeof saved.payoutAttempts==='object'&&!Array.isArray(saved.payoutAttempts),'Corrupt payout attempt container.');
  if(saved.payoutAttempts&&Object.hasOwn(saved.payoutAttempts,leaf.recipient))assert(prior&&typeof prior==='object'&&!Array.isArray(prior),'Corrupt saved payout attempt.');
  const finish=async attempt=>{
    requirePayoutAttempt(attempt,options);
    if(attempt.state==='verified'){
      const proof=attempt.proof;assert(proof?.payoutTransactionVerified===true&&proof.finalized===true&&proof.balanceDeltaVerified===true
        &&proof.vaultBalanceDeltaVerified===true&&proof.signature===attempt.signature&&proof.messageHash===attempt.messageHash
        &&proof.payment===attempt.before.payment&&proof.programDataSha256===expectedProgramDataSha256&&proof.amountReceived===leaf.amount
        &&proof.programId===String(programId)&&proof.genesisHash===SOLANA_GENESIS[cluster]
        &&[proof.transactionSlot,proof.programDataContextSlot,proof.accountContextSlot].every(Number.isSafeInteger)
        &&proof.transactionSlot>=attempt.before.slot&&proof.programDataContextSlot>=proof.transactionSlot
        &&proof.accountContextSlot>=proof.programDataContextSlot,'Saved payout completion lacks proof.');
      return {...structuredClone(proof),alreadyPaid:true};
    }
    const proof=await finalizedPayoutAttempt({...options,attempt});
    assert(proof,'Payout attempt requires exact finalized reconciliation; no replacement authorized.');
    return store.transaction(state=>{
      const active=row(state).payoutAttempts?.[leaf.recipient];assert(active&&active.signature===attempt.signature&&active.messageHash===attempt.messageHash
        &&active.snapshotHash===attempt.snapshotHash,'Payout attempt changed during reconciliation.');
      active.state='verified';active.proof=structuredClone(proof);return proof;
    });
  };
  if(prior)return finish(prior);
  if(recoveryOnly)return {status:'no-saved-payout-attempt'};
  const prepared=await prepareLeaf(plan,leaf);
  // Preserve the pre-existing Devnet legacy-receipt reader. It must never be
  // used to attribute a durable attempt or admit historical Mainnet payment.
  if(prepared.paid){assert(cluster==='devnet','Historical Mainnet payment needs authenticated archival proof.');return prepared.paid;}
  if(prepared.bitmap){assert(cluster==='devnet'&&typeof submitBitmap==='function','Bitmap payout is Devnet only.');return submitBitmap(plan,leaf);}
  const c=prepared.context;assert(c?.record.reserved&&!c.paymentInfo,'Fresh payout must use an unpaid authenticated commitment.');
  let attempt;
  try{
    await send(prepared.transaction,{beforeBroadcast:async payload=>{
      const tx=Transaction.from(Buffer.from(payload.transactionBase64,'base64'));
      const [fee,balance]=await Promise.all([connection.getFeeForMessage(tx.compileMessage(),'finalized'),connection.getBalance(currentAuthority,'finalized')]);
      // Rent maximum uses actual message account inventory; quote unknown rent
      // conservatively before signing transport can broadcast the frozen wire.
      const paymentRent=await connection.getMinimumBalanceForRentExemption(100,'finalized');
      let tokenRent=0;
      if(plan.manifest.asset!=='SOL'){
        const mint=key(plan.manifest.asset),mintInfo=await connection.getAccountInfo(mint,'finalized');
        const tokenProgram=prepared.transaction.instructions[0].keys[5].pubkey;
        const parsed=unpackMint(mint,mintInfo,tokenProgram),extensions=getExtensionTypes(parsed.tlvData)
          .map(getAccountTypeOfMintType).filter(type=>type!==ExtensionType.Uninitialized);
        if(tokenProgram.equals(TOKEN_2022_PROGRAM_ID))extensions.push(ExtensionType.ImmutableOwner);
        tokenRent=await connection.getMinimumBalanceForRentExemption(getAccountLen([...new Set(extensions)]),'finalized');
      }
      assert([fee?.value,balance,paymentRent,tokenRent].every(n=>Number.isSafeInteger(n)&&n>=0)
        &&BigInt(balance)>=3000000000n+BigInt(fee.value)+BigInt(paymentRent)+BigInt(tokenRent),'Protected operator reserve cannot fund payout fee/rent.');
      const before={vault:String(c.vault),reserve:String(c.reserve),payment:String(c.payment),originalAuthority:String(c.originalAuthority),slot:c.slot,
        feeLamports:fee.value,receiptRentLamports:paymentRent,tokenRentLamports:tokenRent,
        cycleInfo:account(c.cycleInfo),reserveInfo:account(c.reserveInfo),tokenProgram:plan.manifest.asset==='SOL'?null:String(prepared.transaction.instructions[0].keys[5].pubkey)};
      attempt={version:1,state:'prepared',cluster,genesisHash:SOLANA_GENESIS[cluster],programId:String(programId),programDataSha256:expectedProgramDataSha256,
        intentHash:intent,before,snapshotHash:expiryObjectHash(before),...payload,messageHash:digest(tx.serializeMessage())};
      requirePayoutAttempt(attempt,options);
      await store.transaction(state=>{const r=row(state);r.payoutAttempts||={};assert(!Object.hasOwn(r.payoutAttempts,leaf.recipient),'Another durable payout attempt owns this leaf.');
        r.payoutAttempts[leaf.recipient]=structuredClone(attempt);});
    }});
  }catch(error){attempt=row(await store.read()).payoutAttempts?.[leaf.recipient];if(!attempt)throw error;}
  assert(attempt,'Payout transport did not persist its signed message.');return finish(attempt);
}
